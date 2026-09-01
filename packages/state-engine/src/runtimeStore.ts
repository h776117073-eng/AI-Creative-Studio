import type { RootState } from './store.js';
import type { IAction } from './actions.js';

export interface StateSnapshot {
  id: string;
  version: number;
  timestamp: number;
  state: RootState;
  action?: IAction;
}

export interface StatePersistenceAdapter {
  load(): Promise<RootState | null>;
  save(state: RootState, version: number): Promise<void>;
}

export interface StateEventEmitter {
  emit(event: string, payload: unknown): unknown;
}

export type StateReducer = (state: RootState, action: IAction) => RootState;
export type StateListener = (state: RootState, action?: IAction) => void;

const cloneState = <T>(value: T): T => structuredClone(value);

export class RuntimeStateStore {
  private state: RootState;
  private readonly reducer: StateReducer;
  private readonly maxSnapshots: number;
  private snapshots: StateSnapshot[] = [];
  private historyIndex = -1;
  private version = 0;
  private listeners = new Set<StateListener>();
  private emitter?: StateEventEmitter;
  private persistence?: StatePersistenceAdapter;

  constructor(initialState: RootState, reducer: StateReducer = state => state, options: { maxSnapshots?: number; emitter?: StateEventEmitter; persistence?: StatePersistenceAdapter } = {}) {
    this.state = cloneState(initialState);
    this.reducer = reducer;
    this.maxSnapshots = Math.max(1, options.maxSnapshots ?? 100);
    this.emitter = options.emitter;
    this.persistence = options.persistence;
    this.recordSnapshot();
  }

  getState(): RootState { return cloneState(this.state); }
  getVersion(): number { return this.version; }

  subscribe(listener: StateListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  setState(next: RootState, action?: IAction): RootState {
    this.state = cloneState(next);
    this.version += 1;
    this.recordSnapshot(action);
    this.notify(action);
    void this.persist();
    return this.getState();
  }

  dispatch(action: IAction): RootState {
    const next = this.reducer(this.getState(), action);
    return this.setState(next, action);
  }

  canUndo(): boolean { return this.historyIndex > 0; }
  canRedo(): boolean { return this.historyIndex >= 0 && this.historyIndex < this.snapshots.length - 1; }

  undo(): RootState | null {
    if (!this.canUndo()) return null;
    this.historyIndex -= 1;
    this.state = cloneState(this.snapshots[this.historyIndex].state);
    this.version += 1;
    this.notify(this.snapshots[this.historyIndex].action);
    void this.persist();
    return this.getState();
  }

  redo(): RootState | null {
    if (!this.canRedo()) return null;
    this.historyIndex += 1;
    this.state = cloneState(this.snapshots[this.historyIndex].state);
    this.version += 1;
    this.notify(this.snapshots[this.historyIndex].action);
    void this.persist();
    return this.getState();
  }

  snapshot(): StateSnapshot { return cloneState(this.snapshots[this.historyIndex]); }
  getHistory(): StateSnapshot[] { return cloneState(this.snapshots); }

  restore(snapshot: StateSnapshot): RootState {
    this.state = cloneState(snapshot.state);
    this.version = Math.max(this.version + 1, snapshot.version + 1);
    this.recordSnapshot(snapshot.action);
    this.notify(snapshot.action);
    void this.persist();
    return this.getState();
  }

  async hydrate(): Promise<RootState> {
    if (!this.persistence) return this.getState();
    const loaded = await this.persistence.load();
    if (!loaded) return this.getState();
    this.state = cloneState(loaded);
    this.version += 1;
    this.snapshots = [];
    this.historyIndex = -1;
    this.recordSnapshot();
    this.notify();
    return this.getState();
  }

  private recordSnapshot(action?: IAction): void {
    if (this.historyIndex < this.snapshots.length - 1) this.snapshots = this.snapshots.slice(0, this.historyIndex + 1);
    this.snapshots.push({ id: `${this.version}-${this.snapshots.length}`, version: this.version, timestamp: Date.now(), state: cloneState(this.state), action: action ? cloneState(action) : undefined });
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    this.historyIndex = this.snapshots.length - 1;
  }

  private notify(action?: IAction): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state, action));
    this.emitter?.emit('state:changed', { state, action, version: this.version });
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    try { await this.persistence.save(this.getState(), this.version); } catch { /* persistence failures do not corrupt state */ }
  }
}
