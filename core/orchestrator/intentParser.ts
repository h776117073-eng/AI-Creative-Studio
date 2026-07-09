export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the AI-Creative-Studio task compiler. Return only JSON that matches {"tasks":[{"id":"string","type":"silence_detection|captioning|face_tracking|color_grade|object_inpaint|video_generation|cloud_render|export","difficulty":1-10,"args":{}}],"edges":[["from","to"]]}. Decompose creative edits into deterministic timeline operations and media processing jobs.`;

export interface CreativeTask { id: string; type: string; difficulty: number; args: Record<string, unknown>; }
export interface TaskGraph { tasks: CreativeTask[]; edges: Array<[string, string]>; }

export function parseIntentFallback(prompt: string): TaskGraph {
  const tasks: CreativeTask[] = [];
  if (/silence|quiet/i.test(prompt)) tasks.push({ id: 'detect-silence', type: 'silence_detection', difficulty: 2, args: { thresholdDb: -45 } });
  if (/caption|subtitle/i.test(prompt)) tasks.push({ id: 'caption', type: 'captioning', difficulty: 3, args: { model: 'whisper-tiny' } });
  if (/cinematic|tone|grade/i.test(prompt)) tasks.push({ id: 'grade', type: 'color_grade', difficulty: 4, args: { look: 'cinematic' } });
  if (/render|export/i.test(prompt)) tasks.push({ id: 'export', type: 'cloud_render', difficulty: 8, args: {} });
  return { tasks, edges: tasks.slice(1).map((task, index) => [tasks[index].id, task.id]) };
}
