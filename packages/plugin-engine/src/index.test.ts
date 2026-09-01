import { describe, expect, it } from 'vitest';
import { PluginEngine, type IPluginManifest, type IPluginRuntimeAdapter } from './index.js';

const manifest: IPluginManifest = {
  id:'test.plugin', name:'Test Plugin', version:'1.0.0', main:'file:///trusted/test-plugin.js',
  engines:{core:'*'}, permissions:['storage'], extensionPoints:[{id:'ep',name:'Test Extension'}],
};

describe('PluginEngine', () => {
  it('does not advertise loading until a trusted runtime adapter is configured', () => {
    const engine = new PluginEngine({id:'plugins',name:'plugins',version:'1', sandboxEnabled:true,allowRemotePlugins:false,pluginDirectory:'/plugins'});
    expect(engine.getCapabilities()).not.toContain('plugin:load');
  });

  it('loads, activates and uses a supplied trusted adapter', async () => {
    const adapter: IPluginRuntimeAdapter = { load: async (_manifest, context) => ({
      activate: async () => { await context.api.storage.set('ready', true); },
      deactivate: async () => {},
      updateSettings: async () => {},
    }) };
    const engine = new PluginEngine({id:'plugins',name:'plugins',version:'1',sandboxEnabled:true,allowRemotePlugins:false,pluginDirectory:'/plugins'}, {runtimeAdapter:adapter});
    await engine.installPlugin(manifest);
    await engine.activatePlugin(manifest.id);
    expect(engine.getPlugin(manifest.id)?.status).toBe('active');
    expect(engine.getCapabilities()).toContain('plugin:load');
  });
});
