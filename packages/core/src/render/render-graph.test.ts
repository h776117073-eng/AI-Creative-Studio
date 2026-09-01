import { describe, expect, it } from 'vitest';
import { normalizeRenderGraph } from './render-graph.js';

describe('normalizeRenderGraph', () => {
  it('creates a canonical source-to-encode graph for real timeline data', () => {
    const graph = normalizeRenderGraph({
      duration: 3,
      tracks: [{ type:'video', clips:[{ assetId:'a1', name:'clip', duration:3, trimStart:0, trimEnd:3, speed:8, brightness:0, contrast:1, saturation:1, effects:[], keyframes:[] }] }],
    }, { width:1920, height:1080, frameRate:60 });
    expect(graph.width).toBe(1920);
    expect(graph.height).toBe(1080);
    expect(graph.frameRate).toBe(60);
    expect(graph.nodes.map(n => n.type)).toEqual(expect.arrayContaining(['source','decode','crop','retime','transform','color','composite','encode']));
    expect(graph.nodes.find(n => n.type === 'retime')?.params.speed).toBe(8);
    expect(graph.diagnostics).toEqual([]);
  });

  it('does not silently claim unsupported effects or transitions are implemented', () => {
    const graph = normalizeRenderGraph({
      duration: 2,
      tracks: [{ type:'video', clips:[{ assetId:'a1', name:'clip', duration:2, trimStart:0, trimEnd:2, effects:['tracking'], transitionOut:{type:'wipe',duration:.5} }] }],
    });
    expect(graph.nodes.some(n => n.status === 'unsupported')).toBe(true);
    expect(graph.diagnostics.some(d => d.includes('effect'))).toBe(true);
    expect(graph.diagnostics.some(d => d.includes('composite'))).toBe(true);
  });
});
