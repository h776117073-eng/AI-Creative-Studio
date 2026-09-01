import {
  BaseEngine,
  EngineConfigSchema,
  EventEmitter,
} from '@ai-creative-studio/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const CommandEngineConfigSchema = EngineConfigSchema.extend({
  maxHistorySize: z.number().optional().default(100),
  hotkeysEnabled: z.boolean().optional().default(true),
});

type CommandEngineConfig = z.infer<typeof CommandEngineConfigSchema>;

export type CommandPriority = 'high' | 'normal' | 'low';

export interface ICommand {
  id: string;
  type: string;
  label: string;
  category: string;
  description?: string;
  aliases?: string[];
  icon?: string;
  hotkey?: string;
  priority?: CommandPriority;
  when?: (context: ICommandContext) => boolean | string;
  execute: (context: ICommandContext) => ICommandResult | Promise<ICommandResult>;
  undo?: (context: ICommandContext) => ICommandResult | Promise<ICommandResult>;
  canExecute?: (context: ICommandContext) => boolean | string;
  repeatable?: boolean;
  requiresConfirmation?: boolean;
  confirmationMessage?: string | ((context: ICommandContext) => string);
}

export interface ICommandContext {
  projectId?: string;
  selectedNodes?: string[];
  currentTime?: number;
  selectedClips?: string[];
  selectedTrack?: string;
  activeWorkspace?: string;
  activeViewId?: string;
  copySelection?: () => ICommandResult | Promise<ICommandResult>;
  pasteClipboard?: () => ICommandResult | Promise<ICommandResult>;
  deleteSelection?: () => ICommandResult | Promise<ICommandResult>;
  [key: string]: unknown;
}

export interface ICommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  undoData?: unknown;
  error?: Error;
  showNotification?: boolean;
  notificationType?: 'success' | 'info' | 'warning' | 'error';
  nextCommand?: ICommandRequest;
}

export interface ICommandRequest {
  type: string;
  payload?: unknown;
  options?: {
    silent?: boolean;
    skipHistory?: boolean;
    priority?: CommandPriority;
    source?: string;
  };
}

export interface IHotkeyBinding {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  commandType: string;
  scope?: string;
  when?: () => boolean;
}

export interface ICommandHistory {
  id: string;
  timestamp: number;
  command: string;
  context: ICommandContext;
  undoData?: unknown;
}

export interface ICommandEvents {
  'command:executed': { command: string; result: ICommandResult };
  'command:undone': { command: string };
  'command:redone': { command: string };
  'command:failed': { command: string; error: Error };
  'hotkey:triggered': { hotkey: string; command: string };
}

export class CommandEngine extends BaseEngine {
  private commands: Map<string, ICommand> = new Map();
  private hotkeyBindings: Map<string, IHotkeyBinding> = new Map();
  private history: ICommandHistory[] = [];
  private historyIndex = -1;
  private maxHistorySize: number;
  private hotkeysEnabled: boolean;
  private emitter = new EventEmitter<ICommandEvents>();
  private macroStack: ICommandRequest[] = [];
  private isExecutingMacro = false;

  constructor(config: CommandEngineConfig) {
    super(CommandEngineConfigSchema.parse(config));
    this.maxHistorySize = config.maxHistorySize!;
    this.hotkeysEnabled = config.hotkeysEnabled!;
  }

  protected async onInitialize(): Promise<void> {
    this.registerCoreCommands();
    if (this.hotkeysEnabled && typeof window !== 'undefined') window.addEventListener('keydown', this.handleKeyboardEvent);
  }

  protected override async onDestroy(): Promise<void> {
    if (this.hotkeysEnabled && typeof window !== 'undefined') window.removeEventListener('keydown', this.handleKeyboardEvent);
    this.commands.clear();
    this.hotkeyBindings.clear();
    this.history = [];
    this.historyIndex = -1;
  }

  registerCommand(command: ICommand): void {
    if (this.commands.has(command.type)) console.warn(`Command ${command.type} already registered, overwriting`);
    this.commands.set(command.type, command);
    const hotkeyBinding = this.parseHotkey(command.hotkey, command.type);
    if (hotkeyBinding) this.hotkeyBindings.set(hotkeyBinding.key, hotkeyBinding);
  }

  registerCommands(commands: ICommand[]): void { commands.forEach(cmd => this.registerCommand(cmd)); }
  unregisterCommand(type: string): void { const command=this.commands.get(type);if(!command)return;if(command.hotkey)this.hotkeyBindings.delete(command.hotkey.toLowerCase());this.commands.delete(type); }
  getCommand(type: string): ICommand | undefined { return this.commands.get(type); }
  getCommandsByCategory(category: string): ICommand[] { return Array.from(this.commands.values()).filter(cmd=>cmd.category===category); }
  getAllCommands(): ICommand[] { return Array.from(this.commands.values()); }

  async execute(request: ICommandRequest, context: ICommandContext = {}): Promise<ICommandResult> {
    const command=this.commands.get(request.type);
    if(!command){const error=new Error(`Unknown command: ${request.type}`);this.emitter.emit('command:failed',{command:request.type,error});return{success:false,error};}
    const canExecute=command.canExecute?command.canExecute(context):true;
    if(canExecute!==true&&canExecute!=='enabled')return{success:false,message:typeof canExecute==='string'?canExecute:'Command cannot be executed in current context'};
    try{
      const result=await command.execute(context);
      if(result.success&&command.undo&&!request.options?.skipHistory)this.addToHistory({id:uuidv4(),timestamp:Date.now(),command:request.type,context,undoData:result.undoData});
      if(!request.options?.silent)this.emitter.emit('command:executed',{command:request.type,result});
      return result;
    }catch(error){const normalized=error instanceof Error?error:new Error(String(error));this.emitter.emit('command:failed',{command:request.type,error:normalized});return{success:false,error:normalized};}
  }

  async undo(context: ICommandContext = {}): Promise<ICommandResult | null> {
    if(this.historyIndex<0)return null;const item=this.history[this.historyIndex];const command=this.commands.get(item.command);if(!command?.undo)return null;
    try{const result=await command.undo({...context,...item.context,undoData:item.undoData});if(result.success){this.historyIndex--;this.emitter.emit('command:undone',{command:item.command});}return result;}
    catch(error){return{success:false,error:error instanceof Error?error:new Error(String(error))};}
  }

  async redo(context: ICommandContext = {}): Promise<ICommandResult | null> {
    if(this.historyIndex>=this.history.length-1)return null;const next=this.historyIndex+1;const item=this.history[next];const command=this.commands.get(item.command);if(!command)return null;
    const merged={...context,...item.context};const canExecute=command.canExecute?command.canExecute(merged):true;if(canExecute!==true&&canExecute!=='enabled')return{success:false,message:'Command cannot be redone in current context'};
    try{const result=await command.execute(merged);if(result.success){this.historyIndex=next;this.emitter.emit('command:redone',{command:item.command});}return result;}
    catch(error){return{success:false,error:error instanceof Error?error:new Error(String(error))};}
  }

  canUndo(): boolean { return this.historyIndex>=0; }
  canRedo(): boolean { return this.historyIndex<this.history.length-1; }
  getHistory(): ICommandHistory[] { return [...this.history]; }
  getHistoryIndex(): number { return this.historyIndex; }
  clearHistory(): void { this.history=[];this.historyIndex=-1; }

  registerHotkey(hotkey:string,commandType:string):void{const binding=this.parseHotkey(hotkey,commandType);if(binding)this.hotkeyBindings.set(binding.key,binding);}
  unregisterHotkey(hotkey:string):void{this.hotkeyBindings.delete(hotkey.toLowerCase());}
  getHotkeyBindings():IHotkeyBinding[]{return Array.from(this.hotkeyBindings.values());}

  beginMacro():void{this.macroStack=[];this.isExecutingMacro=true;}
  addToMacro(request:ICommandRequest):void{if(this.isExecutingMacro)this.macroStack.push(request);}
  endMacro():ICommandRequest[]{this.isExecutingMacro=false;return[...this.macroStack];}

  async executeMacro(requests:ICommandRequest[],context:ICommandContext):Promise<ICommandResult[]>{
    const results:ICommandResult[]=[];const initialHistory=this.historyIndex;
    for(const request of requests){const result=await this.execute(request,{...context});results.push(result);if(!result.success){
      while(this.historyIndex>initialHistory){const undoResult=await this.undo(context);if(!undoResult?.success)break;}
      break;
    }}
    return results;
  }

  private handleKeyboardEvent=(event:KeyboardEvent):void=>{
    if(event.repeat)return;const modifiers:IHotkeyBinding['modifiers']=[];if(event.ctrlKey)modifiers.push('ctrl');if(event.altKey)modifiers.push('alt');if(event.shiftKey)modifiers.push('shift');if(event.metaKey)modifiers.push('meta');
    const bindingKey=[...modifiers,event.key.toLowerCase()].join('+');const binding=this.hotkeyBindings.get(bindingKey)||this.hotkeyBindings.get(event.key);if(binding&&(!binding.when||binding.when())){event.preventDefault();event.stopPropagation();this.execute({type:binding.commandType},{source:'hotkey'}).then(()=>{this.emitter.emit('hotkey:triggered',{hotkey:bindingKey,command:binding.commandType});});}
  };

  private parseHotkey(hotkey:string|undefined,commandType:string):IHotkeyBinding|null{if(!hotkey)return null;const parts=hotkey.toLowerCase().split('+');const modifiers:IHotkeyBinding['modifiers']=[];let key='';for(const part of parts){if(['ctrl','alt','shift','meta'].includes(part))modifiers.push(part as any);else key=part;}return{key:[...modifiers,key].join('+'),modifiers,commandType};}
  private addToHistory(item:ICommandHistory):void{if(this.historyIndex<this.history.length-1)this.history=this.history.slice(0,this.historyIndex+1);this.history.push(item);if(this.history.length>this.maxHistorySize)this.history.shift();this.historyIndex=this.history.length-1;}

  private registerCoreCommands():void{
    this.registerCommand({id:'core:undo',type:'core:undo',label:'Undo',category:'Core',hotkey:'ctrl+z',execute:async()=>{const result=await this.undo({});return result??{success:false,message:'Nothing to undo'};}});
    this.registerCommand({id:'core:redo',type:'core:redo',label:'Redo',category:'Core',hotkey:'ctrl+shift+z',execute:async()=>{const result=await this.redo({});return result??{success:false,message:'Nothing to redo'};}});
    this.registerCommand({id:'core:copy',type:'core:copy',label:'Copy',category:'Edit',hotkey:'ctrl+c',execute:async context=>context.copySelection?context.copySelection():{success:false,message:'Copy is not wired to an editor selection.'}});
    this.registerCommand({id:'core:paste',type:'core:paste',label:'Paste',category:'Edit',hotkey:'ctrl+v',execute:async context=>context.pasteClipboard?context.pasteClipboard():{success:false,message:'Paste is not wired to an editor clipboard.'}});
    this.registerCommand({id:'core:delete',type:'core:delete',label:'Delete',category:'Edit',hotkey:'delete',execute:async context=>context.deleteSelection?context.deleteSelection():{success:false,message:'Delete is not wired to an editor selection.'}});
  }

  on<E extends keyof ICommandEvents>(event:E,listener:(data:ICommandEvents[E])=>void):this{this.emitter.on(event,listener as any);return this;}
  off<E extends keyof ICommandEvents>(event:E,listener:(data:ICommandEvents[E])=>void):this{this.emitter.off(event,listener as any);return this;}
  getCapabilities():string[]{return['command:register','command:execute','command:undo','command:redo','command:history','command:hotkeys','command:macros'];}
}
