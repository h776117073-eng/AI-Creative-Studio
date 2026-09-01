import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { EventBus, IEvent, globalEventBus } from '../events/index.js';

export interface IEngineConfig { id: string; name: string; dependencies?: string[]; priority?: number; }
export interface IEngineState { initialized: boolean; ready: boolean; error: Error | null; }
export type EngineStatus = 'uninitialized' | 'initializing' | 'ready' | 'error' | 'destroyed';
export interface IEngineEvents { 'engine:status': { status: EngineStatus; previousStatus: EngineStatus }; 'engine:error': { error: Error }; 'engine:ready': {}; }
export const EngineConfigSchema = z.object({ id: z.string(), name: z.string(), dependencies: z.array(z.string()).optional(), priority: z.number().optional() });

export abstract class BaseEngine {
  public readonly id: string; public readonly name: string; public readonly dependencies: string[]; public readonly priority: number;
  protected state: IEngineState = { initialized: false, ready: false, error: null };
  protected eventBus: EventBus; protected emitter = new EventEmitter<IEngineEvents>(); private status: EngineStatus = 'uninitialized';
  constructor(config: Partial<IEngineConfig> = {}, eventBus: EventBus = globalEventBus) { this.id = config.id ?? 'engine'; this.name = config.name ?? this.id; this.dependencies = config.dependencies ?? []; this.priority = config.priority ?? 0; this.eventBus = eventBus; }
  async initialize(): Promise<void> { if (this.status !== 'uninitialized') throw new Error(`Engine ${this.id} is already initialized or in progress`); this.setStatus('initializing'); try { await this.onInitialize(); this.state.initialized = true; this.state.ready = true; this.setStatus('ready'); this.emit('engine:ready', {}); } catch (error) { this.state.error = error instanceof Error ? error : new Error(String(error)); this.state.ready = false; this.setStatus('error'); this.emit('engine:error', { error: this.state.error }); throw error; } }
  async destroy(): Promise<void> { if (this.status === 'destroyed') return; try { await this.onDestroy(); this.state.initialized = false; this.state.ready = false; this.setStatus('destroyed'); } catch (error) { this.state.error = error instanceof Error ? error : new Error(String(error)); this.setStatus('error'); throw error; } }
  protected abstract onInitialize(): Promise<void>;
  protected onDestroy(): Promise<void> { return Promise.resolve(); }
  isReady(): boolean { return this.state.ready && this.status === 'ready'; }
  getStatus(): EngineStatus { return this.status; }
  getError(): Error | null { return this.state.error; }
  protected setStatus(newStatus: EngineStatus): void { const previousStatus = this.status; this.status = newStatus; this.emit('engine:status', { status: newStatus, previousStatus }); }
  protected emitEvent(event: IEvent): void { this.eventBus.emit(event); }
  onEngineEvent<E extends keyof IEngineEvents>(event: E, listener: (data: IEngineEvents[E]) => void): this { this.emitter.on(event, listener as any); return this; }
  offEngineEvent<E extends keyof IEngineEvents>(event: E, listener: (data: IEngineEvents[E]) => void): this { this.emitter.off(event, listener as any); return this; }
  protected emit<E extends keyof IEngineEvents>(event: E, data: IEngineEvents[E]): void { this.emitter.emit(event, data as any); }
  abstract getCapabilities(): string[];
}
