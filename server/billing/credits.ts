export type Tier = 'free' | 'pro' | 'enterprise';
export interface Account { id: string; tenantId: string; tier: Tier; credits: number; lockedCredits: number; }
export interface CloudJob { id: string; tenantId: string; userId: string; kind: 'ai_inference' | 'cloud_render' | 'export'; estimatedSeconds: number; gpuClass?: 'cpu' | 't4' | 'a10' | 'a100'; }
export function estimateCredits(job: CloudJob): number {
  const multiplier = job.kind === 'cloud_render' ? 3 : job.kind === 'export' ? 2 : 1;
  const gpu = job.gpuClass === 'a100' ? 10 : job.gpuClass === 'a10' ? 5 : job.gpuClass === 't4' ? 2 : 1;
  return Math.ceil((job.estimatedSeconds / 60) * multiplier * gpu);
}
export function lockCredits(account: Account, job: CloudJob): Account {
  const cost = estimateCredits(job);
  if (account.credits - account.lockedCredits < cost) throw new Error('INSUFFICIENT_CREDITS');
  return { ...account, lockedCredits: account.lockedCredits + cost };
}
export function settleCredits(account: Account, job: CloudJob, success: boolean): Account {
  const cost = estimateCredits(job);
  return success ? { ...account, credits: account.credits - cost, lockedCredits: Math.max(0, account.lockedCredits - cost) } : { ...account, lockedCredits: Math.max(0, account.lockedCredits - cost) };
}
