import type { ITimelineState } from './index.js';

export interface TimelineTransaction<T = unknown> {
  id: string;
  label: string;
  before: ITimelineState;
  after: ITimelineState;
  metadata?: T;
  timestamp: number;
}

export class TimelineHistory<T = unknown> {
  private entries: Array<TimelineTransaction<T>> = [];
  private cursor = -1;
  constructor(private readonly limit = 100) {}

  get length(): number { return this.entries.length; }
  get index(): number { return this.cursor; }
  get canUndo(): boolean { return this.cursor >= 0; }
  get canRedo(): boolean { return this.cursor < this.entries.length - 1; }

  commit(label: string, before: ITimelineState, after: ITimelineState, metadata?: T): TimelineTransaction<T> {
    if (this.cursor < this.entries.length - 1) this.entries.splice(this.cursor + 1);
    const tx: TimelineTransaction<T> = { id: randomId(), label, before: structuredClone(before), after: structuredClone(after), metadata, timestamp: Date.now() };
    this.entries.push(tx);
    if (this.entries.length > this.limit) this.entries.shift();
    this.cursor = this.entries.length - 1;
    return tx;
  }

  undo(current: ITimelineState): ITimelineState | null {
    if (!this.canUndo) return null;
    const tx = this.entries[this.cursor];
    this.cursor -= 1;
    return structuredClone(tx.before ?? current);
  }

  redo(current: ITimelineState): ITimelineState | null {
    if (!this.canRedo) return null;
    const tx = this.entries[this.cursor + 1];
    this.cursor += 1;
    return structuredClone(tx.after ?? current);
  }

  clear(): void { this.entries = []; this.cursor = -1; }
  snapshot(): Array<TimelineTransaction<T>> { return structuredClone(this.entries); }
}

export function applyTransaction(current: ITimelineState, transaction: TimelineTransaction, direction: 'undo' | 'redo'): ITimelineState {
  return structuredClone(direction === 'undo' ? transaction.before : transaction.after);
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
