import { BaseEngine, EngineConfigSchema } from '@ai-creative-studio/core';
import { RuntimeStateStore, type StatePersistenceAdapter, type StateReducer } from './runtimeStore.js';
import { createInitialState, type RootState } from './store.js';
import { z } from 'zod';

const StateConfigSchema = EngineConfigSchema.extend({
  persistenceEnabled: z.boolean().optional().default(false),
  syncEnabled: z.boolean().optional().default(false),
  maxSnapshots: z.number().int().positive().optional().default(100),
});
type StateConfig = z.infer<typeof StateConfigSchema>;

export class StateEngine extends BaseEngine {
  private readonly stateStore: RuntimeStateStore;
  private readonly persistenceEnabled: boolean;
  private readonly syncEnabled: boolean;

  constructor(config: StateConfig, options: { initialState?: RootState; reducer?: StateReducer; persistence?: StatePersistenceAdapter } = {}) {
    const parsed = StateConfigSchema.parse(config);
    super(parsed);
    this.persistenceEnabled = parsed.persistenceEnabled;
    this.syncEnabled = parsed.syncEnabled;
    this.stateStore = new RuntimeStateStore(options.initialState ?? createInitialState(), options.reducer, {
      maxSnapshots: parsed.maxSnapshots,
      persistence: this.persistenceEnabled ? options.persistence : undefined,
    });
  }

  protected async onInitialize(): Promise<void> {
    if (this.persistenceEnabled) await this.stateStore.hydrate();
  }

  getStore(): RuntimeStateStore { return this.stateStore; }

  getCapabilities(): string[] {
    const capabilities = ['state-management','undo-redo','snapshots','versioning'];
    if (this.persistenceEnabled) capabilities.push('persistence');
    if (this.syncEnabled) capabilities.push('sync-configured');
    return capabilities;
  }
}

export * from './store.js';
export * from './actions.js';
export * from './selectors.js';
export * from './runtimeStore.js';
