#!/usr/bin/env python3
from __future__ import annotations
import collections, hashlib, json, math, os, re, subprocess, time, zipfile
from difflib import SequenceMatcher
from pathlib import Path
import requests
import gdown

ROOT=Path("/content/missing_audio_audit")
ASSETS=ROOT/"assets"
VOICES=ROOT/"voices"
OUT=ROOT/"output"
FRAMES=OUT/"frames"
EVIDENCE=Path("/content/evidence")
ROOT.mkdir(parents=True,exist_ok=True); ASSETS.mkdir(exist_ok=True); VOICES.mkdir(exist_ok=True); OUT.mkdir(exist_ok=True); FRAMES.mkdir(exist_ok=True)

ASSET_SPECS = {
 "source": ("13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-", "source_chinese.mkv", 846325293, "d57fd6fb3dd405306594d018b05e9a46"),
 "current_dub": ("15MkBM0m9YduRz4pim2Stp_9ruW5XbqKw", "current_dub.mkv", 971090724, "b821044fc85e479ee85704b8ce2b1048"),
 "reports": ("1mVJpaVrR0Y9ikfeX_lynBCVwDBoUemxV", "reports.zip", 197507, "e4682ad7721647bcf582d9fa222f7d08"),
 "voice_archive": ("1kW388RgJNpoVCFEE8HRU18x4sX250bBf", "voices_06_10.zip", 38683364, "1ce43ef182b35a683b7b2c2e21440639"),
}
INDIVIDUAL = [
 ("01_لي_يانغ_Leda.wav","1mrtadf_yTJtk9vv2OIEqCSyhi-O_VJjA",17743026,"51ab65c25b156a5f02ce33309eab0afc"),
 ("02_لو_مينغ_Achird.wav","1n-E4VaPurnlbvaT5V_5taMXNHaGC8Ipl",14792144,"0e5ef658f37fbfd4d86a5a680b69530c"),
 ("03_تشوانغ_شيان_يوي_Kore.wav","10cFLVZkb79xhYlBIYatBn_6s2hOjc4Os",13408692,"5f73dd97def25a76f88529f4b82f81dc"),
 ("04_فو_شاوتشينغ_Puck.wav","1ZGttKXDYt6lzCtcCYU_2qr84ZgPXHDJq",6129236,"a0be0cce98a1c627a34dd18061160b24"),
 ("05_شيا_مو_يان_Zephyr.wav","11HSnZ57lpUBlvztteIXF58FLydtJOD_J",7190128,"3fbc67e2990316a28e2afe1c9c0d5fd7"),
]
TARGET_DURATION=6153.995

def log(s):
 print(time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),s,flush=True)

def digest(path, algo="sha256"):
 h=hashlib.new(algo)
 with path.open("rb") as f:
  for b in iter(lambda:f.read(8*1024*1024),b""): h.update(b)
 return h.hexdigest()

def get_asset(file_id,name,size,md5):
 p=ASSETS/name
 if not p.is_file() or p.stat().st_size!=size or digest(p,"md5")!=md5:
  p.unlink(missing_ok=True)
  log("DOWNLOAD "+name)
  got=gdown.download(id=file_id,output=str(p),quiet=False,resume=True)
  if not got or not p.is_file(): raise RuntimeError("Download failed: "+name)
 if p.stat().st_size!=size or digest(p,"md5")!=md5:
  raise RuntimeError("Size/MD5 verification failed: "+name)
 log("VERIFIED "+name+" bytes="+str(size))
 return p

def load_json_zip(zf, basename):
 hits=[n for n in zf.namelist() if Path(n).name==basename]
 if len(hits)!=1: raise RuntimeError("Expected one "+basename+" in report archive")
 return json.loads(zf.read(hits[0]).decode("utf-8-sig"))

def run(cmd,timeout=900):
 p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,errors="replace",timeout=timeout)
 if p.returncode: raise RuntimeError("Command failed: "+" ".join(map(str,cmd[:8]))+"\n"+p.stdout[-2500:])
 return p.stdout

def clean_ar(s):
 s=re.sub(r"[\u064B-\u065F\u0670\u0640]","",str(s or ""))
 s=re.sub(r"[إأآا]","ا",s); s=re.sub(r"[ىي]","ي",s); s=re.sub(r"[ةه]","ه",s)
 s=re.sub(r"[^\w\u0600-\u06ff\s]"," ",s)
 return " ".join(s.lower().split())

def grams(s,n=3):
 s=clean_ar(s).replace(" ","")
 return set(s[i:i+n] for i in range(max(0,len(s)-n+1)))

def similarity(a,b):
 a,b=clean_ar(a),clean_ar(b)
 if not a or not b:return 0.0
 seq=SequenceMatcher(None,a,b).ratio()
 aa,bb=set(a.split()),set(b.split())
 jac=len(aa&bb)/max(1,len(aa|bb))
 ga,gb=grams(a),grams(b)
 gj=len(ga&gb)/max(1,len(ga|gb))
 return 0.25*seq+0.25*jac+0.50*gj

def translate_zh_ar(text,cache):
 if text in cache:return cache[text]
 url="https://translate.googleapis.com/translate_a/single"
 last=None
 for attempt in range(4):
  try:
   r=requests.get(url,params={"client":"gtx","sl":"zh-CN","tl":"ar","dt":"t","q":text},
                  timeout=25,headers={"User-Agent":"Mozilla/5.0"})
   r.raise_for_status()
   d=r.json()
   out="".join(x[0] for x in (d[0] or []) if x and x[0])
   cache[text]=out
   return out
  except Exception as e:
   last=e; time.sleep(1.0*(attempt+1))
 cache[text]=""
 return ""

def transcribe(model,path,language):
 # Decode/resample with ffmpeg and pass a numpy array to faster-whisper.
 # This avoids the PyAV metadata_errors API mismatch seen in the first T4 attempt.
 import soundfile as sf
 path=Path(path)
 tmp=path.with_name(path.stem+".audit16k.wav")
 run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(path),"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",str(tmp)],timeout=300)
 audio,sr=sf.read(str(tmp),dtype="float32")
 if sr!=16000: raise RuntimeError("Unexpected audit sample rate: "+str(sr))
 segs,info=model.transcribe(audio,language=language,beam_size=5,vad_filter=True,
                            condition_on_previous_text=False)
 rows=[{"start":round(float(s.start),3),"end":round(float(s.end),3),"text":s.text.strip(),
        "avg_logprob":round(float(s.avg_logprob),3),"no_speech_prob":round(float(s.no_speech_prob),3)} for s in segs]
 tmp.unlink(missing_ok=True)
 return rows,{"language":info.language,"language_probability":float(info.language_probability)}

def best_asr_match(rows,target):
 best=(0.0,None,None,"")
 for i in range(len(rows)):
  for n in range(1,min(6,len(rows)-i)+1):
   chunk=rows[i:i+n]
   text=" ".join(x["text"] for x in chunk)
   score=similarity(target,text)
   if score>best[0]:
    best=(score,chunk[0]["start"],chunk[-1]["end"],text)
 return {"similarity":round(best[0],4),"start":best[1],"end":best[2],"text":best[3]}

def group_rows(rows,max_gap=1.35,max_span=26.0):
 by=collections.defaultdict(list)
 for r in rows:
  if r.get("source_speaker_id") and str(r.get("source_text") or "").strip():
   by[r["source_speaker_id"]].append(r)
 out=[]
 for speaker,items in by.items():
  items=sorted(items,key=lambda x:float(x.get("source_start") or 0))
  cur=[]
  for r in items:
   st=float(r.get("source_start") or 0); en=float(r.get("source_end") or 0)
   if cur:
    gap=st-float(cur[-1].get("source_end") or 0)
    span=en-float(cur[0].get("source_start") or 0)
    if gap>max_gap or span>max_span:
     out.append(make_cluster(cur,speaker,"grouped")); cur=[]
   cur.append(r)
  if cur: out.append(make_cluster(cur,speaker,"grouped"))
 return out

def make_cluster(rows,speaker,kind):
 return {
  "source_speaker_id":speaker,
  "source_start":min(float(x["source_start"]) for x in rows),
  "source_end":max(float(x["source_end"]) for x in rows),
  "source_text":" ".join(str(x.get("source_text") or "") for x in rows),
  "rows":rows,"candidate_type":kind
 }

def frame_hash(path):
 from PIL import Image
 im=Image.open(path).convert("L").resize((8,8))
 px=list(im.getdata()); avg=sum(px)/len(px)
 return "".join("1" if x>=avg else "0" for x in px)

def extract_frame(video,t,path):
 path.parent.mkdir(parents=True,exist_ok=True)
 run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",str(max(0,t)),"-i",str(video),
      "-frames:v","1","-vf","scale=320:-1","-q:v","3",str(path)],timeout=120)
 return frame_hash(path)

def extract_audio(video,start,end,path):
 path.parent.mkdir(parents=True,exist_ok=True)
 run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",str(max(0,start)),"-i",str(video),
      "-t",str(max(0.4,end-start)),"-map","0:a:0","-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",str(path)],timeout=180)
 return path

def main():
 import torch
 if not torch.cuda.is_available() or "T4" not in torch.cuda.get_device_name(0).upper():
  raise RuntimeError("This audit requires the standard Colab Tesla T4.")
 log("GPU="+torch.cuda.get_device_name(0))

 assets={}
 for key,(fid,name,size,md5) in ASSET_SPECS.items(): assets[key]=get_asset(fid,name,size,md5)
 individual_paths={}
 for name,fid,size,md5 in INDIVIDUAL:
  individual_paths[name]=get_asset(fid,name,size,md5)
 reports=ASSETS/"reports"
 reports.mkdir(exist_ok=True)
 with zipfile.ZipFile(assets["reports"]) as z:
  bad=z.testzip()
  if bad: raise RuntimeError("Corrupt reports archive: "+bad)
  manifest=load_json_zip(z,"render_manifest.json")
  timing=load_json_zip(z,"voice_line_timing.json")
  mapping=load_json_zip(z,"source_to_arabic_lines.json")
  final_probe=load_json_zip(z,"final_probe.json")
 with zipfile.ZipFile(assets["voice_archive"]) as z:
  bad=z.testzip()
  if bad: raise RuntimeError("Corrupt voice archive: "+bad)
  z.extractall(VOICES)

 voice_paths={}
 for t in timing.get("tracks",[]):
  name=t["track_file"]
  hits=list(VOICES.rglob(name))
  if name in individual_paths: hits=[individual_paths[name]]
  if len(hits)!=1: raise RuntimeError("Voice master resolution failed for "+name)
  voice_paths[t["speaker_id"]]=hits[0]

 rendered={(x.get("speaker_script_id"),int(x.get("utterance_index") or 0)) for x in manifest.get("lines",[])}
 expected={(t["speaker_id"],int(u["utterance_index"])) for t in timing.get("tracks",[]) for u in t.get("utterances",[])}
 missing=sorted(expected-rendered)
 tracks={t["speaker_id"]:t for t in timing.get("tracks",[])}
 utterances={}
 for t in timing.get("tracks",[]):
  for u in t.get("utterances",[]): utterances[(t["speaker_id"],int(u["utterance_index"]))]=u
 log("REPORT expected="+str(len(expected))+" rendered="+str(len(rendered))+" missing="+str(len(missing)))

 from faster_whisper import WhisperModel
 try:
  model=WhisperModel("small",device="cuda",compute_type="float16")
  log("ASR_DEVICE=CUDA_FLOAT16")
 except Exception as e:
  log("ASR_CUDA_UNAVAILABLE_CPU_INT8_FALLBACK="+repr(e))
  model=WhisperModel("small",device="cpu",compute_type="int8")
  log("ASR_DEVICE=CPU_INT8_ON_STANDARD_T4_SESSION")
 voice_asr={}
 for sid,path in voice_paths.items():
  log("TRANSCRIBE_VOICE_MASTER "+sid+" "+path.name)
  rows,meta=transcribe(model,path,"ar")
  voice_asr[sid]={"file":path.name,"bytes":path.stat().st_size,"sha256":digest(path),
                  "meta":meta,"segments":rows}
  (OUT/"voice_asr").mkdir(exist_ok=True)
  (OUT/"voice_asr"/(sid+".json")).write_text(json.dumps(voice_asr[sid],ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

 assignments=mapping.get("assignments",[])
 by_key=collections.defaultdict(list)
 for r in assignments:
  if r.get("speaker_script_id") and r.get("speaker_script_id")!="unmatched":
   by_key[(r["speaker_script_id"],int(r.get("utterance_index") or 0))].append(r)
 # Translate grouped source segments once, then rank against every missing utterance.
 clusters=group_rows([r for r in assignments if r.get("speaker_script_id")=="unmatched"])
 cache={}
 log("TRANSLATE_SOURCE_CLUSTERS count="+str(len(clusters)))
 for i,c in enumerate(clusters):
  c["arabic_translation"]=translate_zh_ar(c["source_text"],cache)
  if i and i%50==0: log("TRANSLATED_CLUSTERS="+str(i)+"/"+str(len(clusters)))
 (OUT/"translation_cache.json").write_text(json.dumps(cache,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

 # Add exact-key groups, preserving separate source fragments and avoiding the old min/max collapse.
 exact_clusters=[]
 for key in missing:
  rows=by_key.get(key,[])
  if rows:
   for c in group_rows(rows,max_gap=2.0,max_span=30.0):
    c["candidate_type"]="exact_key_assignment"
    c["arabic_translation"]=translate_zh_ar(c["source_text"],cache)
    exact_clusters.append(c)

 dominant={}
 for sid in tracks:
  cnt=collections.Counter(r.get("source_speaker_id") for r in assignments
                          if r.get("speaker_script_id")==sid and r.get("source_speaker_id"))
  dominant[sid]=cnt.most_common(2)

 full_transcript={}
 p=EVIDENCE/"return"/"full_transcript.json"
 if not p.is_file(): p=EVIDENCE/"full_transcript.json"
 if p.is_file():
  full_transcript=json.loads(p.read_text(encoding="utf-8"))
 alt_segments=full_transcript.get("segments",[])
 probe_report={}
 pp=EVIDENCE/"return"/"probe_report.json"
 if not pp.is_file(): pp=EVIDENCE/"probe_report.json"
 if pp.is_file(): probe_report=json.loads(pp.read_text(encoding="utf-8"))

 results=[]
 for key in missing:
  sid,idx=key; u=utterances[key]; target=str(u.get("text") or "")
  voice_rows=voice_asr[sid]["segments"]
  track_start=u.get("track_start_seconds"); track_end=u.get("track_end_seconds")
  if track_start is not None and track_end is not None and float(track_end)>float(track_start):
   near=[r for r in voice_rows if r["end"]>=float(track_start)-0.6 and r["start"]<=float(track_end)+0.6]
   voice_match={"similarity":round(similarity(target," ".join(x["text"] for x in near)),4),
                "start":float(track_start),"end":float(track_end),
                "text":" ".join(x["text"] for x in near),"method":"saved_track_timing"}
  else:
   voice_match=best_asr_match(voice_rows,target)
   voice_match["method"]="ASR_search_in_speaker_master"
  voice_duration=(float(voice_match["end"])-float(voice_match["start"])) if voice_match.get("start") is not None else None

  candidates=[]
  pool=clusters+exact_clusters
  for c in pool:
   tr=c.get("arabic_translation") or ""
   sim=similarity(target,tr)
   if sim<0.12: continue
   dur=max(0.1,float(c["source_end"])-float(c["source_start"]))
   dur_fit=(math.exp(-abs(math.log(dur/max(0.1,voice_duration)))) if voice_duration else 0.0)
   exact=1.0 if c.get("candidate_type")=="exact_key_assignment" else 0.0
   prior=1.0 if c["source_speaker_id"] in [x[0] for x in dominant.get(sid,[])] else 0.0
   score=0.68*sim+0.16*dur_fit+0.10*exact+0.06*prior
   overlap=[]
   for old in manifest.get("lines",[]):
    if old.get("speaker_script_id")==sid and int(old.get("utterance_index") or 0)==idx: continue
    ov=max(0.0,min(float(c["source_end"]),float(old["source_end"]))-max(float(c["source_start"]),float(old["source_start"])))
    if ov>0.5: overlap.append({"speaker":old.get("speaker_script_id"),"utterance":old.get("utterance_index"),
                                "start":old.get("source_start"),"end":old.get("source_end"),"overlap":round(ov,2)})
   candidates.append({
    "score":round(score,4),"translation_similarity":round(sim,4),"duration_fit":round(dur_fit,4),
    "exact_key_assignment":bool(exact),"source_speaker_prior":bool(prior),
    "source_speaker_id":c["source_speaker_id"],"source_start":round(float(c["source_start"]),3),
    "source_end":round(float(c["source_end"]),3),"source_text":c["source_text"],
    "arabic_translation":tr,"candidate_type":c.get("candidate_type"),
    "source_segment_indices":[r.get("source_segment_index") for r in c.get("rows",[])],
    "overlaps_rendered_lines":overlap
   })
  candidates.sort(key=lambda x:x["score"],reverse=True)
  top=candidates[:5]

  alt_text_matches=[]
  for s in alt_segments:
   sc=similarity(target,s.get("text",""))
   if sc>=0.20:
    alt_text_matches.append({"similarity":round(sc,4),"alternate_audio_start":s.get("start"),
                             "alternate_audio_end":s.get("end"),"text":s.get("text"),
                             "warning":"alternate MP4 audio timestamps are NOT source-video timestamps"})
  alt_text_matches=sorted(alt_text_matches,key=lambda x:x["similarity"],reverse=True)[:5]

  results.append({
   "speaker_script_id":sid,"utterance_index":idx,"text":target,
   "voice_master":voice_paths[sid].name,
   "saved_voice_timing":{"start":track_start,"end":track_end},
   "voice_asr_match":voice_match,
   "voice_clip_confident":bool(voice_match.get("similarity",0)>=0.35 and voice_match.get("start") is not None and voice_match.get("end") is not None),
   "dominant_source_speakers":dominant.get(sid,[]),
   "source_candidates":top,
   "alternate_mp4_text_only_matches":alt_text_matches
  })

 # For the top two source candidates per missing line, inspect source audio and frames and compare with current dub.
 qa_model=model
 for item in results:
  item["candidate_checks"]=[]
  for ci,c in enumerate(item["source_candidates"][:2]):
   st=float(c["source_start"]); en=float(c["source_end"])
   if en-st<0.35 or en>6154.5: continue
   pad=0.25
   s_audio=extract_audio(assets["source"],max(0,st-pad),min(6154.0,en+pad),
                        OUT/"samples"/f'{item["speaker_script_id"]}_{item["utterance_index"]}_c{ci}_source.wav')
   d_audio=extract_audio(assets["current_dub"],max(0,st-pad),min(6154.0,en+pad),
                        OUT/"samples"/f'{item["speaker_script_id"]}_{item["utterance_index"]}_c{ci}_dub.wav')
   s_rows,s_meta=transcribe(qa_model,s_audio,"zh")
   d_rows,d_meta=transcribe(qa_model,d_audio,"ar")
   mid=(st+en)/2
   sf=FRAMES/f'{item["speaker_script_id"]}_{item["utterance_index"]}_c{ci}_source.jpg'
   df=FRAMES/f'{item["speaker_script_id"]}_{item["utterance_index"]}_c{ci}_dub.jpg'
   sh=extract_frame(assets["source"],mid,sf); dh=extract_frame(assets["current_dub"],mid,df)
   item["candidate_checks"].append({
    "candidate_index":ci,"source_chinese_asr":" ".join(x["text"] for x in s_rows),
    "current_dub_arabic_asr":" ".join(x["text"] for x in d_rows),
    "source_frame":str(sf),"current_dub_frame":str(df),
    "source_dub_frame_ahash_equal":sh==dh,
    "source_frame_ahash":sh,"current_dub_frame_ahash":dh
   })

 result={
  "status":"missing_audio_audit_complete",
  "source_and_current_dub":{
   "source_bytes":assets["source"].stat().st_size,"source_sha256":digest(assets["source"]),
   "current_dub_bytes":assets["current_dub"].stat().st_size,"current_dub_sha256":digest(assets["current_dub"]),
   "source_duration":float(json.loads(run(["ffprobe","-v","error","-show_entries","format=duration","-of","json",str(assets["source"])]))["format"]["duration"]),
   "current_dub_duration":float(json.loads(run(["ffprobe","-v","error","-show_entries","format=duration","-of","json",str(assets["current_dub"])]))["format"]["duration"])
  },
  "report_counts":{"expected":len(expected),"rendered":len(rendered),"missing":len(missing),
                   "assignments":len(assignments),"unmatched":sum(1 for r in assignments if r.get("speaker_script_id")=="unmatched")},
  "alternate_audio_policy":"The alternate MP4 audio transcript is used only as text corroboration; its timestamps are not used for source-video placement because prior frame checks confirmed video frames but not audio synchronization.",
  "ecapa_policy":"ECAPA similarity is screening only, not proof; no alternate MP4 audio is used as a donor.",
  "missing_utterances":results,
  "render_policy":"No media was modified or rendered in this audit."
 }
 (OUT/"missing_audio_audit.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 (OUT/"voice_master_manifest.json").write_text(json.dumps({
  sid:{"file":x["file"],"bytes":x["bytes"],"sha256":x["sha256"],"segment_count":len(x["segments"])}
  for sid,x in voice_asr.items()
 },ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 log("AUDIT_COMPLETE missing="+str(len(results))+" frames="+str(len(list(FRAMES.glob("*.jpg")))))
 import zipfile as _zipfile
 bundle=OUT/"missing_audio_audit_bundle.zip"
 with _zipfile.ZipFile(bundle,"w",compression=_zipfile.ZIP_DEFLATED,compresslevel=4) as zf:
  for p in OUT.rglob("*"):
   if p.is_file() and p != bundle:
    zf.write(p,p.relative_to(OUT))
 log("BUNDLE_BYTES="+str(bundle.stat().st_size))
 print(json.dumps({"status":result["status"],"missing":len(results),
                   "voice_tracks_transcribed":len(voice_asr),
                   "candidate_checks":sum(len(x["candidate_checks"]) for x in results),
                   "output":str(OUT/"missing_audio_audit.json")},ensure_ascii=False),flush=True)

if __name__=="__main__": main()
