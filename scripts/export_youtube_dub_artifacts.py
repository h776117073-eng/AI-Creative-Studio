#!/usr/bin/env python3
"""Prepare chunked media and reports for retrieval from Colab."""
import hashlib,json,shutil
from pathlib import Path
ROOT=Path("/content/youtube_arabic_dub"); FINAL=ROOT/"eSskYhfTWZ0_Arabic_Dub.mp4"; PARTS=ROOT/"export_parts"; CHUNK=96*1024*1024
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(8*1024*1024),b""): h.update(b)
 return h.hexdigest()
def main():
 candidates=[
 ("quality_report.json",ROOT/"quality_report.json"),("progress.json",ROOT/"progress.json"),("run.log",ROOT/"run.log"),
 ("Arabic_word_timed_subtitles.srt",ROOT/"Arabic_word_timed_subtitles.srt"),("post_render_qa.json",ROOT/"post_render_qa.json"),
 ("work/speaker_profiles.json",ROOT/"work"/"speaker_profiles.json"),("work/asr.json",ROOT/"work"/"asr.json"),
 ("work/arabic_segments.json",ROOT/"work"/"arabic_segments.json"),
 ("post_render_review/frames/start.jpg",ROOT/"post_render_review"/"frames"/"start.jpg"),
 ("post_render_review/frames/middle.jpg",ROOT/"post_render_review"/"frames"/"middle.jpg"),
 ("post_render_review/frames/end.jpg",ROOT/"post_render_review"/"frames"/"end.jpg"),
 ("post_render_review/audio/start_mixed.wav",ROOT/"post_render_review"/"audio"/"start_mixed.wav"),
 ("post_render_review/audio/middle_mixed.wav",ROOT/"post_render_review"/"audio"/"middle_mixed.wav"),
 ("post_render_review/audio/end_mixed.wav",ROOT/"post_render_review"/"audio"/"end_mixed.wav"),
 ("post_render_review/audio/start_voice.wav",ROOT/"post_render_review"/"audio"/"start_voice.wav"),
 ("post_render_review/audio/middle_voice.wav",ROOT/"post_render_review"/"audio"/"middle_voice.wav"),
 ("post_render_review/audio/end_voice.wav",ROOT/"post_render_review"/"audio"/"end_voice.wav")]
 files=[{"remote":str(p),"relative":r,"size_bytes":p.stat().st_size} for r,p in candidates if p.is_file() and p.stat().st_size]
 video=None; parts=[]
 if FINAL.is_file() and FINAL.stat().st_size>1_000_000:
  if PARTS.exists(): shutil.rmtree(PARTS)
  PARTS.mkdir(parents=True,exist_ok=True)
  with FINAL.open("rb") as f:
   i=0
   while True:
    data=f.read(CHUNK)
    if not data: break
    name=f"video.part{i:04d}"; p=PARTS/name; p.write_bytes(data)
    parts.append({"name":name,"size_bytes":len(data),"remote":str(p)})
    print(f"Prepared {name}: {len(data)} bytes",flush=True); i+=1
  video={"filename":FINAL.name,"size_bytes":FINAL.stat().st_size,"sha256":sha(FINAL),"parts":parts}
 m={"status":"EXPORT_READY","video":video,"files":files}
 (ROOT/"export_manifest.json").write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding="utf-8")
 print(json.dumps({"video_bytes":video["size_bytes"] if video else None,"parts":len(parts),"small_files":len(files)}),flush=True)
 print("EXPORT_MANIFEST_READY=1",flush=True)
if __name__=="__main__": main()
