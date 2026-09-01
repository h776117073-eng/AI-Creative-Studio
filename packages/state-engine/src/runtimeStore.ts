import type { EventEmitter } from 'eventemitter3';
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

export type StateReducer = (state: RootState, action: IAction) => RootState;
export type StateListener = (state: RootState, action?: IAction) => void;

export class RuntimeStateStore {
  private state: RootState;
  private readonly reducer: StateReducer;
  private readonly maxSnapshots: number;
  private snapshots: StateSnapshot[] = [];
  private historyIndex = -1;
  private version = 0;
  private listeners = new Set<StateListener>();
  private emitter?: EventEmitter<any>;
  private persistence?: StatePersistenceAdapter;

  constructor(
    initialState: RootState,
    reducer: StateReducer = (state) => state,
    options: { maxSnapshots?: number; emitter?: EventEmitter<any>; persistence?: StatePersistenceAdapter } = {},
  ) {
    this.state = initialState;
    this.reducer = reducer;
    this.maxSnapshots = Math.max(1, options.maxSnapshots ?? 100);
    this.emitter = options.emitter;
    this.persistence = options.persistence;
    this.recordSnapshot();
  }

  getState(): RootState {
    return this.state;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setState(next: RootState, action?: IAction): RootState {
    this.state = next;
    this.version += 1;
    this.recordSnapshot(action);
    this.notify(action);
    void this.persist();
    return this.state;
  }

  dispatch(action: IAction): RootState {
    const next = this.reducer(this.state, action);
    if (next === this.state) return this.state;
    return this.setState(next, action);
  }

  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  canRedo(): boolean {
    return this.historyIndex >= 0 && this.historyIndex < this.snapshots.length - 1;
  }

  undo(): RootState | null {
    if (!this.canUndo()) return null;
    this.historyIndex -= 1;
    const snapshot = this.snapshots[this.historyIndex];
    this.state = snapshot.state;
    this.version += 1;
    this.notify(snapshot.action);
    return this.state;
  }

  redo(): RootState | null {
    if (!this.canRedo()) return null;
    this.historyIndex += 1;
    const snapshot = this.snapshots[this.historyIndex];
    this.state = snapshot.state;
    this.version += 1;
    this.notify(snapshot.action);
    return this.state;
  }

  snapshot(): StateSnapshot {
    return this.snapshots[this.historyIndex];
  }

  restore(snapshot: StateSnapshot): RootState {
    this.state = snapshot.state;
    this.version = Math.max(this.version, snapshot.version);
    this.notify(snapshot.action);
    void this.persist();
    return this.state;
  }

  getHistory(): StateSnapshot[] {
    return [...this.snapshots];
  }

  async hydrate(): Promise<RootState> {
    if (!this.persistence) return this.state;
    const loaded = await this.persistence.load();
    if (!loaded) return this.state;
    this.state = loaded;
    this.version += 1;
    this.snapshots = [];
    this.historyIndex = -1;
    this.recordSnapshot();
    this.notify();
    return this.state;
  }

  private recordSnapshot(action?: IAction): void {
    if (this.historyIndex < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.historyIndex + 1);
    }
    this.snapshots.push({
      id: `${this.version}-${this.snapshots.length}`,
      version: this.version,
      timestamp: Date.now(),
      state: this.state,
      action,
    });
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    this.historyIndex = this.snapshots.length - 1;
  }

  private notify(action?: IAction): void {
    this.listeners.forEach(listener => listener(this.state, action));
    this.emitter?.emit('state:changed', { state: this.state, action, version: this.version });
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    try {
      await this.persistence.save(this.state, this.version);
    } catch {
      // Persistence is best-effort; state transitions remain deterministic.
    }
  }
}
