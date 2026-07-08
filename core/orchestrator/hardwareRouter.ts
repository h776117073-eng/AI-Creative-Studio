import { CreativeTask, TaskGraph } from './intentParser';

export interface HardwareProfile { cpuCores: number; ramGb: number; gpu?: { supported: boolean; adapter?: string; estimatedVramGb: number }; downlinkMbps: number; }
export type RouteTarget = 'local' | 'cloud';
export interface RoutedTask extends CreativeTask { route: RouteTarget; reason: string; }

export async function evaluateHardware(): Promise<HardwareProfile> {
  const nav = globalThis.navigator as any;
  const gpu = nav?.gpu ? { supported: true, adapter: 'webgpu', estimatedVramGb: 4 } : { supported: false, estimatedVramGb: 0 };
  return { cpuCores: nav?.hardwareConcurrency ?? 2, ramGb: nav?.deviceMemory ?? 4, gpu, downlinkMbps: nav?.connection?.downlink ?? 10 };
}

export function routeTask(task: CreativeTask, profile: HardwareProfile): RoutedTask {
  const localCapable = task.difficulty <= 4 && profile.ramGb >= 4 && profile.cpuCores >= 4;
  if (localCapable) return { ...task, route: 'local', reason: 'small task fits local CPU/RAM profile' };
  return { ...task, route: 'cloud', reason: task.difficulty > 4 ? 'heavy task requires cloud GPU' : 'local hardware below safety threshold' };
}

export function routeGraph(graph: TaskGraph, profile: HardwareProfile): RoutedTask[] { return graph.tasks.map(task => routeTask(task, profile)); }

export async function withCloudFallback<T>(localRun: () => Promise<T>, cloudRun: (serializedChunk: string) => Promise<T>, assetChunk: unknown): Promise<T> {
  try { return await localRun(); } catch (error) { return cloudRun(JSON.stringify({ assetChunk, recoveredFrom: error instanceof Error ? error.message : String(error) })); }
}
