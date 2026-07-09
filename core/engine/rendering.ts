import { Timeline, TimelineClip } from '../state/timeline';
import { AbstractCreativeEngine, FrameContext } from '../../plugins/shared/abstractCreativeEngine';

export function timestampToFrame(timestampSeconds: number, fps: number): number { return Math.round(timestampSeconds * fps); }
export function sourceFrameForClip(cursor: number, clip: TimelineClip, fps: number): number {
  const localSeconds = Math.max(0, cursor - clip.timelineStart);
  return timestampToFrame(clip.startOffset + localSeconds * clip.playbackRate, fps);
}

export class LivePreviewMixer {
  private plugins: AbstractCreativeEngine[] = [];
  register(plugin: AbstractCreativeEngine): void { this.plugins.push(plugin); }
  getActiveClips(timeline: Timeline, cursor: number): TimelineClip[] {
    return timeline.tracks
      .filter(track => track.visible && !track.muted)
      .sort((a, b) => a.zIndex - b.zIndex)
      .flatMap(track => track.clips.filter(clip => cursor >= clip.timelineStart && cursor < clip.timelineStart + clip.duration));
  }
  async renderFrame(timeline: Timeline, cursor: number, frameBuffer: ImageBitmap | OffscreenCanvas | unknown): Promise<unknown> {
    let buffer = frameBuffer;
    const context: FrameContext = { timeline, cursor, frame: timestampToFrame(cursor, timeline.fps), activeClips: this.getActiveClips(timeline, cursor) };
    for (const plugin of this.plugins) buffer = await plugin.processFrame(buffer, context);
    return buffer;
  }
}

export interface ExportProfile { codec: 'h264' | 'h265'; container: 'mp4'; resolution: '1080p' | '4k'; multipass: boolean; bitrateMbps: number; }
export function buildFfmpegArgs(profile: ExportProfile, inputManifestPath: string, outputPath: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', inputManifestPath, '-c:v', profile.codec === 'h265' ? 'libx265' : 'libx264', '-b:v', `${profile.bitrateMbps}M`, ...(profile.multipass ? ['-pass', '1'] : []), '-movflags', '+faststart', outputPath];
}
