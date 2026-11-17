#!/usr/bin/env python3
"""AL-DIDAH v2: full-frame pose analysis, stable shot-scoped tracking, motion/camera QA and GitHub Release."""
import os,sys,subprocess,json,time,math,csv,hashlib,shutil,zipfile,gzip,traceback
from pathlib import Path
from collections import defaultdict
from datetime import datetime,timezone

OWNER="h776117073-eng"; REPO="AI-Creative-Studio"; TAG="al-didah-production-v2"
VIDEO_ID="1ygz0hzQNH70VsP8-2DCSFO9OFPg7JB4_"
CHAR_IDS=["1uY_3X4RZceENv7ns6BV0PGVVzcVlyiaO","1snzt4jR2YiPoebpRjKa8sCqxAmW1KgtE"]
CHAR_URLS=[f"https://raw.githubusercontent.com/{OWNER}/{REPO}/main/data/al_didah/character_1.jpg",f"https://raw.githubusercontent.com/{OWNER}/{REPO}/main/data/al_didah/character_2.jpg"]
VIDEO_FALLBACK="https://youtu.be/d_qGO4GrbQM"
IMGSZ=960; CONF=.10; KP_CONF=.12; BATCH=8; MAX_GAP=12; CAMERA_STEP=4
BASE=Path("/content/al_didah_v2"); INP=BASE/"inputs"; OUT=BASE/"outputs"; KF=OUT/"keyframes"; CROPS=OUT/"track_crops"; CHAR_DIR=OUT/"character_assets"
for p in (INP,OUT,KF,CROPS,CHAR_DIR): p.mkdir(parents=True,exist_ok=True)
NAMES=["nose","left_eye","right_eye","left_ear","right_ear","left_shoulder","right_shoulder","left_elbow","right_elbow","left_wrist","right_wrist","left_hip","right_hip","left_knee","right_knee","left_ankle","right_ankle"]
EDGES=[(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,5),(0,6),(1,2),(1,3),(2,4)]

def log(s): print(f"[{datetime.now(timezone.utc).isoformat()}] {s}",flush=True)
def run(cmd,check=True,timeout=900):
    p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
    if check and p.returncode: raise RuntimeError(f"Command failed: {cmd}\n{p.stderr[-2500:]}")
    return p
def digest(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def install():
    log("Install/verify Colab dependencies")
    pkgs=["ultralytics==8.4.0","scenedetect[opencv]>=0.6.4","gdown>=5.2","rembg[cpu]>=2.0.60","onnxruntime>=1.19","pandas>=2.2","scipy>=1.13","Pillow>=10","requests>=2.32","tqdm>=4.66"]
    p=run([sys.executable,"-m","pip","install","-q","--disable-pip-version-check"]+pkgs,False,1200)
    if p.returncode:
        for x in ["ultralytics==8.4.0","scenedetect[opencv]>=0.6.4","gdown>=5.2","Pillow>=10","scipy>=1.13","requests>=2.32"]:
            run([sys.executable,"-m","pip","install","-q",x],True,600)
    import torch,cv2,numpy,pandas,scipy
    if not torch.cuda.is_available(): raise RuntimeError("T4/CUDA not found. The full-frame run requires a Colab GPU.")
    log(f"GPU={torch.cuda.get_device_name(0)} | Python={sys.version.split()[0]} | OpenCV={cv2.__version__} | NumPy={numpy.__version__}")

def get_drive(fid,dest):
    import gdown
    try:
        x=gdown.download(id=fid,output=str(dest),quiet=False,fuzzy=True)
        if x and dest.exists() and dest.stat().st_size>1024: return True
    except Exception as e: log(f"Drive fetch warning: {e}")
    p=run([sys.executable,"-m","gdown",f"https://drive.google.com/uc?id={fid}","-O",str(dest)],False,600)
    return p.returncode==0 and dest.exists() and dest.stat().st_size>1024

def inputs():
    import requests
    video=INP/"source_video.mp4"
    if not video.exists() or video.stat().st_size<1_000_000:
        if not get_drive(VIDEO_ID,video):
            log("Drive file unavailable; trying documented YouTube fallback")
            run([sys.executable,"-m","pip","install","-q","yt-dlp"],False,300)
            p=run([sys.executable,"-m","yt_dlp","-f","bv*[height<=1080]+ba/b[height<=1080]","--merge-output-format","mp4","-o",str(INP/"fallback.%(ext)s"),VIDEO_FALLBACK],False,900)
            cand=list(INP.glob("fallback.*"))
            if p.returncode or not cand: raise RuntimeError("Source video download failed.")
            shutil.copy2(cand[0],video)
    if video.stat().st_size<1_000_000: raise RuntimeError("Source video appears incomplete.")
    chars=[]
    for i,fid in enumerate(CHAR_IDS):
        dest=INP/f"character_{i+1}.jpg"
        if not dest.exists() or dest.stat().st_size<1000:
            if not get_drive(fid,dest):
                r=requests.get(CHAR_URLS[i],timeout=60); r.raise_for_status(); dest.write_bytes(r.content)
        from PIL import Image
        with Image.open(dest) as im: im.verify()
        chars.append(dest)
        log(f"Character reference {i+1}: {dest.stat().st_size} bytes; sha256={digest(dest)}")
    log(f"Video: {video.stat().st_size} bytes; sha256={digest(video)}")
    return video,chars

def probe(video):
    import cv2
    c=cv2.VideoCapture(str(video))
    if not c.isOpened(): raise RuntimeError("Cannot open source video.")
    m={"fps":float(c.get(cv2.CAP_PROP_FPS)),"frames":int(c.get(cv2.CAP_PROP_FRAME_COUNT)),"width":int(c.get(cv2.CAP_PROP_FRAME_WIDTH)),"height":int(c.get(cv2.CAP_PROP_FRAME_HEIGHT))}
    ok,_=c.read(); c.release()
    if not ok or m["fps"]<=0 or m["frames"]<=0 or min(m["width"],m["height"])<160: raise RuntimeError(f"Invalid video: {m}")
    m["duration"]=m["frames"]/m["fps"]
    (OUT/"video_metadata.json").write_text(json.dumps(m,indent=2),encoding="utf-8")
    log(f"Source: {m['frames']} frames / {m['fps']} FPS / {m['width']}x{m['height']} / {m['duration']:.2f}s")
    return m

def scenes(video,m):
    from scenedetect import open_video,SceneManager
    from scenedetect.detectors import ContentDetector
    v=open_video(str(video)); sm=SceneManager(); sm.add_detector(ContentDetector(threshold=27,min_scene_len=max(12,int(m["fps"]*.5))))
    sm.detect_scenes(v); raw=sm.get_scene_list(); ss=[]
    for i,(a,b) in enumerate(raw,1):
        ss.append({"scene_id":i,"start_frame":a.get_frames(),"end_frame":b.get_frames(),"start_sec":a.get_seconds(),"end_sec":b.get_seconds(),"duration":b.get_seconds()-a.get_seconds()})
    if not ss: ss=[{"scene_id":1,"start_frame":0,"end_frame":m["frames"],"start_sec":0,"end_sec":m["duration"],"duration":m["duration"]}]
    ss[0]["opening_logo_candidate"]=True
    (OUT/"scene_manifest.json").write_text(json.dumps({"count":len(ss),"scenes":ss,"opening_preserved":True,"opening_boundary_requires_review":True},indent=2),encoding="utf-8")
    log(f"Scene cuts: {len(ss)}; opening shot retained, candidate duration {ss[0]['duration']:.2f}s")
    return ss

def hist(frame,b):
    import cv2,numpy as np
    x1,y1,x2,y2=map(int,b); h,w=frame.shape[:2]; x1=max(0,x1); y1=max(0,y1); x2=min(w,max(x1+1,x2)); y2=min(h,max(y1+1,y2))
    crop=frame[y1:y2,x1:x2]
    if crop.size==0: return None
    a=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV); z=cv2.calcHist([a],[0,1],None,[16,8],[0,180,0,256]); cv2.normalize(z,z,alpha=1,norm_type=cv2.NORM_L1)
    return z.ravel().astype(float).tolist()
def hd(a,b):
    import numpy as np
    if a is None or b is None: return .5
    bc=float(np.sum(np.sqrt(np.maximum(a,0)*np.maximum(b,0))))
    return math.sqrt(max(0,1-min(1,bc)))
def iou(a,b):
    x1=max(a[0],b[0]); y1=max(a[1],b[1]); x2=min(a[2],b[2]); y2=min(a[3],b[3])
    inter=max(0,x2-x1)*max(0,y2-y1); aa=max(0,a[2]-a[0])*max(0,a[3]-a[1]); bb=max(0,b[2]-b[0])*max(0,b[3]-b[1])
    return inter/max(aa+bb-inter,1e-6)

def associate(ds,active,nextid,fi,sid):
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    tids=[k for k,v in active.items() if v["scene"]==sid and fi-v["frame"]<=MAX_GAP]
    assigned={}
    if ds and tids:
        C=np.full((len(tids),len(ds)),10,dtype=np.float32)
        for i,k in enumerate(tids):
            t=active[k]; a=t["box"]; ac=((a[0]+a[2])/2,(a[1]+a[3])/2); diag=max(math.hypot(a[2]-a[0],a[3]-a[1]),100)
            for j,d in enumerate(ds):
                b=d["box"]; bc=((b[0]+b[2])/2,(b[1]+b[3])/2); dist=math.hypot(ac[0]-bc[0],ac[1]-bc[1])/diag; ov=iou(a,b); app=hd(t.get("hist"),d.get("hist"))
                if (ov>=.01 or dist<=2.2) and (app<=.88 or ov>=.2): C[i,j]=.48*(1-ov)+.32*min(dist/2.2,1)+.20*app
        ri,ci=linear_sum_assignment(C)
        for i,j in zip(ri,ci):
            if C[i,j]<=.78: assigned[j]=tids[i]
    for j,d in enumerate(ds):
        if j not in assigned: assigned[j]=nextid; nextid+=1
        k=assigned[j]; old=active.get(k)
        if old and old.get("hist") is not None and d.get("hist") is not None:
            d["hist"]=(.75*np.asarray(old["hist"])+.25*np.asarray(d["hist"])).tolist()
        active[k]={"box":d["box"],"hist":d.get("hist"),"frame":fi,"scene":sid}; d["track_id"]=int(k)
    for k in list(active):
        if fi-active[k]["frame"]>MAX_GAP: active.pop(k,None)
    return ds,nextid

def detections(res,frame):
    import numpy as np
    out=[]
    if res.boxes is None or res.keypoints is None: return out
    boxes=res.boxes.xyxy.cpu().numpy(); scores=res.boxes.conf.cpu().numpy(); kp=res.keypoints.xy.cpu().numpy()
    kc=res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else np.ones(kp.shape[:2])
    for b,sc,pts,cs in zip(boxes,scores,kp,kc):
        area=max(0,b[2]-b[0])*max(0,b[3]-b[1])
        if area<200: continue
        pts2=[]
        for xy,c in zip(pts,cs):
            x,y=float(xy[0]),float(xy[1]); c=float(c)
            pts2.append({"x":x,"y":y,"confidence":c} if np.isfinite(x+y+c) and c>=KP_CONF else None)
        out.append({"box":[float(x) for x in b],"score":float(sc),"kps":pts2,"hist":hist(frame,b)})
    out.sort(key=lambda d:d["score"]*math.sqrt(max(1,(d["box"][2]-d["box"][0])*(d["box"][3]-d["box"][1]))),reverse=True)
    return out[:6]

def camera(prev,cur,boxes):
    import cv2,numpy as np
    h,w=cur.shape; mask=np.full((h,w),255,np.uint8)
    for b in boxes:
        x1,y1,x2,y2=b; p=10; mask[max(0,int(y1)-p):min(h,int(y2)+p),max(0,int(x1)-p):min(w,int(x2)+p)]=0
    p0=cv2.goodFeaturesToTrack(prev,500,.01,7,mask=mask,blockSize=7)
    if p0 is None or len(p0)<12: return {"dx":None,"dy":None,"scale":None,"rotation_deg":None,"inliers":0,"status":"few_background_features"}
    p1,st,_=cv2.calcOpticalFlowPyrLK(prev,cur,p0,None,winSize=(21,21),maxLevel=3)
    a=p0[st.ravel()==1]; b=p1[st.ravel()==1]
    if len(a)<10: return {"dx":None,"dy":None,"scale":None,"rotation_deg":None,"inliers":len(a),"status":"few_tracks"}
    M,ins=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=2.5)
    if M is None: return {"dx":None,"dy":None,"scale":None,"rotation_deg":None,"inliers":0,"status":"affine_failed"}
    return {"dx":float(M[0,2]),"dy":float(M[1,2]),"scale":float(math.sqrt(M[0,0]**2+M[0,1]**2)),"rotation_deg":float(math.degrees(math.atan2(M[1,0],M[0,0]))),"inliers":int(ins.sum()) if ins is not None else 0,"status":"background_motion_proxy"}

def prep_chars(paths):
    from PIL import Image,ImageOps,ImageFilter
    try:
        from rembg import remove,new_session
        ses=new_session("u2net")
    except Exception as e: log(f"rembg unavailable: {e}"); remove=None; ses=None
    arr=[]
    for i,p in enumerate(paths,1):
        im=ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        raw=OUT/f"character_{i}_original.png"; im.save(raw)
        try: rgba=remove(im,session=ses).convert("RGBA") if remove else im.convert("RGBA"); state="u2net"
        except Exception as e: rgba=im.convert("RGBA"); state=f"fallback:{type(e).__name__}"
        sc=max(1,2048/max(rgba.size)); size=(round(rgba.width*sc),round(rgba.height*sc))
        master=rgba.resize(size,Image.Resampling.LANCZOS); mp=CHAR_DIR/f"character_{i}_master.png"; master.save(mp,optimize=True)
        bg=Image.new("RGBA",master.size,(248,248,248,255)); bg.alpha_composite(master); prev=CHAR_DIR/f"character_{i}_preview.jpg"; bg.convert("RGB").save(prev,quality=94)
        arr.append({"id":f"CHAR_{i:02d}","source_sha256":digest(p),"original_size":list(im.size),"master_size":list(master.size),"background_removal":state,"master":str(mp.relative_to(OUT)),"preview":str(prev.relative_to(OUT)),"anime_stylization":"not performed; reference plate only","rig":"not generated"})
    (OUT/"character_manifest.json").write_text(json.dumps(arr,indent=2),encoding="utf-8")
    return arr

def analyze(video,m,ss):
    import cv2,numpy as np,torch,pandas as pd,gc,csv
    from ultralytics import YOLO
    from tqdm import tqdm
    model=YOLO("yolo11n-pose.pt"); cap=cv2.VideoCapture(str(video))
    if not cap.isOpened(): raise RuntimeError("Could not reopen source video.")
    overlay=OUT/"pose_overlay_preview_6fps.mp4"
    overlay_fps=min(6.0,float(m["fps"])); overlay_stride=max(1,int(round(float(m["fps"])/overlay_fps)))
    wr=cv2.VideoWriter(str(overlay),cv2.VideoWriter_fourcc(*"mp4v"),overlay_fps,(m["width"],m["height"]))
    if not wr.isOpened(): raise RuntimeError("VideoWriter not available.")
    pose_gz_path=OUT/"pose_tracks.jsonl.gz"; pose_gz_path.unlink(missing_ok=True)
    pose_gz=gzip.open(pose_gz_path,"wt",encoding="utf-8",compresslevel=3)
    motion_csv=OUT/"motion_curves.csv"; motion_csv.unlink(missing_ok=True)
    motion_columns=["frame","time","scene_id","track_id","joint","x","y","confidence","vx_px_s","vy_px_s","speed_px_s","ax_px_s2","ay_px_s2","smooth_x","smooth_y","observed"]
    motion_file=open(motion_csv,"w",newline="",encoding="utf-8")
    motion_writer=csv.DictWriter(motion_file,fieldnames=motion_columns)
    motion_writer.writeheader(); motion_file.flush()
    progress_path=OUT/"analysis_progress.json"
    active={}; catalog=defaultdict(lambda:{"frames":0,"first":None,"last":None,"area":0.,"conf":0.,"kp":0,"scene":set(),"best":-1})
    cams=[]; nextid=1; fi=0; sp=0; prevgray=None; prevsid=None; batches=[]; idxs=[]; sids=[]; grays=[]; frame_hits=0; det_total=0; kpt_valid=0; kpt_total=0; key_saved=set()
    bar=tqdm(total=m["frames"],desc="24fps full-frame analysis")
    def sid_of(i):
        nonlocal sp
        while sp+1<len(ss) and i>=ss[sp]["end_frame"]: sp+=1
        return ss[sp]["scene_id"]
    def batch_done(results,ims,ids,scene_ids,small_grays):
        nonlocal nextid,prevgray,prevsid,frame_hits,det_total,kpt_valid,kpt_total
        lines=[]
        motion_chunk=[]
        for res,fr,ix,sid,sg in zip(results,ims,ids,scene_ids,small_grays):
            if prevsid is not None and sid!=prevsid: active.clear(); prevgray=None
            ds=detections(res,fr); ds,nextid=associate(ds,active,nextid,ix,sid)
            if ix % 24 == 0:
                live_ids=set(active.keys())
                stale_keys=[key for key in last.keys() if key[0] not in live_ids]
                for stale_key in stale_keys:
                    last.pop(stale_key,None); smooth.pop(stale_key,None)
            persons=[]; boxes=[]
            if ds: frame_hits+=1
            for d in ds:
                tid=d["track_id"]; boxes.append(d["box"]); det_total+=1; n=sum(x is not None for x in d["kps"]); kpt_valid+=n; kpt_total+=17
                persons.append({"track_id":tid,"bbox":d["box"],"detection_confidence":d["score"],"keypoints":d["kps"],"valid_keypoints":n})
                c=catalog[tid]; c["frames"]+=1; c["scene"].add(sid); c["first"]=ix if c["first"] is None else min(c["first"],ix); c["last"]=ix; c["area"]+=(d["box"][2]-d["box"][0])*(d["box"][3]-d["box"][1]); c["conf"]+=d["score"]; c["kp"]+=n
                if n>c["best"]:
                    c["best"]=n; x1,y1,x2,y2=map(int,d["box"]); h,w=fr.shape[:2]; x1=max(0,x1);y1=max(0,y1);x2=min(w,x2);y2=min(h,y2)
                    if x2>x1 and y2>y1: cv2.imwrite(str(CROPS/f"track_{tid:04d}_best.jpg"),fr[y1:y2,x1:x2],[cv2.IMWRITE_JPEG_QUALITY,95])
                for j,p in enumerate(d["kps"]):
                    if p is None: continue
                    key=(tid,j); old=last.get(key); vx=vy=speed=ax=ay=None
                    if old and 0<ix-old["frame"]<=2:
                        dt=(ix-old["frame"])/m["fps"]; vx=(p["x"]-old["x"])/dt; vy=(p["y"]-old["y"])/dt; speed=math.hypot(vx,vy)
                        if old.get("vx") is not None and old.get("vy") is not None: ax=(vx-old["vx"])/dt; ay=(vy-old["vy"])/dt
                    oldsm=smooth.get(key); sx=p["x"] if oldsm is None else .55*p["x"]+.45*oldsm[0]; sy=p["y"] if oldsm is None else .55*p["y"]+.45*oldsm[1]; smooth[key]=(sx,sy)
                    motion_chunk.append({"frame":ix,"time":ix/m["fps"],"scene_id":sid,"track_id":tid,"joint":NAMES[j],"x":p["x"],"y":p["y"],"confidence":p["confidence"],"vx_px_s":vx,"vy_px_s":vy,"speed_px_s":speed,"ax_px_s2":ax,"ay_px_s2":ay,"smooth_x":sx,"smooth_y":sy,"observed":True})
                    last[key]={"frame":ix,"x":p["x"],"y":p["y"],"vx":vx,"vy":vy}
            lines.append(json.dumps({"frame":ix,"time":ix/m["fps"],"scene_id":sid,"persons":persons,"detection_count":len(persons)},separators=(",",":")))
            if sid not in key_saved and persons:
                cv2.imwrite(str(KF/f"scene_{sid:03d}_first_detection.jpg"),fr,[cv2.IMWRITE_JPEG_QUALITY,94]); key_saved.add(sid)
            if ix % overlay_stride == 0:
                ov=fr.copy()
                for person in persons:
                    x1,y1,x2,y2=map(int,person["bbox"]); cv2.rectangle(ov,(x1,y1),(x2,y2),(255,180,0),2); cv2.putText(ov,f"ID {person['track_id']}",(x1,max(20,y1-5)),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,180,0),2)
                    points=person["keypoints"]
                    for a,b in EDGES:
                        if points[a] and points[b]: cv2.line(ov,(int(points[a]["x"]),int(points[a]["y"])),(int(points[b]["x"]),int(points[b]["y"])),(20,230,255),2,cv2.LINE_AA)
                    for p in points:
                        if p: cv2.circle(ov,(int(p["x"]),int(p["y"])),3,(50,255,80),-1)
                wr.write(ov); del ov
            if ix%CAMERA_STEP==0:
                if prevgray is not None and prevsid==sid: cams.append({"frame":ix,"time":ix/m["fps"],"scene_id":sid,**camera(prevgray,sg,[[z*.5 for z in b] for b in boxes])})
                else: cams.append({"frame":ix,"time":ix/m["fps"],"scene_id":sid,"dx":None,"dy":None,"scale":None,"rotation_deg":None,"inliers":0,"status":"scene_start"})
            prevgray=sg.copy(); prevsid=sid
        pose_gz.write("\n".join(lines)+"\n"); pose_gz.flush()
        # Stream pose measurements to disk per batch; never retain all per-joint rows in RAM.
        if motion_chunk:
            motion_writer.writerows(motion_chunk)
            motion_file.flush()
        with open(progress_path,"w",encoding="utf-8") as pf:
            json.dump({"last_frame":int(ids[-1]),"processed_frames":int(ids[-1])+1,"source_frames":int(m["frames"]),"progress":float((int(ids[-1])+1)/max(1,int(m["frames"])))},pf)
        if int(ids[-1]) % 1000 < BATCH:
            import resource
            rss_mb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
            gpu_mem_mb=(torch.cuda.memory_allocated()/1024**2) if torch.cuda.is_available() else 0
            log(f"Checkpoint frame={int(ids[-1])+1}/{int(m['frames'])}; RSS_peak_MB={rss_mb:.1f}; CUDA_allocated_MB={gpu_mem_mb:.1f}; live_tracks={len(active)}")
            gc.collect()
        del motion_chunk
    last={}; smooth={}
    try:
        while True:
            ok,fr=cap.read()
            if not ok: break
            sid=sid_of(fi); sm=cv2.resize(fr,(m["width"]//2,m["height"]//2)); gray=cv2.cvtColor(sm,cv2.COLOR_BGR2GRAY)
            batches.append(fr);idxs.append(fi);sids.append(sid);grays.append(gray)
            if len(batches)==BATCH:
                rr=model.predict(source=batches,imgsz=IMGSZ,conf=CONF,iou=.55,device=0,verbose=False,save=False,batch=BATCH)
                batch_done(rr,batches,idxs,sids,grays);bar.update(len(batches));del rr;batches=[];idxs=[];sids=[];grays=[]
            fi+=1
        if batches:
            rr=model.predict(source=batches,imgsz=IMGSZ,conf=CONF,iou=.55,device=0,verbose=False,save=False,batch=len(batches))
            batch_done(rr,batches,idxs,sids,grays);bar.update(len(batches))
    finally:
        cap.release(); wr.release(); bar.close()
        motion_file.flush(); motion_file.close()
        pose_gz.flush(); pose_gz.close()
    try: del rr
    except Exception: pass
    try: del model
    except Exception: pass
    if torch.cuda.is_available():
        torch.cuda.synchronize(); torch.cuda.empty_cache()
    gc.collect()
    pd.DataFrame.from_records(cams).to_csv(OUT/"camera_motion.csv",index=False)
    gc.collect()
    cat=[]
    for tid,c in catalog.items():
        cat.append({"track_id":tid,"frames_detected":c["frames"],"first_frame":c["first"],"last_frame":c["last"],"duration_detected_sec":(c["last"]-c["first"])/m["fps"],"scene_ids":",".join(map(str,sorted(c["scene"]))),"mean_bbox_area":c["area"]/c["frames"],"mean_detection_confidence":c["conf"]/c["frames"],"mean_valid_keypoints":c["kp"]/c["frames"]})
    cat.sort(key=lambda x:x["frames_detected"],reverse=True);pd.DataFrame(cat).to_csv(OUT/"track_catalog.csv",index=False)
    total=m["frames"]; q={"source_frames":total,"processed_frames":fi,"all_frames_processed":fi==total,"frame_coverage":fi/max(1,total),"source_fps":m["fps"],"pose_model":"YOLO11n-Pose","imgsz":IMGSZ,"confidence":CONF,"detections":det_total,"frames_with_detection":frame_hits,"detection_frame_coverage":frame_hits/max(1,fi),"mean_valid_keypoints_per_detection":kpt_valid/max(1,det_total),"keypoint_valid_ratio":kpt_valid/max(1,kpt_total),"tracks":len(cat),"camera_samples":len(cams),"velocity_gap_limit_frames":2,"camera_method":"background Lucas-Kanade + RANSAC affine proxy","notes":["Anime poses may be missed by a human COCO-17 model.","Track IDs are shot-scoped and can split at occlusions/cuts.","Speed peaks are not asserted to be impacts.","2D poses are not 3D rig animation."]}
    (OUT/"motion_quality.json").write_text(json.dumps(q,indent=2),encoding="utf-8")
    log(f"Full frame processing: {fi}/{total}; detections={det_total}; coverage={q['detection_frame_coverage']:.3f}; tracks={len(cat)}")
    return q,cat

def audio(video):
    p=OUT/"source_audio.wav"; r=run(["ffmpeg","-y","-i",str(video),"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",str(p)],False,600)
    if r.returncode or not p.exists() or p.stat().st_size<1000:
        (OUT/"audio_status.json").write_text(json.dumps({"status":"unavailable","error":r.stderr[-1000:]},indent=2)); return
    import wave
    with wave.open(str(p),"rb") as w: data={"status":"extracted","channels":w.getnchannels(),"sample_rate":w.getframerate(),"duration":w.getnframes()/w.getframerate()}
    (OUT/"audio_status.json").write_text(json.dumps(data,indent=2))
    log(f"Audio extracted: {data['duration']:.2f}s")

def contact():
    from PIL import Image,ImageDraw
    ps=sorted(KF.glob("*.jpg"))
    if not ps:return
    tw,th,cols=320,180,4; sheet=Image.new("RGB",(cols*tw,math.ceil(len(ps)/cols)*(th+24)),(25,25,25));d=ImageDraw.Draw(sheet)
    for i,p in enumerate(ps):
        im=Image.open(p).convert("RGB");im.thumbnail((tw,th));x=(i%cols)*tw;y=(i//cols)*(th+24);sheet.paste(im,(x,y+24));d.text((x+4,y+4),p.stem,fill="white")
    sheet.save(OUT/"scene_keyframes_contact_sheet.jpg",quality=92)

def publish():
    import requests
    token=os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    if not token: raise RuntimeError("GitHub token unavailable for Release publishing.")
    log("Publish stage 1/5: inventory and checksums")
    inv=[]
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.name!="SHA256SUMS.json":inv.append({"path":str(p.relative_to(OUT)),"bytes":p.stat().st_size,"sha256":digest(p)})
    total_bytes=sum(x["bytes"] for x in inv)
    log(f"Publish inventory: {len(inv)} files / {total_bytes/1024/1024:.1f} MB")
    (OUT/"SHA256SUMS.json").write_text(json.dumps(inv,indent=2),encoding="utf-8")
    quality=json.loads((OUT/"motion_quality.json").read_text())
    hand={"project":"AL-DIDAH","version":2,"all_frames_processed":bool(quality.get("all_frames_processed",False)),"video_metadata":json.loads((OUT/"video_metadata.json").read_text()),"quality":quality,"character_assignment":"character_track_assignment.json (provisional; human review required)","outputs":[x["path"] for x in inv]+["SHA256SUMS.json"],"limitations":["This is inverse analysis, not recovery of the original authoring source code.","No hidden 3D, fingers or source rigs are recovered from MP4.","Final anime render still requires character turnaround, rigging, key animation and compositing."]}
    (OUT/"production_handoff.json").write_text(json.dumps(hand,indent=2),encoding="utf-8")
    zpath=BASE/"AL-DIDAH-production-v2.zip"
    log("Publish stage 2/5: building release archive")
    with zipfile.ZipFile(zpath,"w",zipfile.ZIP_DEFLATED,compresslevel=1) as z:
        for p in OUT.rglob("*"):
            if p.is_file():z.write(p,Path("outputs")/p.relative_to(OUT))
    log(f"Publish archive ready: {zpath.stat().st_size/1024/1024:.1f} MB")
    api=f"https://api.github.com/repos/{OWNER}/{REPO}";h={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}
    log("Publish stage 3/5: resolving GitHub release")
    r=requests.get(api+f"/releases/tags/{TAG}",headers=h,timeout=40)
    if r.status_code==404:r=requests.post(api+"/releases",headers=h,json={"tag_name":TAG,"name":"AL-DIDAH Full-Frame Motion Analysis v2","body":"Full source-frame analysis with shot-scoped tracks, per-joint curves, camera-motion proxy, character reference masters and QA overlay."},timeout=60)
    r.raise_for_status();rel=r.json(); upurl=rel["upload_url"].split("{")[0]
    log(f"Publish release ready: {rel['html_url']}")
    for a in rel.get("assets",[]):
        if a["name"]==zpath.name:
            d=requests.delete(api+f"/releases/assets/{a['id']}",headers=h,timeout=30)
            if d.status_code not in (204,404):d.raise_for_status()
    log("Publish stage 4/5: uploading release asset")
    with open(zpath,"rb") as f:u=requests.post(upurl+"?name="+zpath.name,headers={**h,"Content-Type":"application/zip"},data=f,timeout=1200)
    u.raise_for_status()
    log(f"Publish stage 5/5: asset uploaded ({u.json().get('size')} bytes)")
    receipt={"release":rel["html_url"],"asset":u.json()["browser_download_url"],"bytes":u.json()["size"],"tag":TAG}
    (OUT/"release_receipt.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
    log(f"GitHub Release uploaded: {receipt['asset']}")

def main():
    t=time.monotonic();log("=== AL-DIDAH v2 full-frame run ===");install()
    video,chars=inputs();m=probe(video);(OUT/"video_metadata.json").write_text(json.dumps(m,indent=2))
    ss=scenes(video,m);char_manifest=prep_chars(chars)
    log("Stage: full-frame analysis starting")
    q,cat=analyze(video,m,ss)
    if not q.get("all_frames_processed") or q.get("processed_frames") != q.get("source_frames"):
        raise RuntimeError("Incomplete frame analysis: refusing to publish a partial release.")
    log("Stage: full-frame analysis returned; extracting audio")
    audio(video)
    log("Stage: audio complete; building provisional track map and manifests")
    assignment={"status":"provisional_requires_visual_review","warning":"Map track IDs to the intended supplied characters after inspecting track_crops and overlay.","assignments":[{"track_id":x["track_id"],"character_id":f"CHAR_{i+1:02d}","provisional":True,"frames_detected":x["frames_detected"]} for i,x in enumerate(cat[:2])]}
    (OUT/"character_track_assignment.json").write_text(json.dumps(assignment,indent=2),encoding="utf-8")
    (OUT/"character_manifest.json").write_text(json.dumps(char_manifest,indent=2),encoding="utf-8")
    q["elapsed_seconds_before_publish"]=round(time.monotonic()-t,2);(OUT/"motion_quality.json").write_text(json.dumps(q,indent=2),encoding="utf-8")
    log("Stage: manifests ready; skipping optional contact-sheet montage to keep Colab post-processing lean")
    publish()
    log(f"=== COMPLETED in {time.monotonic()-t:.1f}s ===")

if __name__=="__main__":
    try:main()
    except Exception as e:
        log(f"FAILED: {type(e).__name__}: {e}");traceback.print_exc();raise
