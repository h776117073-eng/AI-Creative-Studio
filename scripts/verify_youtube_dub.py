#!/usr/bin/env python3
"""Independent post-render QA for the Arabic dubbing MP4."""
import hashlib,json,re,subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
ROOT=Path("/content/youtube_arabic_dub"); WORK=ROOT/"work"; CLIPS=WORK/"clips"
FINAL=ROOT/"eSskYhfTWZ0_Arabic_Dub.mp4"; SOURCE=WORK/"source.mp4"
def fail(msg):
 print("VERIFICATION_STATUS=FAIL: "+str(msg),flush=True); raise SystemExit(2)
def readj(p):
 if not p.is_file() or not p.stat().st_size: fail("Missing JSON: "+str(p))
 try: return json.loads(p.read_text(encoding="utf-8"))
 except Exception as e: fail("Invalid JSON "+str(p)+": "+str(e))
def run(cmd): return subprocess.run(cmd,check=True,capture_output=True,text=True).stdout
def probe(p): return json.loads(run(["ffprobe","-v","error","-show_format","-show_streams","-of","json",str(p)]))
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(8*1024*1024),b""): h.update(b)
 return h.hexdigest()
def st(v):
 h,m,s=v.split(":"); q,ms=s.split(","); return int(h)*3600+int(m)*60+int(q)+int(ms)/1000
def main():
 progress=readj(ROOT/"progress.json"); report=readj(ROOT/"quality_report.json")
 asr=readj(WORK/"asr.json"); spk=readj(WORK/"speaker_profiles.json"); trans=readj(WORK/"arabic_segments.json")
 if progress.get("stage")!="complete" or progress.get("status")!="FINAL_VERIFIED": fail("Pipeline stage/status is incomplete")
 if report.get("status")!="FINAL_VERIFIED": fail("Quality report not final-verified")
 for p in (SOURCE,FINAL,ROOT/"Arabic_word_timed_subtitles.srt"):
  if not p.is_file() or p.stat().st_size<1024: fail("Missing or truncated "+p.name)
 if FINAL.stat().st_size<SOURCE.stat().st_size*.75: fail("Final MP4 too small vs source")
 if FINAL.stat().st_size!=report.get("final_size_bytes"): fail("Final size does not match report")
 digest=sha(FINAL)
 if digest!=report.get("final_sha256"): fail("Final SHA-256 does not match report")
 src=probe(SOURCE); out=probe(FINAL)
 sv=next((x for x in src["streams"] if x.get("codec_type")=="video"),None)
 ov=next((x for x in out["streams"] if x.get("codec_type")=="video"),None)
 oa=next((x for x in out["streams"] if x.get("codec_type")=="audio"),None)
 if not sv or not ov or not oa: fail("Final video or audio stream missing")
 if [sv.get("width"),sv.get("height"),sv.get("codec_name")] != [ov.get("width"),ov.get("height"),ov.get("codec_name")]: fail("Original video stream not preserved")
 if oa.get("codec_name")!="aac": fail("Final audio is not AAC")
 srcdur=float(src["format"]["duration"]); dur=float(out["format"]["duration"])
 if abs(dur-srcdur)>max(3,srcdur*.001): fail("Final duration differs from source")
 srt=(ROOT/"Arabic_word_timed_subtitles.srt").read_text(encoding="utf-8-sig"); cues=[]
 for block in re.split(r"\n\s*\n",srt.strip()):
  lines=[x.strip() for x in block.splitlines() if x.strip()]
  if len(lines)<3 or "-->" not in lines[1]: continue
  try:
   a,b=[x.strip() for x in lines[1].split("-->",1)]; cues.append((st(a),st(b)," ".join(lines[2:])))
  except Exception: continue
 if len(cues)<100: fail("Too few word-timed subtitle cues")
 if any(a<0 or b<=a or b>dur+5 for a,b,_ in cues): fail("Subtitle timings invalid/out of range")
 arabic=sum(1 for _,_,t in cues for c in t if "\u0600"<=c<="\u06ff")
 if arabic<100: fail("Subtitle text does not contain sufficient Arabic script")
 segs=trans.get("segments",[]); profiles=spk.get("profiles",{})
 if not segs or not profiles: fail("ASR/translation or speaker profiles missing")
 if len(segs)!=int(report.get("segments_translated_and_voiced",-1)): fail("Translated segment count mismatch")
 if len(profiles)!=int(report.get("speaker_count",0)): fail("Speaker count mismatch")
 tts_cov=sum(bool(x.get("tts_words")) for x in segs)/max(1,len(segs))
 if tts_cov<.80: fail("TTS word-boundary coverage too low")
 wavs=[]
 for item in segs:
  p=CLIPS/f"{int(item['index']):06d}.wav"
  if p.is_file() and p.stat().st_size>500 and sf.info(str(p)).duration>.15: wavs.append((item,p))
 clip_cov=len(wavs)/max(1,len(segs))
 if clip_cov<.95: fail("Synthesized voice clip coverage too low")
 ready=[x for x in wavs if x[0].get("tts_words")]
 if len(ready)<3: fail("Not enough clips for three point review")
 chosen=[ready[0],ready[len(ready)//2],ready[-1]]
 review=ROOT/"post_render_review"; frames=review/"frames"; aud=review/"audio"
 frames.mkdir(parents=True,exist_ok=True); aud.mkdir(parents=True,exist_ok=True); samples=[]
 for label,(item,voicefile) in zip(("start","middle","end"),chosen):
  t=max(0,min(dur-12,float(item["start"])))
  frame=frames/f"{label}.jpg"; mixed=aud/f"{label}_mixed.wav"; voice=aud/f"{label}_voice.wav"
  run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",f"{min(dur-1,t+1):.3f}","-i",str(FINAL),"-frames:v","1","-vf","scale=960:-2","-q:v","3",str(frame)])
  run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",f"{t:.3f}","-i",str(FINAL),"-t","10","-vn","-ac","1","-ar","24000","-c:a","pcm_s16le",str(mixed)])
  run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(voicefile),"-t","10","-ac","1","-ar","24000","-c:a","pcm_s16le",str(voice)])
  mx,_=sf.read(str(mixed),dtype="float32"); vx,_=sf.read(str(voice),dtype="float32")
  mr=float(np.sqrt(np.mean(mx**2))) if len(mx) else 0; vr=float(np.sqrt(np.mean(vx**2))) if len(vx) else 0
  if vr<.001: fail("Synthesized voice sample is silent: "+label)
  samples.append({"label":label,"segment_index":int(item["index"]),"speaker_id":item.get("speaker_id"),
   "time_seconds":float(item["start"]),"mixed_audio_rms":mr,"voice_audio_rms":vr,
   "frame":str(frame.relative_to(ROOT)),"mixed_audio":str(mixed.relative_to(ROOT)),"voice_audio":str(voice.relative_to(ROOT))})
 qa={"status":"POST_RENDER_QA_PASSED","final_file":FINAL.name,"final_size_bytes":FINAL.stat().st_size,"final_sha256":digest,
  "source_duration_seconds":srcdur,"final_duration_seconds":dur,"video_codec":ov.get("codec_name"),"audio_codec":oa.get("codec_name"),
  "resolution":[ov.get("width"),ov.get("height")],"source_language":asr.get("language"),
  "asr_segments":len(asr.get("segments",[])),"translated_segments":len(segs),"speaker_count":len(profiles),
  "word_timed_subtitle_cues":len(cues),"arabic_script_characters":arabic,"tts_word_boundary_coverage":tts_cov,
  "generated_voice_clip_coverage":clip_cov,"generated_voice_clip_count":len(wavs),"visual_track_preserved":True,
  "visual_lip_sync_performed":False,
  "visual_lip_sync_note":"The original video frames are preserved; mouth motion is not edited. Samples assess visual integrity, not lip synchronization.",
  "samples":samples}
 (ROOT/"post_render_qa.json").write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding="utf-8")
 print(json.dumps(qa,ensure_ascii=False,indent=2),flush=True); print("VERIFICATION_STATUS=PASS",flush=True)
if __name__=="__main__":
 try: main()
 except SystemExit: raise
 except Exception as e:
  print(f"VERIFICATION_STATUS=FAIL: {type(e).__name__}: {e}",flush=True); raise
