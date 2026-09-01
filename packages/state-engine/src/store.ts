import { produce } from 'immer';
import { EventEmitter } from 'eventemitter3';
import { ProjectId, NodeId, ProjectGraph, INode } from '@ai-creative-studio/core';

export interface ProjectState { id: ProjectId; name: string; graph: ProjectGraph; selectedNodeIds: Set<NodeId>; currentTime: number; playbackState: 'playing'|'paused'|'stopped'; zoom: number; panOffset: {x:number;y:number}; }
export interface WorkspaceState { activeWorkspace:'video'|'design'|'motion'|'audio'|'presentation'|'image'|'brand'|'ai'|'storyboard'; panels:PanelState[]; sidebarCollapsed:boolean; inspectorCollapsed:boolean; timelineExpanded:boolean; canvasMode:'select'|'draw'|'text'|'shape'|'zoom'|'pan'; }
export interface PanelState { id:string; type:string; visible:boolean; position:{x:number;y:number}; size:{width:number;height:number}; docked:boolean; dockPosition?:'left'|'right'|'top'|'bottom'; zIndex:number; }
export interface TimelineState { tracks:TrackState[]; currentTime:number; duration:number; zoom:number; scrollOffset:number; snappingEnabled:boolean; selectedTrackIds:Set<string>; selectedClipIds:Set<string>; playheadPosition:number; loopRegion:{start:number;end:number}|null; markers:MarkerState[]; }
export interface TrackState { id:string; name:string; type:'video'|'audio'|'text'|'effect'; clips:ClipState[]; muted:boolean; locked:boolean; visible:boolean; height:number; color?:string; }
export interface ClipState { id:string; trackId:string; assetId?:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; name:string; effects:string[]; animations:string[]; }
export interface MarkerState { id:string; time:number; label:string; color:string; }
export interface UserState { id:string; name:string; email:string; avatar?:string; preferences:UserPreferences; }
export interface UserPreferences { theme:'light'|'dark'|'system'; language:string; autoSave:boolean; autoSaveInterval:number; keyboardShortcuts:Record<string,string>; defaultResolution:{width:number;height:number}; defaultFrameRate:number; }
export interface RootState { project:ProjectState|null; workspace:WorkspaceState; timeline:TimelineState; user:UserState|null; ui:UIState; ai:AIState; collaboration:CollaborationState; }
export interface UIState { isLoading:boolean; activeModal:string|null; notifications:Notification[]; commandPaletteOpen:boolean; assetBrowserOpen:boolean; }
export interface Notification { id:string; type:'info'|'success'|'warning'|'error'; message:string; timestamp:number; dismissible:boolean; }
export interface AIState { commandHistory:AICommand[]; currentTask:AITask|null; agents:AIAgentState[]; }
export interface AICommand { id:string; query:string; timestamp:number; status:'pending'|'completed'|'failed'; result?:unknown; }
export interface AITask { id:string; type:string; status:'pending'|'running'|'completed'|'failed'; progress:number; message?:string; }
export interface AIAgentState { id:string; name:string; type:string; status:'idle'|'active'|'processing'; currentTask?:string; }
export interface CollaborationState { collaborators:Collaborator[]; cursorPositions:Record<string,CursorPosition>; selections:Record<string,NodeId[]>; }
export interface Collaborator { id:string; name:string; color:string; avatar?:string; }
export interface CursorPosition { x:number; y:number; visible:boolean; }

export function createInitialState():RootState{return{project:null,workspace:{activeWorkspace:'video',panels:[],sidebarCollapsed:false,inspectorCollapsed:false,timelineExpanded:true,canvasMode:'select'},timeline:{tracks:[],currentTime:0,duration:0,zoom:1,scrollOffset:0,snappingEnabled:true,selectedTrackIds:new Set(),selectedClipIds:new Set(),playheadPosition:0,loopRegion:null,markers:[]},user:null,ui:{isLoading:false,activeModal:null,notifications:[],commandPaletteOpen:false,assetBrowserOpen:false},ai:{commandHistory:[],currentTask:null,agents:[]},collaboration:{collaborators:[],cursorPositions:{},selections:{}}};}
