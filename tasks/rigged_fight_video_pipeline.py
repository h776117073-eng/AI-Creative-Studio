#!/usr/bin/env python3
"""Rigged two-character fight-video pipeline.

Consumes the previously audited AL-DIDAH v2 pose tracks, the exact source video,
and the published rigged GLB assets. Selects the strongest continuous two-person
action window, retargets COCO-17 observations to the SMPL22 rig controls in Blender,
renders a real 3D MP4, preserves source audio, creates a reference comparison,
and validates the files before publishing a GitHub Release.
"""
from __future__ import annotations
import csv, gzip, json, math, os, pathlib, shutil, subprocess, sys, time, zipfile, hashlib, re
from itertools import combinations
from datetime import datetime, timezone
import requests

OWNER="h776117073-eng"
REPO="AI-Creative-Studio"
SOURCE_VIDEO_ID="1ygz0hzQNH70VsP8-2DCSFO9OFPg7JB4_"
ANALYSIS_RELEASE="al-didah-production-v2"
CHAR_RELEASE="character-assets-20261118-013832"
CHAR_ASSETS={
 "CHAR_01":f"https://github.com/{OWNER}/{REPO}/releases/download/{CHAR_RELEASE}/CHAR_01_SMPL22_rigged.glb",
 "CHAR_02":f"https://github.com/{OWNER}/{REPO}/releases/download/{CHAR_RELEASE}/CHAR_02_SMPL22_rigged.glb",
}
ANALYSIS_ZIP_URL=f"https://github.com/{OWNER}/{REPO}/releases/download/{ANALYSIS_RELEASE}/AL-DIDAH-production-v2.zip"
BASE=pathlib.Path("/content/rigged_fight_production")
INPUT=BASE/"inputs"; WORK=BASE/"work"; OUT=BASE/"outputs"
FPS_OUT=24
SEGMENT_SECONDS=4.0
RENDER_WIDTH=1280
RENDER_HEIGHT=720
ORTHO_WIDTH=12.0
MIN_KEYPOINTS=9
CONF_MIN=0.12
MAX_CRF=28

def log(msg):
 print(f"[rigged-fight] {datetime.now(timezone.utc).isoformat()} {msg}",flush=True)

def run(cmd,check=True,timeout=1800):
 log("$ "+" ".join(map(str,cmd))[:500])
 p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 if p.stdout: print(p.stdout[-7000:],flush=True)
 if check and p.returncode:
  raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(map(str,cmd))}\n{p.stdout[-3000:]}")
 return p

def sha256(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
 return h.hexdigest()

def download(url,path):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.is_file() and path.stat().st_size>1000: return path
 log(f"Downloading {path.name}")
 with requests.get(url,stream=True,timeout=(30,240)) as r:
  r.raise_for_status()
  with path.open("wb") as f:
   for chunk in r.iter_content(1024*1024):
    if chunk: f.write(chunk)
 if path.stat().st_size<1000: raise RuntimeError(f"Downloaded file is unexpectedly small: {path}")
 return path

def get_inputs():
 INPUT.mkdir(parents=True,exist_ok=True); WORK.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
 import gdown
 video=INPUT/"reference_source.mp4"
 if not video.exists() or video.stat().st_size<1_000_000:
  log("Downloading the registered reference video from its configured Drive ID.")
  result=gdown.download(id=SOURCE_VIDEO_ID,output=str(video),quiet=False,fuzzy=True)
  if not result or not video.exists() or video.stat().st_size<1_000_000:
   raise RuntimeError("The registered reference video could not be retrieved from Drive; refusing to substitute an unrelated YouTube video.")
 analysis_zip=download(ANALYSIS_ZIP_URL,INPUT/"AL-DIDAH-production-v2.zip")
 analysis_dir=INPUT/"analysis"
 if not (analysis_dir/"outputs"/"pose_tracks.jsonl.gz").is_file():
  analysis_dir.mkdir(parents=True,exist_ok=True)
  with zipfile.ZipFile(analysis_zip) as z:
   for item in z.infolist():
    dest=(analysis_dir/item.filename).resolve()
    if analysis_dir.resolve() not in dest.parents and dest!=analysis_dir.resolve():
     raise RuntimeError("Unsafe path detected in analysis archive.")
   z.extractall(analysis_dir)
 pose=analysis_dir/"outputs"/"pose_tracks.jsonl.gz"
 catalog=analysis_dir/"outputs"/"track_quality_candidates.csv"
 metadata=analysis_dir/"outputs"/"video_metadata.json"
 if not pose.exists() or not metadata.exists():
  raise RuntimeError("The AL-DIDAH v2 archive is missing pose_tracks.jsonl.gz or video_metadata.json.")
 with open(metadata,encoding="utf-8") as f: meta=json.load(f)
 source_probe=json.loads(run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(video)]).stdout)
 vs=[s for s in source_probe["streams"] if s.get("codec_type")=="video"]
 if not vs: raise RuntimeError("Reference source has no video stream.")
 sv=vs[0]
 fps=eval(sv.get("avg_frame_rate","0/1"))
 duration=float(source_probe["format"].get("duration",0))
 if fps<=0 or duration<=0: raise RuntimeError("Reference video metadata is invalid.")
 if abs(fps-float(meta["fps"]))>0.08 or abs(duration-float(meta["duration"]))>2.0:
  raise RuntimeError(f"Source video does not match the analyzed reference: actual {fps:.4f}fps/{duration:.2f}s vs analysis {meta['fps']}fps/{meta['duration']}s.")
 log(f"Reference verified: {meta['frames']} frames, {fps:.3f} FPS, {meta['width']}x{meta['height']}, {duration:.2f}s.")
 assets={}
 for cid,url in CHAR_ASSETS.items():
  path=download(url,INPUT/f"{cid}_SMPL22_rigged.glb")
  with path.open("rb") as f:
   head=f.read(12)
  if head[:4]!=b"glTF" or int.from_bytes(head[4:8],"little")!=2 or int.from_bytes(head[8:12],"little")!=path.stat().st_size:
   raise RuntimeError(f"{cid} GLB failed header/length validation.")
  assets[cid]=path
 log("Both rigged GLB assets passed structural file validation.")
 return video,pose,catalog,meta,assets,fps

def read_candidates(catalog):
 ids=[]
 if catalog.exists():
  with catalog.open(newline="",encoding="utf-8") as f:
   for r in csv.DictReader(f):
    if r.get("candidate_for_manual_review","").lower()=="true":
     ids.append((int(r["track_id"]),float(r.get("candidate_score_heuristic") or 0)))
 ids=sorted(ids,key=lambda x:x[1],reverse=True)
 return [x[0] for x in ids[:20]]

def read_track_data(pose_path,candidate_ids):
 allowed=set(candidate_ids)
 rows={}
 counts={}
 with gzip.open(pose_path,"rt",encoding="utf-8") as f:
  for line in f:
   d=json.loads(line); frame=int(d["frame"]); scene=int(d.get("scene_id",0))
   persons={}
   for p in d.get("persons",[]):
    tid=int(p["track_id"])
    kps=p.get("keypoints") or []
    valid=sum(1 for x in kps if x and float(x.get("confidence",0))>=CONF_MIN)
    if valid<MIN_KEYPOINTS: continue
    p=dict(p); p["_valid"]=valid; p["_scene"]=scene
    persons[tid]=p
    counts[tid]=counts.get(tid,0)+1
   if persons: rows[frame]=(scene,persons)
 if not rows: raise RuntimeError("No candidate pose tracks with sufficient keypoint confidence were found.")
 if not allowed:
  candidate_ids=sorted(counts,key=counts.get,reverse=True)[:12]
 return rows,candidate_ids

def center_and_height(p):
 b=p["bbox"]; return ((float(b[0])+float(b[2]))/2,(float(b[1])+float(b[3]))/2),max(1.0,float(b[3])-float(b[1]))

def activity(p0,p1):
 k0=p0.get("keypoints") or []; k1=p1.get("keypoints") or []
 _,h=center_and_height(p1)
 vals=[]
 for j in (0,5,6,7,8,9,10,13,14,15,16):
  if j>=min(len(k0),len(k1)): continue
  a,b=k0[j],k1[j]
  if a and b and float(a.get("confidence",0))>=CONF_MIN and float(b.get("confidence",0))>=CONF_MIN:
   vals.append(math.hypot(float(b["x"])-float(a["x"]),float(b["y"])-float(a["y"]))/h)
 return sum(vals)/len(vals) if vals else 0.0

def choose_segment(rows,candidate_ids,fps,total_frames,width):
 wanted=max(48,int(round(SEGMENT_SECONDS*fps)))
 possible=[]
 for scene in sorted(set(s for s,_ in rows.values())):
  scene_frames=sorted(f for f,(s,_) in rows.items() if s==scene)
  by_track={}
  for f in scene_frames:
   for tid,p in rows[f][1].items(): by_track.setdefault(tid,{})[f]=p
  # Candidate tracks are a ranking hint, not a hard identity filter. Include other long-lived
  # tracks so two people observed in different shots are not incorrectly treated as a pair.
  all_tids=sorted(by_track,key=lambda t:len(by_track[t]),reverse=True)[:20]
  tids=list(dict.fromkeys([t for t in candidate_ids if t in by_track]+all_tids))
  for a,b in combinations(tids,2):
   common=sorted(set(by_track[a])&set(by_track[b]))
   if len(common)<36: continue
   lo,hi=common[0],common[-1]
   length=min(wanted,hi-lo+1)
   if length<48: continue
   stride=max(4,int(fps//2))
   for start in range(lo,max(lo+1,hi-length+2),stride):
    valid=0; motion=0.; motion_n=0; dist=[]
    for f in range(start,start+length):
     pa=by_track[a].get(f); pb=by_track[b].get(f)
     if pa is None or pb is None: continue
     if pa["_valid"]<MIN_KEYPOINTS or pb["_valid"]<MIN_KEYPOINTS: continue
     valid+=1
     ca,ha=center_and_height(pa); cb,hb=center_and_height(pb)
     dist.append(math.hypot(ca[0]-cb[0],ca[1]-cb[1])/max(1.0,float(width)))
     for tid,track in ((a,by_track[a]),(b,by_track[b])):
      prev=track.get(f-1)
      curr=track.get(f)
      if prev and curr:
       motion+=activity(prev,curr); motion_n+=1
    coverage=valid/length
    if coverage<0.50: continue
    mean_motion=motion/max(1,motion_n)
    mean_distance=sum(dist)/max(1,len(dist))
    score=coverage*2.0+min(mean_motion*10,1.5)+max(0,0.9-mean_distance)*0.25
    possible.append((score,coverage,mean_motion,scene,a,b,start,length))
 if not possible:
  diagnostics=[]
  for scene in sorted(set(s for s,_ in rows.values())):
   sf=sorted(f for f,(s,_) in rows.items() if s==scene); bt={}
   for f in sf:
    for tid,p in rows[f][1].items(): bt.setdefault(tid,set()).add(f)
   ranked=sorted(bt,key=lambda tid:len(bt[tid]),reverse=True)[:12]
   overlaps=sorted([(len(bt[x]&bt[y]),x,y) for x,y in combinations(ranked,2)],reverse=True)[:5]
   diagnostics.append({"scene":scene,"frames":len(sf),"tracks":len(bt),"top_track_counts":{str(t):len(bt[t]) for t in ranked[:8]},"top_pair_overlaps":overlaps})
  log("No eligible segment. Track diagnostics: "+json.dumps(diagnostics[:20]))
  raise RuntimeError("No sufficiently continuous two-person pose window was found; track diagnostics were logged. No arbitrary video was substituted.")
 best=max(possible,key=lambda x:x[0])
 score,coverage,motion,scene,a,b,start,length=best
 log(f"Selected scene {scene}, tracks {a}/{b}, frames {start}-{start+length-1}, coverage {coverage:.3f}, normalized motion {motion:.4f}.")
 selected={}
 for f in range(start,start+length):
  if f in rows and rows[f][0]==scene:
   persons=rows[f][1]
   if a in persons and b in persons: selected[f]=(persons[a],persons[b])
 # Fill each actor independently from its own valid observations; do not let one
 # actor's missing slot overwrite the other actor's track.
 valid_by_actor=[]
 for tidx,tid in enumerate((a,b)):
  valid=[(f,selected[f][tidx]) for f in list(selected) if selected[f][tidx] is not None]
  if not valid: raise RuntimeError(f"Track {tid} has no observations in selected window.")
  valid_by_actor.append(valid)
 for f in range(start,start+length):
  cur=list(selected.get(f,(None,None)))
  for tidx in range(2):
   if cur[tidx] is None:
    valid=valid_by_actor[tidx]
    cur[tidx]=min(valid,key=lambda q:abs(q[0]-f))[1]
  selected[f]=tuple(cur)
 # Restore left/right assignment by screen x at start; no face identity claim.
 first=selected[start]
 centers=[center_and_height(p)[0][0] for p in first]
 if centers[0]<=centers[1]:
  left_id,right_id=a,b
 else:
  left_id,right_id=b,a
 log(f"Screen-space assignment only: CHAR_01 follows left-side track {left_id}; CHAR_02 follows right-side track {right_id}.")
 frames=[]
 for f in range(start,start+length):
  pair=selected[f]
  left=pair[0] if left_id==a else pair[1]
  right=pair[1] if right_id==b else pair[0]
  frames.append({"frame":f,"actors":[normalize_person(left),normalize_person(right)]})
 return {"scene_id":scene,"track_ids":[left_id,right_id],"source_start_frame":start,"source_end_frame":start+length-1,
         "source_start_seconds":start/fps,"duration_seconds":length/fps,"fps":fps,
         "coverage":coverage,"motion_score":motion,"selection_score":score,"assignment_basis":"screen-left/screen-right only; visual identity is not established"},frames

def fresh_pose_tracks(video,source_fps):
 """Re-run higher-capacity pose tracking when the previous v2 tracks do not overlap."""
 from ultralytics import YOLO
 import numpy as np
 log("Previous analysis contains no eligible two-person overlap; starting YOLO11x-Pose + BoT-SORT on the exact reference video at 12 FPS.")
 model=YOLO("yolo11x-pose.pt")
 rows={}; counts={}; frame_idx=0
 stream=model.track(source=str(video),stream=True,persist=True,tracker="botsort.yaml",
                    vid_stride=2,imgsz=960,conf=0.12,iou=0.45,classes=[0],device=0,
                    verbose=False,max_det=12)
 for result in stream:
  persons={}
  boxes=result.boxes
  if boxes is not None and boxes.id is not None and result.keypoints is not None:
   ids=boxes.id.detach().cpu().numpy().astype(int)
   xyxy=boxes.xyxy.detach().cpu().numpy()
   kxy=result.keypoints.xy.detach().cpu().numpy()
   kconf=(result.keypoints.conf.detach().cpu().numpy() if result.keypoints.conf is not None
          else np.ones(kxy.shape[:2],dtype=np.float32))
   for i,tid in enumerate(ids):
    points=[{"x":float(kxy[i,j,0]),"y":float(kxy[i,j,1]),"confidence":float(kconf[i,j])} for j in range(17)]
    valid=int((kconf[i]>=CONF_MIN).sum())
    if valid<MIN_KEYPOINTS: continue
    p={"track_id":int(tid),"bbox":[float(x) for x in xyxy[i]],"keypoints":points,
       "_valid":valid,"_scene":0}
    persons[int(tid)]=p; counts[int(tid)]=counts.get(int(tid),0)+1
  if persons: rows[frame_idx]=(0,persons)
  frame_idx+=1
  if frame_idx%200==0: log(f"Fresh pose tracking: {frame_idx} sampled frames, {len(counts)} IDs so far.")
 if not rows: raise RuntimeError("YOLO11x-Pose + BoT-SORT produced no usable tracked people.")
 candidates=sorted(counts,key=counts.get,reverse=True)
 log(f"Fresh tracking completed: {frame_idx} sampled frames, {len(candidates)} track IDs, top counts={[(x,counts[x]) for x in candidates[:10]]}.")
 return rows,candidates,source_fps/2.0

def upsample_retarget_2x(frames):
 """Convert 12 FPS retarget poses to 24 FPS with linear in-betweening."""
 import copy
 result=[]
 def midpoint(a,b):
  out=copy.deepcopy(a)
  for ci in range(2):
   aa=a["actors"][ci]; bb=b["actors"][ci]; oo=out["actors"][ci]
   for name in aa["joints"]:
    oo["joints"][name]=[(aa["joints"][name][k]+bb["joints"][name][k])*.5 for k in (0,1)]
   oo["bbox"]=[(aa["bbox"][k]+bb["bbox"][k])*.5 for k in range(4)]
   oo["yaw"]=(aa["yaw"]+bb["yaw"])*.5
   oo["target_height_world"]=(aa.get("target_height_world",0)+bb.get("target_height_world",0))*.5
  return out
 for i,frame in enumerate(frames):
  result.append(copy.deepcopy(frame))
  result.append(midpoint(frame,frames[i+1]) if i+1<len(frames) else copy.deepcopy(frame))
 return result

def normalize_person(p):
 kps=p.get("keypoints") or []
 points=[]
 for j in range(17):
  q=kps[j] if j<len(kps) else None
  if q and float(q.get("confidence",0))>=CONF_MIN:
   points.append([float(q["x"]),float(q["y"]),float(q["confidence"])])
  else: points.append([None,None,0.0])
 b=[float(x) for x in p["bbox"]]
 return {"bbox":b,"keypoints":points,"valid":int(p.get("_valid",0))}

def interpolate_points(frames):
 import numpy as np
 for actor_idx in range(2):
  for j in range(17):
   for axis in (0,1):
    vals=[(i,a["actors"][actor_idx]["keypoints"][j][axis]) for i,a in enumerate(frames)
          if a["actors"][actor_idx]["keypoints"][j][axis] is not None]
    if vals:
     xs=np.array([v[0] for v in vals],dtype=float); ys=np.array([v[1] for v in vals],dtype=float)
     filled=[float(np.interp(i,xs,ys)) for i in range(len(frames))]
    else:
     filled=[]
     for a in frames:
      x1,y1,x2,y2=a["actors"][actor_idx]["bbox"]
      bw=max(1.0,x2-x1); bh=max(1.0,y2-y1); cx=(x1+x2)/2
      # Conservative COCO-17 fallback for joints never visible in this short shot.
      fallback_x=[cx,cx-.025*bw,cx+.025*bw,cx-.10*bw,cx+.10*bw,
                  cx-.18*bw,cx+.18*bw,cx-.25*bw,cx+.25*bw,
                  cx-.28*bw,cx+.28*bw,cx-.10*bw,cx+.10*bw,
                  cx-.10*bw,cx+.10*bw,cx-.10*bw,cx+.10*bw]
      fallback_y=[y1+.12*bh,y1+.075*bh,y1+.075*bh,y1+.13*bh,y1+.13*bh,
                  y1+.25*bh,y1+.25*bh,y1+.42*bh,y1+.42*bh,y1+.56*bh,y1+.56*bh,
                  y1+.58*bh,y1+.58*bh,y1+.78*bh,y1+.78*bh,y2-.02*bh,y2-.02*bh]
      filled.append(float((fallback_x if axis==0 else fallback_y)[j]))
    for i,a in enumerate(frames):
     if a["actors"][actor_idx]["keypoints"][j][axis] is None:
      a["actors"][actor_idx]["keypoints"][j][axis]=filled[i]
 return frames

def make_retarget_frames(frames,width,height):
 frames=interpolate_points(frames)
 result=[]
 for rec in frames:
  actors=[]
  for a in rec["actors"]:
   p=a["keypoints"]
   def pt(i):
    return (p[i][0],p[i][1])
   def mid(i,j):
    return ((p[i][0]+p[j][0])/2,(p[i][1]+p[j][1])/2)
   hip=mid(11,12); shoulder=mid(5,6)
   # COCO-17 to the canonical SMPL22 joint targets.
   joints={
    "Pelvis":hip,
    "L_Hip":pt(11),"R_Hip":pt(12),
    "Spine1":(hip[0]*.67+shoulder[0]*.33,hip[1]*.67+shoulder[1]*.33),
    "L_Knee":pt(13),"R_Knee":pt(14),
    "Spine2":(hip[0]*.33+shoulder[0]*.67,hip[1]*.33+shoulder[1]*.67),
    "L_Ankle":pt(15),"R_Ankle":pt(16),
    "Spine3":shoulder,"Neck":shoulder,
    "L_Collar":((shoulder[0]+p[5][0])/2,(shoulder[1]+p[5][1])/2),
    "R_Collar":((shoulder[0]+p[6][0])/2,(shoulder[1]+p[6][1])/2),
    "Head":pt(0),
    "L_Shoulder":pt(5),"R_Shoulder":pt(6),
    "L_Elbow":pt(7),"R_Elbow":pt(8),
    "L_Wrist":pt(9),"R_Wrist":pt(10),
   }
   # Approximate toe endpoints along the knee-to-ankle axis; COCO has no toe landmark.
   for side,knee,ankle in (("L",13,15),("R",14,16)):
    dx=p[ankle][0]-p[knee][0]; dy=p[ankle][1]-p[knee][1]
    joints[side+"_Foot"]=(p[ankle][0]+.15*dx,p[ankle][1]+.15*dy)
   eyes=mid(1,2)
   face_dx=pt(0)[0]-eyes[0]; face_dy=pt(0)[1]-eyes[1]
   yaw=max(-1.0,min(1.0,face_dx/max(1.0,abs(face_dy))*.65))
   actors.append({"bbox":a["bbox"],"joints":{k:[float(v[0]),float(v[1])] for k,v in joints.items()},
                  "yaw":float(yaw),"valid_keypoints":a["valid"]})
  result.append({"source_frame":rec["frame"],"actors":actors})
 return result

BLENDER_SCRIPT=r'''
import bpy, json, math, os, sys
from mathutils import Vector
from pathlib import Path
a=sys.argv[sys.argv.index("--")+1:]
char_paths=[a[0],a[1]]; data_path=a[2]; out_dir=Path(a[3]); qa_path=Path(a[4])
fps=int(a[5]); width=int(a[6]); height=int(a[7]); ortho_width=float(a[8])
frames=json.loads(Path(data_path).read_text(encoding="utf-8"))
out_dir.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine="BLENDER_EEVEE_NEXT"
scene.eevee.taa_render_samples=16
scene.render.resolution_x=width; scene.render.resolution_y=height; scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"; scene.render.image_settings.color_mode="RGB"
scene.render.fps=fps; scene.frame_start=1; scene.frame_end=len(frames)
scene.render.film_transparent=False
scene.view_settings.view_transform="AgX"
scene.render.filepath=str(out_dir/"frame_")
scene.world.color=(0.025,0.025,0.03)
scene.render.image_settings.color_mode="RGB"

def mat(name,color,metal=0.0,rough=.6):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 bs=m.node_tree.nodes.get("Principled BSDF")
 bs.inputs["Base Color"].default_value=(*color,1)
 bs.inputs["Metallic"].default_value=metal; bs.inputs["Roughness"].default_value=rough
 return m
floor_mat=mat("FightStage_Floor",(0.035,.045,.052),.15,.78)
wall_mat=mat("FightStage_Walls",(.08,.095,.105),.25,.7)
trim_mat=mat("FightStage_Trim",(.20,.22,.22),.35,.45)
def cube(name,loc,scale,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.name=name
 o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(material); return o
cube("Ground",(0,3,-.12),(15,30,.24),floor_mat)
cube("RearWall",(0,13,3.4),(15,.25,7),wall_mat)
for x in (-6.5,6.5):
 cube("SideWall",(x,5,3.4),(.25,17,7),wall_mat)
for x in (-5.5,5.5):
 for y in (2,7,12):
  cube("HallwayColumn",(x,y,2.2),(.55,.55,4.4),trim_mat)
for y in (1.5,5.5,9.5):
 cube("CeilingLight",(0,y,6.15),(2.8,.35,.08),mat("LampMat",(0.78,.76,.53),0,.4))
 ld=bpy.data.lights.new("OverheadArea","AREA"); lo=bpy.data.objects.new("OverheadArea",ld); scene.collection.objects.link(lo)
 lo.location=(0,y,6.0); ld.energy=1100; ld.shape="RECTANGLE"; ld.size=3; ld.size_y=1.0
 lo.rotation_euler=(0,0,0)
# Warm key and cool fill.
for name,loc,power,color,size in [
 ("Key",(0,-8,7),1800,(1.0,.80,.60),6),
 ("Fill",(-6,-4,4),950,(.48,.68,1.0),5),
 ("Rim",(4,7,5),1400,(1.0,.45,.20),4)]:
 ld=bpy.data.lights.new(name,"AREA"); lo=bpy.data.objects.new(name,ld); scene.collection.objects.link(lo)
 lo.location=loc; ld.energy=power; ld.color=color; ld.shape="DISK"; ld.size=size
 lo.rotation_euler=(Vector((0,2,2.3))-lo.location).to_track_quat("-Z","Y").to_euler()
camd=bpy.data.cameras.new("FightCamera"); cam=bpy.data.objects.new("FightCamera",camd); scene.collection.objects.link(cam)
cam.location=(0,-30,3.35); cam.rotation_euler=(math.radians(90),0,0)
camd.type="ORTHO"; camd.ortho_scale=ortho_width; camd.lens=45; scene.camera=cam
scene.camera.data.clip_end=100
world_h=ortho_width*height/width
pixel_scale=ortho_width/width
def world_point(xy,depth):
 return Vector(((float(xy[0])/width-.5)*ortho_width,depth,(.5-float(xy[1])/height)*world_h))
def add_empty(name,hide=True):
 o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
 o.empty_display_type="SPHERE"; o.empty_display_size=.05; o.hide_render=hide
 return o
def parent_preserve(obj,root):
 wm=obj.matrix_world.copy(); obj.parent=root; obj.matrix_world=wm
def import_character(path,label):
 before=set(bpy.data.objects)
 bpy.ops.import_scene.gltf(filepath=path)
 imported=[o for o in bpy.data.objects if o not in before]
 arms=[o for o in imported if o.type=="ARMATURE"]
 meshes=[o for o in imported if o.type=="MESH"]
 if len(arms)!=1 or not meshes:
  raise RuntimeError(f"{label}: expected exactly one armature and at least one mesh; got {len(arms)} armatures/{len(meshes)} meshes.")
 arm=arms[0]
 root=bpy.data.objects.new(label+"_Root",None); scene.collection.objects.link(root)
 root.empty_display_type="PLAIN_AXES"; root.empty_display_size=.5
 for obj in imported:\n  if obj.parent not in imported: parent_preserve(obj,root)
 bones=set(arm.data.bones.keys())
 required=["Pelvis","L_Hip","R_Hip","Spine1","L_Knee","R_Knee","Spine2","L_Ankle","R_Ankle","Spine3","Neck","Head",
           "L_Shoulder","R_Shoulder","L_Elbow","R_Elbow","L_Wrist","R_Wrist"]
 missing=[x for x in required if x not in bones]
 if missing: raise RuntimeError(f"{label}: missing canonical SMPL22 bones {missing}; got {sorted(bones)}")
 corners=[]
 for obj in meshes:
  for c in obj.bound_box: corners.append(obj.matrix_world @ Vector(c))
 height=max(p.z for p in corners)-min(p.z for p in corners)
 if height<=.05: raise RuntimeError(f"{label}: invalid mesh height {height}")
 return {"root":root,"arm":arm,"meshes":meshes,"height":height,"imported":imported}
characters=[import_character(char_paths[0],"CHAR_01"),import_character(char_paths[1],"CHAR_02")]
# Targets are in camera/world coordinates; hidden from the final render.
for ci,ch in enumerate(characters):
 ch["targets"]={name:add_empty(f"CHAR_{ci+1:02d}_{name}") for name in ("L_Wrist","R_Wrist","L_Ankle","R_Ankle","Head","Neck")}
 ch["poles"]={name:add_empty(f"CHAR_{ci+1:02d}_{name}_Pole") for name in ("L_Elbow","R_Elbow","L_Knee","R_Knee")}
 arm=ch["arm"]
 for end,pole,chain in (("L_Wrist","L_Elbow",3),("R_Wrist","R_Elbow",3),("L_Ankle","L_Knee",3),("R_Ankle","R_Knee",3)):
  con=arm.pose.bones[end].constraints.new("IK"); con.name="PoseRetarget_"+end
  con.target=ch["targets"][end]; con.pole_target=ch["poles"][pole]
  con.chain_count=chain; con.use_stretch=False; con.iterations=64
# Render scene and animation.
scene.render.engine="BLENDER_EEVEE_NEXT"
scene.frame_set(1)
errors=[]; all_bone_errors=[]
for idx,rec in enumerate(frames,1):
 scene.frame_set(idx)
 for ci,ch in enumerate(characters):
  actor=rec["actors"][ci]; joints=actor["joints"]; depth=(-.25 if ci==0 else .25)
  root=ch["root"]; arm=ch["arm"]
  # Screen-space scale is fixed to median source bbox height; root follows the hip target.
  target_height_world=float(actor["target_height_world"])
  scale=target_height_world/ch["height"]
  root.scale=(scale,scale,scale)
  root.rotation_euler=(0,0,float(actor["yaw"]))
  bpy.context.view_layer.update()
  pelvis_target=world_point(joints["Pelvis"],depth)
  pelvis_head=arm.matrix_world @ arm.data.bones["Pelvis"].head_local
  root.location += (pelvis_target-pelvis_head)
  for name,obj in ch["targets"].items():
   xy=joints.get(name,joints["Head"])
   obj.location=world_point(xy,depth)
  for end,pole_name in (("L_Wrist","L_Elbow"),("R_Wrist","R_Elbow"),("L_Ankle","L_Knee"),("R_Ankle","R_Knee")):
   joints_for_pole={"L_Elbow":("L_Shoulder","L_Elbow","L_Wrist"),"R_Elbow":("R_Shoulder","R_Elbow","R_Wrist"),
                    "L_Knee":("L_Hip","L_Knee","L_Ankle"),"R_Knee":("R_Hip","R_Knee","R_Ankle")}
   u,v,w=joints_for_pole[pole_name]
   pu=world_point(joints[u],depth); pv=world_point(joints[v],depth); pw=world_point(joints[w],depth)
   dx=pw.x-pu.x; dz=pw.z-pu.z; norm=max(1e-5,math.hypot(dx,dz))
   sign=1.0 if pole_name.startswith("L_") else -1.0
   pole=ch["poles"][pole_name]
   pole.location=Vector((pv.x-sign*dz/norm*.24,depth,pv.z+sign*dx/norm*.24))
  root.keyframe_insert(data_path="location",frame=idx)
  root.keyframe_insert(data_path="rotation_euler",frame=idx)
  root.keyframe_insert(data_path="scale",frame=idx)
  for obj in list(ch["targets"].values())+list(ch["poles"].values()):
   obj.keyframe_insert(data_path="location",frame=idx)
 bpy.context.view_layer.update()
 # Evaluate endpoint positions in pixels so retargeting error is measured after Blender IK.
 for ci,ch in enumerate(characters):
  for bone_name,target_name in (("L_Wrist","L_Wrist"),("R_Wrist","R_Wrist"),("L_Ankle","L_Ankle"),("R_Ankle","R_Ankle")):
   pb=ch["arm"].pose.bones[bone_name]
   tail=ch["arm"].matrix_world @ pb.tail
   target=ch["targets"][target_name].location
   err=(tail-target).length/pixel_scale
   errors.append(err)
   all_bone_errors.append({"frame":idx,"character":ci+1,"bone":bone_name,"endpoint_error_px":float(err)})
 # Render one frame to a numbered PNG. 
 scene.render.filepath=str(out_dir/f"frame_{idx:05d}.png")
 bpy.ops.render.render(write_still=True)
 if idx%12==0 or idx==len(frames): print(f"BLENDER_RENDER_PROGRESS {idx}/{len(frames)}",flush=True)
blend_path=out_dir/"rigged_fight_scene.blend"
scene.render.filepath=str(out_dir/"frame_")
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
report={"frames":len(frames),"fps":fps,"resolution":[width,height],"characters":[
 {"id":f"CHAR_{i+1:02d}","mesh_objects":len(ch["meshes"]),"armature":ch["arm"].name,
  "mesh_height_world":ch["height"],"bone_count":len(ch["arm"].data.bones),"required_bones":"passed"} for i,ch in enumerate(characters)],
 "ik_endpoint_error_px":{"mean":float(sum(errors)/max(1,len(errors))),"p95":float(sorted(errors)[int(.95*(len(errors)-1))]),"max":float(max(errors) if errors else 0)},
 "ik_endpoint_samples":all_bone_errors}
qa_path.write_text(json.dumps(report,indent=2),encoding="utf-8")
print("BLENDER_STAGE_COMPLETE "+json.dumps({k:v for k,v in report.items() if k!="ik_endpoint_samples"}),flush=True)
'''

def ffprobe(path):
 raw=run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)]).stdout
 return json.loads(raw)

def make_contact_sheet(frame_dir,n_frames,path):
 from PIL import Image,ImageDraw
 picks=sorted(set(max(1,min(n_frames,round((n_frames-1)*i/11)+1)) for i in range(12)))
 canvas=Image.new("RGB",(4*320,3*210),(20,22,26)); draw=ImageDraw.Draw(canvas)
 for i,frame_no in enumerate(picks):
  img=Image.open(frame_dir/f"frame_{frame_no:05d}.png").convert("RGB")
  img.thumbnail((320,180))
  x=(i%4)*320; y=(i//4)*210
  canvas.paste(img,(x,y+22)); draw.text((x+6,y+4),f"Frame {frame_no}",fill=(255,255,255))
 canvas.save(path,quality=92)

def create_release():
 token=os.getenv("GH_TOKEN","").strip() or os.getenv("GITHUB_TOKEN","").strip()
 if not token: raise RuntimeError("GitHub token was not forwarded to Colab; cannot publish outputs.")
 api=f"https://api.github.com/repos/{OWNER}/{REPO}"
 headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}
 tag="rigged-fight-video-"+datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
 r=requests.post(api+"/releases",headers=headers,json={"tag_name":tag,"name":"Rigged 3D fight video — "+tag,
  "body":"Rendered two rigged GLB characters from the registered reference video's analyzed two-person pose tracks. Includes MP4, source-vs-render comparison, contact sheet, Blender scene and technical QA. Screen-left/right character assignment is provisional and is not an identity verification.",
  "draft":False,"prerelease":False},timeout=60)
 r.raise_for_status()
 return r.json(),headers

def upload_release_asset(release,headers,path):
 upload=release["upload_url"].split("{",1)[0]
 with path.open("rb") as f:
  r=requests.post(upload+"?name="+path.name,headers={**headers,"Content-Type":"application/octet-stream"},data=f,timeout=(60,1200))
 r.raise_for_status()
 item=r.json()
 log(f"Published {item['name']} ({item['size']} bytes): {item['browser_download_url']}")
 return item

def main():
 t0=time.time()
 log("=== Rigged fight video production: audit -> retarget -> render -> audio -> compression -> QA ===")
 run([sys.executable,"-m","pip","install","-q","gdown>=5.2","numpy>=1.26","Pillow>=10","requests>=2.32","ultralytics>=8.3,<9"])
 video,pose,catalog,meta,assets,actual_fps=get_inputs()
 candidate_ids=read_candidates(catalog)
 rows,candidate_ids=read_track_data(pose,candidate_ids)
 log(f"Pose audit: candidate IDs={candidate_ids[:12]}; frames with people={len(rows)}; distinct visible tracks={len({t for _,ps in rows.values() for t in ps})}.")
 tracking_fps=float(actual_fps)
 try:
  segment,raw_frames=choose_segment(rows,candidate_ids,tracking_fps,int(meta["frames"]),int(meta["width"]))
  tracking_source="AL-DIDAH v2 pose_tracks.jsonl.gz"
 except RuntimeError as previous:
  log(f"AL-DIDAH tracks did not provide a continuous pair: {previous}")
  rows,candidate_ids,tracking_fps=fresh_pose_tracks(video,float(actual_fps))
  segment,raw_frames=choose_segment(rows,candidate_ids,tracking_fps,int(meta["frames"]),int(meta["width"]))
  tracking_source="fresh YOLO11x-Pose + BoT-SORT on source video (12 FPS sample)"
 fps=float(actual_fps); width=int(meta["width"]); height=int(meta["height"])
 render_frames=make_retarget_frames(raw_frames,width,height)
 if tracking_fps<fps-0.1:
  render_frames=upsample_retarget_2x(render_frames)
  segment["tracking_fps"]=tracking_fps
  segment["source_start_frame"]=int(round(segment["source_start_seconds"]*fps))
  segment["source_end_frame"]=segment["source_start_frame"]+int(round((len(raw_frames)-1)*fps/tracking_fps))
 segment["tracking_source"]=tracking_source
 # Fix output duration to the exact frame count; the audio is extracted from the same source interval.
 for rec in render_frames:
  for actor in rec["actors"]:
   bh=max(1.0,actor["bbox"][3]-actor["bbox"][1])
   actor["target_height_world"]=bh*ORTHO_WIDTH/width
 data_path=WORK/"retarget_frames.json"
 data_path.write_text(json.dumps(render_frames,separators=(",",":")),encoding="utf-8")
 selection={**segment,"source_fps":fps,"frame_count":len(render_frames),"reference_video_sha256":sha256(video),
            "character_assets":{k:{"path":str(v),"sha256":sha256(v),"bytes":v.stat().st_size} for k,v in assets.items()},
            "retarget_method":"COCO-17 -> canonical SMPL22 target points; Blender armature IK for wrists/ankles; screen-space orthographic mapping",
            "known_limits":["single-image character reconstruction on unseen sides","COCO-17 does not provide fingers/toes or full head orientation",
                            "source track assignment is provisional by screen side","monocular pose tracks do not recover ground-truth 3D depth"]}
 (OUT/"segment_selection.json").write_text(json.dumps(selection,indent=2),encoding="utf-8")
 # Install Blender headless.
 blender_root=WORK/"blender-4.2.3-linux-x64"
 blender=blender_root/"blender"
 if not blender.exists():
  archive=WORK/"blender.tar.xz"
  download("https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz",archive)
  run(["tar","-xf",str(archive),"-C",str(WORK)],timeout=600)
 if not blender.exists():
  raise RuntimeError("Blender executable was not found after installation.")
 run([str(blender),"--version"])
 frame_dir=OUT/"rendered_frames"; frame_dir.mkdir(parents=True,exist_ok=True)
 blender_py=WORK/"render_rigged_fight.py"; blender_py.write_text(BLENDER_SCRIPT,encoding="utf-8")
 blender_qa=OUT/"blender_ik_qa.json"
 run([str(blender),"--background","--factory-startup","--python-exit-code","1","--python",str(blender_py),"--",
      str(assets["CHAR_01"]),str(assets["CHAR_02"]),str(data_path),str(frame_dir),str(blender_qa),
      str(FPS_OUT),str(RENDER_WIDTH),str(RENDER_HEIGHT),str(ORTHO_WIDTH)],timeout=2400)
 if not blender_qa.exists(): raise RuntimeError("Blender did not produce the IK QA report.")
 with blender_qa.open(encoding="utf-8") as f: bqa=json.load(f)
 if not all((frame_dir/f"frame_{i:05d}.png").is_file() for i in range(1,len(render_frames)+1)):
  raise RuntimeError("Rendered PNG sequence has missing frames.")
 # Extract the exact source soundtrack for the selected time range.
 start=float(segment["source_start_seconds"]); duration=len(render_frames)/FPS_OUT
 audio=OUT/"reference_audio.m4a"
 run(["ffmpeg","-y","-ss",f"{start:.6f}","-i",str(video),"-t",f"{duration:.6f}","-vn","-ac","2","-ar","48000","-c:a","aac","-b:a","192k",str(audio),"-loglevel","error"])
 audio_probe=ffprobe(audio)
 if not any(s.get("codec_type")=="audio" for s in audio_probe.get("streams",[])):
  raise RuntimeError("The extracted reference soundtrack has no audio stream.")
 # Lossless H.264 intermediate, then compact H.264 encodes. Compare SSIM and size.
 master=OUT/"fight_render_master_lossless.mp4"
 run(["ffmpeg","-y","-framerate",str(FPS_OUT),"-i",str(frame_dir/"frame_%05d.png"),"-i",str(audio),
      "-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","ultrafast","-crf","0","-pix_fmt","yuv420p",
      "-c:a","aac","-b:a","192k","-shortest",str(master),"-loglevel","error"],timeout=900)
 if not master.exists() or master.stat().st_size<100_000: raise RuntimeError("Lossless master MP4 was not created.")
 final=OUT/"rigged_two_character_fight.mp4"
 best=None
 for crf in (22,24,26,28):
  candidate=OUT/f"candidate_crf{crf}.mp4"
  run(["ffmpeg","-y","-i",str(master),"-c:v","libx264","-preset","slow","-crf",str(crf),"-pix_fmt","yuv420p",
       "-c:a","copy","-movflags","+faststart",str(candidate),"-loglevel","error"],timeout=900)
  ssimrun=run(["ffmpeg","-i",str(master),"-i",str(candidate),"-lavfi","ssim","-f","null","-"],check=False,timeout=600)
  vals=re.findall(r"All:([0-9.]+)",ssimrun.stdout)
  ssim=float(vals[-1]) if vals else 0.0
  reduction=1.0-candidate.stat().st_size/master.stat().st_size
  log(f"Encode CRF {crf}: size={candidate.stat().st_size} bytes; reduction={reduction:.1%}; SSIM={ssim:.5f}")
  best=(candidate,crf,ssim,reduction)
  if reduction>=0.80 and ssim>=0.97: break
 if best is None: raise RuntimeError("No compressed MP4 candidate was produced.")
 candidate,crf,ssim,reduction=best
 shutil.copy2(candidate,final)
 # Side-by-side comparison video with the exact reference segment.
 comparison=OUT/"reference_vs_rigged_3d_comparison.mp4"
 start_ts=f"{start:.6f}"; dur_ts=f"{duration:.6f}"
 run(["ffmpeg","-y","-ss",start_ts,"-i",str(video),"-i",str(final),"-t",dur_ts,
      "-filter_complex","[0:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[left];[1:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[right];[left][right]hstack=inputs=2[v]",
      "-map","[v]","-map","1:a:0?","-c:v","libx264","-preset","medium","-crf","22","-c:a","aac","-b:a","160k","-shortest",str(comparison),"-loglevel","error"],timeout=600)
 # Technical integrity: exact decode, codec, dimensions, FPS, frame count, audio presence/duration.
 probe=ffprobe(final); vs=[s for s in probe["streams"] if s.get("codec_type")=="video"]; aus=[s for s in probe["streams"] if s.get("codec_type")=="audio"]
 if not vs or not aus: raise RuntimeError("Final MP4 must contain both video and the reference audio track.")
 v=vs[0]; out_fps=eval(v.get("avg_frame_rate","0/1")); out_dur=float(probe["format"]["duration"])
 expected=len(render_frames)
 if int(v.get("width",0))!=RENDER_WIDTH or int(v.get("height",0))!=RENDER_HEIGHT: raise RuntimeError("Final MP4 dimensions failed validation.")
 if abs(out_fps-FPS_OUT)>0.02: raise RuntimeError(f"Final MP4 FPS mismatch: {out_fps}.")
 if abs(out_dur-duration)>0.20: raise RuntimeError(f"Final MP4 duration mismatch: {out_dur:.3f} vs {duration:.3f}.")
 decode=run(["ffmpeg","-v","error","-i",str(final),"-map","0:v:0","-map","0:a:0","-f","null","-"],check=False,timeout=600)
 if decode.returncode!=0: raise RuntimeError("The final MP4 failed a full FFmpeg decode test.")
 # Validate the audio is not effectively silent.
 audio_stats=run(["ffmpeg","-i",str(final),"-map","0:a:0","-af","volumedetect","-f","null","-"],check=False,timeout=300).stdout
 mean_match=re.findall(r"mean_volume:\s*(-?[\d.]+) dB",audio_stats)
 mean_db=float(mean_match[-1]) if mean_match else None
 if mean_db is None or mean_db<-60: raise RuntimeError(f"Output audio is absent or near-silent (mean volume={mean_db}).")
 contact=OUT/"fight_contact_sheet.jpg"
 make_contact_sheet(frame_dir,len(render_frames),contact)
 # Compare size of final vs lossless master and preserve original source metadata.
 final_probe={"video_codec":v.get("codec_name"),"width":v.get("width"),"height":v.get("height"),
              "fps":out_fps,"duration_seconds":out_dur,"frames":int(v.get("nb_frames") or expected),
              "audio_codec":aus[0].get("codec_name"),"audio_sample_rate":aus[0].get("sample_rate"),
              "audio_mean_volume_db":mean_db,"bytes":final.stat().st_size}
 qa_gates={"video_decode":True,"audio_present_and_non_silent":bool(mean_db is not None and mean_db>-60),
           "size_reduction_at_least_80_percent":bool(reduction>=0.80),
           "ssim_at_least_0_97":bool(ssim>=0.97),
           "ik_mean_endpoint_error_under_20px":bool(bqa["ik_endpoint_error_px"]["mean"]<20),
           "ik_p95_endpoint_error_under_35px":bool(bqa["ik_endpoint_error_px"]["p95"]<35)}
 qa_status="complete_all_gates" if all(qa_gates.values()) else "rendered_but_quality_gates_need_review"
 qa={"status":qa_status,"quality_gates":qa_gates,"created_utc":datetime.now(timezone.utc).isoformat(),
     "source":{"drive_id":SOURCE_VIDEO_ID,"sha256":sha256(video),"fps":fps,"duration_seconds":float(meta["duration"]),
               "resolution":[meta["width"],meta["height"]]},
     "segment":selection,"render":{"fps":FPS_OUT,"frames":expected,"resolution":[RENDER_WIDTH,RENDER_HEIGHT],
               "duration_seconds":duration,"blend_file":"rendered_frames/rigged_fight_scene.blend"},
     "final_mp4":final_probe,"compression":{"master_bytes":master.stat().st_size,"final_bytes":final.stat().st_size,
               "size_reduction_vs_lossless_master":reduction,"crf":crf,"ssim_vs_lossless_master":ssim},
     "blender_ik_qa":{k:v for k,v in bqa.items() if k!="ik_endpoint_samples"},
     "comparison_video":"reference_vs_rigged_3d_comparison.mp4",
     "contact_sheet":"fight_contact_sheet.jpg",
     "limitations":["Character assignment is provisional by screen-left/screen-right, not facial identity.",
                    "COCO-17 motion is screen-space pose retargeting with an orthographic depth layout, not calibrated ground-truth 3D motion capture.",
                    "Single-image reconstructed geometry cannot guarantee unseen-side anatomy; face/finger/toe animation is limited.",
                    "This is a short action segment extracted from the analyzed reference, not a full-length replacement of the entire source video."]}
 (OUT/"production_qa_report.json").write_text(json.dumps(qa,indent=2),encoding="utf-8")
 # Remove huge lossless and intermediate candidates after final verification.
 for p in [master]+list(OUT.glob("candidate_crf*.mp4")):
  try:p.unlink()
  except OSError:pass
 # Publish all durable products in a new Release; keep local render frames out of the upload.
 release,headers=create_release()
 assets_to_publish=[final,comparison,contact,OUT/"production_qa_report.json",OUT/"segment_selection.json",blender_qa,frame_dir/"rigged_fight_scene.blend"]
 uploaded=[]
 for p in assets_to_publish:
  if p.is_file() and p.stat().st_size>0: uploaded.append(upload_release_asset(release,headers,p))
 receipt={"release":release["html_url"],"tag":release["tag_name"],"assets":uploaded}
 (OUT/"github_release_receipt.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
 log("PRODUCTION_QA "+json.dumps({"final_mp4_bytes":final.stat().st_size,"duration":out_dur,"fps":out_fps,
                                  "audio_mean_db":mean_db,"compression_reduction":reduction,"ssim":ssim,
                                  "ik_endpoint_mean_px":bqa["ik_endpoint_error_px"]["mean"],"release":release["html_url"]}))
 log(f"=== PIPELINE COMPLETE IN {time.time()-t0:.1f}s ===")

if __name__=="__main__":
 try: main()
 except Exception as exc:
  log(f"FAILED: {type(exc).__name__}: {exc}")
  import traceback; traceback.print_exc()
  raise
