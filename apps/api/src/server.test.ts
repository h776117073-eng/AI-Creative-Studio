import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app, db } from './server.js';

let projectId = '';
const fixture = join(tmpdir(), 'ai-creative-studio-test.mp4');
const audioFixture = join(tmpdir(), 'ai-creative-studio-test.wav');

describe('professional timeline API', () => {
  beforeAll(() => {
    execFileSync('ffmpeg', ['-y','-f','lavfi','-i','color=c=blue:s=640x360:r=30','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',fixture], { stdio:'ignore' });
    execFileSync('ffmpeg', ['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:a','pcm_s16le',audioFixture], { stdio:'ignore' });
  });
  afterAll(() => { db.close(); });

  it('reports health and FFmpeg availability', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.ffmpeg).toBe(true);
    expect(response.body.ffprobe).toBe(true);
  });

  it('creates a mobile-editor timeline with video, audio, text and overlay tracks', async () => {
    const response = await request(app).post('/api/projects').send({ name: 'Professional Timeline Test' });
    expect(response.status).toBe(200);
    projectId = response.body.id;
    expect(response.body.timeline.tracks.map((t: any) => t.type)).toEqual(['video', 'audio', 'text', 'overlay']);
  });

  it('uploads video and external audio into separate tracks', async () => {
    const video = await request(app).post(`/api/projects/${projectId}/upload`).attach('file', fixture);
    expect(video.status).toBe(200);
    const audio = await request(app).post(`/api/projects/${projectId}/upload`).attach('file', audioFixture);
    expect(audio.status).toBe(200);
    expect(audio.body.assets).toHaveLength(2);
    expect(audio.body.timeline.tracks.find((t:any)=>t.type==='video').clips).toHaveLength(1);
    expect(audio.body.timeline.tracks.find((t:any)=>t.type==='audio').clips).toHaveLength(1);
  });

  it('splits exactly at the playhead without inventing a position', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'قسّم هنا', playhead: 1.25, clipId: (await request(app).get(`/api/projects/${projectId}`)).body.timeline.tracks[0].clips[0].id });
    expect(response.status).toBe(200);
    expect(response.body.command.type).toBe('split');
    const clips = response.body.timeline.tracks.find((t:any)=>t.type==='video').clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].endTime).toBeCloseTo(1.25, 2);
    expect(clips[1].startTime).toBeCloseTo(1.25, 2);
  });

  it('applies volume immediately and supports mute', async () => {
    const project = await request(app).get(`/api/projects/${projectId}`);
    const clipId = project.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].id;
    const volume = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'اجعل الصوت 70%', playhead: 1, clipId });
    expect(volume.status).toBe(200);
    expect(volume.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].volume).toBeCloseTo(0.7, 2);
    const mute = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'اكتم الصوت', playhead: 1, clipId });
    expect(mute.status).toBe(200);
    expect(mute.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].volume).toBe(0);
  });

  it('adds text at the playhead and persists it to the Text track', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'أضف نص: مرحباً بالعالم', playhead: 2.2 });
    expect(response.status).toBe(200);
    const textTrack = response.body.timeline.tracks.find((t:any)=>t.type==='text');
    expect(textTrack.clips).toHaveLength(1);
    expect(textTrack.clips[0].text).toBe('مرحباً بالعالم');
    expect(textTrack.clips[0].startTime).toBeCloseTo(2.2, 2);
  });

  it('supports undo and redo after a real edit operation', async () => {
    const before = await request(app).get(`/api/projects/${projectId}`);
    const clipId = before.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].id;
    const edit = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text:'دوّر المقطع 90 درجة', clipId, playhead: 1 });
    expect(edit.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].rotate).toBe(90);
    const undo = await request(app).post(`/api/projects/${projectId}/undo`);
    expect(undo.status).toBe(200);
    const redo = await request(app).post(`/api/projects/${projectId}/redo`);
    expect(redo.status).toBe(200);
    expect(redo.body.timeline.tracks.find((t:any)=>t.type==='video').clips[0].rotate).toBe(90);
  });

  it('renders a real MP4 from the multi-track timeline', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/render`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/video\/mp4/);
    expect(Number(response.headers['content-length'] || 0)).toBeGreaterThan(1000);
  });
});
