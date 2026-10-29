#!/usr/bin/env python3
"""Audio-first, resumable Arabic dubbing pipeline for a long YouTube video."""
from __future__ import annotations
import asyncio, gc, hashlib, json, os, shutil, subprocess, sys, time, traceback
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

VIDEO_URL = os.getenv('VIDEO_URL', 'https://youtu.be/XuuU73TYTLY?si=aEkDepAMVBRMjvJS')
CHUNK_SECONDS = 600
BASE = Path('/content/audio-first-dub')
OUT = Path('/content/dub-output')
CHUNKS = BASE / 'audio_chunks'
DEMUCS = BASE / 'demucs_output'
CK = OUT / 'checkpoints'
VOCALS = CK / 'vocals'
BACKGROUND = CK / 'background'
TRANSCRIPTS = CK / 'transcripts'
EMBEDDINGS = CK / 'embeddings'
DUBBED = CK / 'dubbed_chunks'
CLIPS = CK / 'tts_clips'
VIDEO_OUT = OUT / 'Billionaire_Granny_CEO_Full_Arabic_Dub.mp4'
AUDIO_OUT = OUT / 'Billionaire_Granny_CEO_Full_Arabic_Audio.m4a'
REPORT_OUT = OUT / 'Billionaire_Granny_CEO_Quality_Report.json'
SRT_OUT = OUT / 'Billionaire_Granny_CEO_Full_Arabic_Subtitles.srt'
SEGMENTS_OUT = OUT / 'Billionaire_Granny_CEO_Dubbing_Metadata.json'
PROGRESS_OUT = OUT / 'Billionaire_Granny_CEO_Progress.json'
LOG_OUT = OUT / 'audio_first_dub.log'
STOP_FILE = OUT / 'STOP_REQUESTED'
MALE_VOICES = ['ar-SA-HamedNeural', 'ar-EG-ShakirNeural']
FEMALE_VOICES = ['ar-SA-ZariyahNeural', 'ar-EG-SalmaNeural', 'ar-AE-FatimaNeural']

def utc(): return datetime.now(timezone.utc).isoformat()
def log(msg):
    OUT.mkdir(parents=True, exist_ok=True)
    line = f'[{utc()}] {msg}'
    print(line, flush=True)
    # Never copy/mirror this live log while appending; that caused recursive log growth previously.
    with LOG_OUT.open('a', encoding='utf-8') as f:
        f.write(line + '\n'); f.flush()
def atomic_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)
def progress(stage, **extra):
    atomic_json(PROGRESS_OUT, {'task':'Audio-first Arabic dubbing', 'status':'IN_PROGRESS', 'stage':stage,
        'updated_at_utc':utc(), 'video_url':VIDEO_URL, 'chunk_seconds':CHUNK_SECONDS, **extra})
    log('STAGE=' + stage + (' ' + json.dumps(extra, ensure_ascii=False) if extra else ''))
def check_stop(where):
    if STOP_FILE.exists():
        progress('PAUSED_REQUESTED', stopped_after=where, resume_note='Checkpoints are exported in the workflow artifact.')
        raise SystemExit(75)
def run(cmd, label):
    log('START ' + label)
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
    if p.stdout:
        for line in p.stdout.splitlines()[-12:]: log(f'{label}: {line[-550:]}')
    if p.returncode: raise RuntimeError(f'{label} failed with exit code {p.returncode}')
def ffprobe(path):
    p = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels','-of','json',str(path)], capture_output=True, text=True)
    if p.returncode: raise RuntimeError(f'ffprobe failed for {path.name}: {p.stderr[-600:]}')
    d = json.loads(p.stdout); d['duration_seconds'] = float((d.get('format') or {}).get('duration') or 0); return d
def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''): h.update(b)
    return h.hexdigest()
def setup():
    for p in [BASE,OUT,CHUNKS,DEMUCS,VOCALS,BACKGROUND,TRANSCRIPTS,EMBEDDINGS,DUBBED,CLIPS]: p.mkdir(parents=True,exist_ok=True)

def download_audio_only():
    progress('downloading_audio_only')
    found=[p for p in BASE.glob('source_audio.*') if p.suffix.lower() in ('.m4a','.webm','.opus','.mp3') and p.stat().st_size>1_000_000]
    if found: src=max(found,key=lambda p:p.stat().st_mtime)
    else:
        run([sys.executable,'-m','yt_dlp','--no-playlist','--no-warnings','--retries','5','--fragment-retries','5','-f','bestaudio[ext=m4a]/bestaudio','-x','--audio-format','m4a','--audio-quality','0','-o',str(BASE/'source_audio.%(ext)s'),VIDEO_URL], 'Download audio-only stream')
        found=[p for p in BASE.glob('source_audio.*') if p.stat().st_size>1_000_000]
        if not found: raise FileNotFoundError('yt-dlp produced no source audio file.')
        src=max(found,key=lambda p:p.stat().st_mtime)
    info=ffprobe(src)
    if not any(s.get('codec_type')=='audio' for s in info.get('streams',[])): raise RuntimeError('Downloaded source has no audio stream.')
    if info['duration_seconds']<60: raise RuntimeError('Audio duration is unexpectedly short.')
    atomic_json(OUT/'source_audio_info.json', {'name':src.name,'size_bytes':src.stat().st_size,'sha256':sha256(src),'duration_seconds':info['duration_seconds']})
    log(f'AUDIO_ONLY_SOURCE_OK duration={info["duration_seconds"]:.1f}s bytes={src.stat().st_size}')
    return src

def split_audio(src):
    files=sorted(CHUNKS.glob('audio_*.flac'))
    if files: return files
    progress('splitting_audio_into_10_minute_chunks')
    run(['ffmpeg','-y','-v','error','-i',str(src),'-map','0:a:0','-f','segment','-segment_time',str(CHUNK_SECONDS),'-reset_timestamps','1','-c:a','flac','-compression_level','4',str(CHUNKS/'audio_%03d.flac')], 'Split into 10-minute FLAC chunks')
    files=sorted(CHUNKS.glob('audio_*.flac'))
    if not files: raise RuntimeError('Audio chunking produced no files.')
    atomic_json(OUT/'chunk_manifest.json', {'chunk_seconds':CHUNK_SECONDS,'chunks':[{'name':p.name,'size_bytes':p.stat().st_size} for p in files]})
    return files

def separate_stems(chunks, device):
    progress('separating_vocals_and_background',total_chunks=len(chunks))
    for i,ch in enumerate(chunks):
        check_stop(f'separation chunk {i}')
        vocal=VOCALS/f'vocals_{i:03d}.flac'; bg=BACKGROUND/f'background_{i:03d}.flac'
        if vocal.exists() and bg.exists() and vocal.stat().st_size>1000 and bg.stat().st_size>1000: continue
        run([sys.executable,'-m','demucs','-n','htdemucs','--device',device,'--shifts','1','--out',str(DEMUCS),str(ch)], f'Demucs chunk {i+1}/{len(chunks)}')
        candidates=list(DEMUCS.rglob(f'{ch.stem}/vocals.wav'))
        if not candidates: raise FileNotFoundError(f'Demucs vocals stem missing for {ch.stem}.')
        folder=candidates[0].parent
        for name in ('vocals','drums','bass','other'):
            if not (folder/f'{name}.wav').is_file(): raise FileNotFoundError(f'Demucs {name} stem missing.')
        run(['ffmpeg','-y','-v','error','-i',str(folder/'vocals.wav'),'-c:a','flac','-compression_level','5',str(vocal)], f'Save vocal stem {i+1}')
        run(['ffmpeg','-y','-v','error','-i',str(folder/'drums.wav'),'-i',str(folder/'bass.wav'),'-i',str(folder/'other.wav'),'-filter_complex','[0:a][1:a][2:a]amix=inputs=3:duration=longest:normalize=1,alimiter=limit=0.95[out]','-map','[out]','-c:a','flac','-compression_level','5',str(bg)], f'Combine non-vocal music/SFX stems {i+1}')
        shutil.rmtree(folder,ignore_errors=True); gc.collect()
        progress('separating_vocals_and_background',completed_chunks=i+1,total_chunks=len(chunks))

def transcribe(chunks, device):
    from faster_whisper import WhisperModel
    progress('transcribing_with_auto_language_and_word_timestamps',total_chunks=len(chunks))
    model=WhisperModel('small',device=device,compute_type='float16' if device=='cuda' else 'int8')
    langs={}
    for i in range(len(chunks)):
        check_stop(f'transcription chunk {i}')
        target=TRANSCRIPTS/f'transcript_{i:03d}.json'
        if target.exists():
            d=json.loads(target.read_text(encoding='utf-8')); langs[d.get('language','unknown')]=langs.get(d.get('language','unknown'),0)+1; continue
        source=VOCALS/f'vocals_{i:03d}.flac'
        segs,info=model.transcribe(str(source),language=None,beam_size=5,vad_filter=True,word_timestamps=True,condition_on_previous_text=False)
        rows=[]
        for seg in segs:
            txt=seg.text.strip()
            if not txt: continue
            words=[{'text':w.word,'start':round(float(w.start),3) if w.start is not None else None,'end':round(float(w.end),3) if w.end is not None else None} for w in (seg.words or [])]
            rows.append({'chunk_index':i,'start':round(float(seg.start),3),'end':round(float(seg.end),3),'global_start':round(i*CHUNK_SECONDS+float(seg.start),3),'global_end':round(i*CHUNK_SECONDS+float(seg.end),3),'source_text':txt,'words':words,'language':info.language})
        atomic_json(target,{'chunk_index':i,'language':info.language,'language_probability':round(float(info.language_probability),4),'segments':rows})
        langs[info.language]=langs.get(info.language,0)+1
        progress('transcribing_with_auto_language_and_word_timestamps',completed_chunks=i+1,total_chunks=len(chunks),segments=len(rows),last_language=info.language)
    del model
    try:
        import torch; torch.cuda.empty_cache()
    except Exception: pass
    allseg=[]
    for i in range(len(chunks)):
        d=json.loads((TRANSCRIPTS/f'transcript_{i:03d}.json').read_text(encoding='utf-8')); allseg.extend(d['segments'])
    if not allseg: raise RuntimeError('Whisper returned no speech segments.')
    log(f'LANGUAGE_COUNTS={json.dumps(langs)} segments={len(allseg)}')
    return allseg,langs

def cluster_speakers(segments, device):
    import numpy as np, librosa
    vectors=[]; method='speechbrain-ecapa'
    # Public pretrained speaker embeddings; no gated pyannote token is required.
    try:
        import torch
        try: from speechbrain.inference.speaker import EncoderClassifier
        except Exception: from speechbrain.pretrained import EncoderClassifier
        enc=EncoderClassifier.from_hparams(source='speechbrain/spkrec-ecapa-voxceleb',savedir=str(BASE/'models'/'ecapa'),run_opts={'device':device})
        for ci in range(len(sorted(CHUNKS.glob('audio_*.flac')))):
            cp=EMBEDDINGS/f'embeddings_{ci:03d}.json'
            rows=[(j,s) for j,s in enumerate(segments) if int(s['chunk_index'])==ci]
            if cp.exists():
                cached=json.loads(cp.read_text(encoding='utf-8'))
                for item in cached: vectors.append((int(item['global_index']),item.get('embedding'),item.get('pitch_hz')))
                continue
            wav,_=librosa.load(str(VOCALS/f'vocals_{ci:03d}.flac'),sr=16000,mono=True)
            results=[]
            for j,s in rows:
                check_stop(f'speaker embedding chunk {ci}')
                a=max(0,int(float(s['start'])*16000)); b=min(len(wav),int(float(s['end'])*16000)); clip=wav[a:b]
                emb=None; pitch=None
                if len(clip)>=int(.65*16000):
                    try:
                        if len(clip)>int(2.5*16000):
                            mid=len(clip)//2; clip=clip[mid-int(1.25*16000):mid+int(1.25*16000)]
                        ten=torch.tensor(clip,dtype=torch.float32,device=device).unsqueeze(0)
                        with torch.no_grad(): emb=enc.encode_batch(ten).reshape(-1).detach().cpu().numpy().astype(float).tolist()
                        p=librosa.yin(clip[:min(len(clip),32000)],fmin=65,fmax=300,sr=16000); p=p[np.isfinite(p)]
                        if len(p): pitch=float(np.median(p))
                    except Exception: emb=None
                item={'global_index':j,'embedding':emb,'pitch_hz':pitch}; results.append(item); vectors.append((j,emb,pitch))
            atomic_json(cp,results); del wav; gc.collect()
        del enc
        try: torch.cuda.empty_cache()
        except Exception: pass
    except Exception as exc:
        method='mfcc-timbre-fallback-low-confidence'; vectors=[]
        log(f'SPEAKER_MODEL_FALLBACK={type(exc).__name__}: {str(exc)[:250]}')
    if method.startswith('mfcc') or sum(1 for _,v,_ in vectors if v is not None)<3:
        method='mfcc-timbre-fallback-low-confidence'
        vectors=[]
        for ci in range(len(sorted(CHUNKS.glob('audio_*.flac')))):
            wav,_=librosa.load(str(VOCALS/f'vocals_{ci:03d}.flac'),sr=16000,mono=True)
            for j,s in [(j,s) for j,s in enumerate(segments) if int(s['chunk_index'])==ci]:
                a=max(0,int(float(s['start'])*16000)); b=min(len(wav),int(float(s['end'])*16000)); clip=wav[a:b]
                if len(clip)<4000: clip=np.pad(clip,(0,max(0,4000-len(clip))))
                mf=librosa.feature.mfcc(y=clip.astype(np.float32),sr=16000,n_mfcc=20)
                v=np.r_[mf.mean(axis=1),mf.std(axis=1)]; v=v/(np.linalg.norm(v)+1e-8)
                p=librosa.yin(clip[:min(len(clip),32000)],fmin=65,fmax=300,sr=16000); p=p[np.isfinite(p)]
                vectors.append((j,v.tolist(),float(np.median(p)) if len(p) else None))
            del wav; gc.collect()
    import numpy as np
    from sklearn.cluster import AgglomerativeClustering
    byidx={j:(np.asarray(v,dtype=np.float32),p) for j,v,p in vectors if v is not None}
    valid=sorted(byidx)
    if len(valid)<3: raise RuntimeError('Unable to form speaker embeddings for enough dialogue segments.')
    X=np.asarray([byidx[j][0] for j in valid],dtype=np.float32)
    threshold=0.35 if method=='speechbrain-ecapa' else 0.30
    try: cluster=AgglomerativeClustering(n_clusters=None,distance_threshold=threshold,metric='cosine',linkage='average')
    except TypeError: cluster=AgglomerativeClustering(n_clusters=None,distance_threshold=threshold,affinity='cosine',linkage='average')
    labels=cluster.fit_predict(X)
    if len(set(labels))>16:
        try: cluster=AgglomerativeClustering(n_clusters=16,metric='cosine',linkage='average')
        except TypeError: cluster=AgglomerativeClustering(n_clusters=16,affinity='cosine',linkage='average')
        labels=cluster.fit_predict(X); method += '+capped_16'
    assignment={j:int(lab) for j,lab in zip(valid,labels)}
    previous=assignment[valid[0]]
    for i,s in enumerate(segments):
        if i in assignment: previous=assignment[i]
        s['speaker_raw']=assignment.get(i,previous)
    order=[]
    for s in segments:
        if s['speaker_raw'] not in order: order.append(s['speaker_raw'])
    remap={v:i for i,v in enumerate(order)}
    for s in segments: s['speaker_id']=f'SPEAKER_{remap[s["speaker_raw"]]:02d}'
    profiles={}
    for sid in sorted({s['speaker_id'] for s in segments}):
        pitch=[byidx[i][1] for i,s in enumerate(segments) if s['speaker_id']==sid and i in byidx and byidx[i][1] is not None]
        medp=float(median(pitch)) if pitch else None; num=int(sid.split('_')[-1])
        if medp is not None and medp<145: presentation='lower-pitched / masculine-sounding (heuristic)'; voice=MALE_VOICES[num%len(MALE_VOICES)]
        elif medp is not None and medp>185: presentation='higher-pitched / feminine-sounding (heuristic)'; voice=FEMALE_VOICES[num%len(FEMALE_VOICES)]
        else: presentation='mid-range / undetermined (heuristic)'; voice=(MALE_VOICES+FEMALE_VOICES)[num%(len(MALE_VOICES)+len(FEMALE_VOICES))]
        profiles[sid]={'speaker_id':sid,'median_pitch_hz':round(medp,1) if medp else None,'vocal_presentation':presentation,'assigned_arabic_voice':voice,'age_estimate':'not reliably inferable from audio alone','confidence':'automatic clustering; human review recommended'}
    for s in segments: s.pop('speaker_raw',None)
    info={'method':method,'speaker_count':len(profiles),'speaker_profiles':profiles,'age_note':'Actual age cannot be reliably inferred from audio-only pitch. Voice category is a low-confidence acoustic cue.'}
    log(f'SPEAKER_DIARIZATION_METHOD={method}; SPEAKERS={len(profiles)}')
    return segments,info

async def make_tts(text, voice, output, rate):
    import edge_tts
    words=[]; comm=edge_tts.Communicate(text,voice=voice,rate=rate)
    with output.open('wb') as f:
        async for packet in comm.stream():
            if packet['type']=='audio': f.write(packet['data'])
            elif packet['type']=='WordBoundary': words.append({'text':packet.get('text',''),'offset_seconds':float(packet.get('offset',0))/10_000_000,'duration_seconds':float(packet.get('duration',0))/10_000_000})
    if not output.exists() or output.stat().st_size<1000: raise RuntimeError('Edge TTS returned an empty audio clip.')
    return words

def translate(source_text, source_language):
    from deep_translator import GoogleTranslator
    src=source_language if source_language else 'auto'; last=None
    for attempt in range(3):
        try: return GoogleTranslator(source=src,target='ar').translate(source_text) or ''
        except Exception as e: last=e; time.sleep(attempt+1)
    try: return GoogleTranslator(source='auto',target='ar').translate(source_text) or ''
    except Exception as e: raise RuntimeError(f'Arabic translation failed: {type(e).__name__}: {e}') from last

def dub_chunks(chunks, segments, speaker_info):
    from pydub import AudioSegment
    profiles=speaker_info['speaker_profiles']
    for ci,ch in enumerate(chunks):
        check_stop(f'TTS/mix chunk {ci}')
        destination=DUBBED/f'dubbed_{ci:03d}.m4a'
        if destination.exists() and destination.stat().st_size>10000: continue
        data_path=TRANSCRIPTS/f'transcript_{ci:03d}.json'
        data=json.loads(data_path.read_text(encoding='utf-8'))
        rows=data['segments']; bg=BACKGROUND/f'background_{ci:03d}.flac'
        canvas=AudioSegment.from_file(str(bg)); tmp=CLIPS/f'chunk_{ci:03d}'; tmp.mkdir(parents=True,exist_ok=True)
        for j,s in enumerate(rows):
            check_stop(f'TTS chunk {ci}, segment {j}')
            text_ar=s.get('arabic_text','').strip()
            if not text_ar:
                text_ar=translate(s['source_text'],s.get('language',data.get('language','auto')))
                if not text_ar.strip(): text_ar=s['source_text']
                s['arabic_text']=text_ar
                if j%5==0: atomic_json(data_path,data)
            sid=s.get('speaker_id','SPEAKER_00'); voice=profiles.get(sid,{}).get('assigned_arabic_voice',MALE_VOICES[0])
            mp3=tmp/f'seg_{j:05d}.mp3'; wordsfile=tmp/f'seg_{j:05d}.words.json'
            if mp3.exists() and mp3.stat().st_size>1000 and wordsfile.exists(): words=json.loads(wordsfile.read_text(encoding='utf-8'))
            else:
                words=asyncio.run(make_tts(text_ar,voice,mp3,'+12%' if len(text_ar)>80 else '+5%'))
                atomic_json(wordsfile,words)
            clip=AudioSegment.from_file(str(mp3)).set_frame_rate(canvas.frame_rate).set_channels(canvas.channels)
            start=max(0,float(s['start'])); end=max(start+.25,float(s['end'])); duration_slot=end-start; actual=len(clip)/1000
            tempo=min(1.8,max(1.0,actual/max(duration_slot,.15)))
            if tempo>1.001:
                fixed=tmp/f'seg_{j:05d}_fit.wav'
                run(['ffmpeg','-y','-v','error','-i',str(mp3),'-filter:a',f'atempo={tempo:.4f}','-ar',str(canvas.frame_rate),'-ac',str(canvas.channels),str(fixed)],f'Fit Arabic clip {ci}:{j}')
                clip=AudioSegment.from_file(str(fixed)).set_frame_rate(canvas.frame_rate).set_channels(canvas.channels)
            if int(start*1000)<len(canvas): canvas=canvas.overlay(clip+3,position=int(start*1000))
            s['arabic_word_timings']=[{'text':w['text'],'start':round(start+float(w['offset_seconds'])/tempo,3),'end':round(start+(float(w['offset_seconds'])+float(w['duration_seconds']))/tempo,3)} for w in words]
            s['tts_duration_seconds']=round(actual,3); s['applied_atempo']=round(tempo,3)
            if j%10==0: atomic_json(data_path,data)
        canvas.export(str(destination),format='ipod',bitrate='256k')
        atomic_json(data_path,data); shutil.rmtree(tmp,ignore_errors=True)
        progress('arabic_tts_and_background_remix',completed_chunks=ci+1,total_chunks=len(chunks),bytes=destination.stat().st_size)
        del canvas; gc.collect()

def build_srt(segments):
    def fmt(t):
        ms=max(0,round(float(t)*1000)); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000); return f'{h:02}:{m:02}:{s:02},{ms:03}'
    lines=[]
    for s in segments:
        text=s.get('arabic_text','').strip()
        if text:
            st=float(s.get('global_start',0)); en=max(st+.08,float(s.get('global_end',st+.5)))
            lines.append(f'{len(lines)+1}\n{fmt(st)} --> {fmt(en)}\n[{s.get("speaker_id","SPEAKER_00")}] {text}')
    SRT_OUT.write_text('\n\n'.join(lines)+'\n',encoding='utf-8')

def finalize(src_audio, chunks, segments, speaker_info, language_counts):
    progress('concatenating_dubbed_audio')
    concat=BASE/'dub_audio_concat.txt'; dubbed=sorted(DUBBED.glob('dubbed_*.m4a'))
    if len(dubbed)!=len(chunks): raise RuntimeError(f'Only {len(dubbed)}/{len(chunks)} dubbed chunks exist.')
    with concat.open('w',encoding='utf-8') as f:
        for p in dubbed: f.write("file '"+str(p)+"'\n")
    run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(concat),'-c:a','aac','-b:a','256k','-movflags','+faststart',str(AUDIO_OUT)],'Join the final Arabic audio track')
    progress('downloading_video_stream_for_final_mux')
    choices=[p for p in BASE.glob('source_video.*') if p.stat().st_size>10_000_000]
    if choices: video=max(choices,key=lambda p:p.stat().st_mtime)
    else:
        run([sys.executable,'-m','yt_dlp','--no-playlist','--no-warnings','--retries','5','-f','bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/bestvideo','-o',str(BASE/'source_video.%(ext)s'),VIDEO_URL],'Download video-only stream for final mux')
        choices=[p for p in BASE.glob('source_video.*') if p.stat().st_size>10_000_000]
        if not choices: raise FileNotFoundError('Cannot download a video-only stream for final mux.')
        video=max(choices,key=lambda p:p.stat().st_mtime)
    progress('muxing_and_verifying_final_mp4')
    run(['ffmpeg','-y','-v','error','-i',str(video),'-i',str(AUDIO_OUT),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-shortest','-movflags','+faststart',str(VIDEO_OUT)],'Mux final MP4')
    src_info=ffprobe(src_audio); final_info=ffprobe(VIDEO_OUT)
    if not any(s.get('codec_type')=='video' for s in final_info.get('streams',[])) or not any(s.get('codec_type')=='audio' for s in final_info.get('streams',[])): raise RuntimeError('Final MP4 is missing an audio/video stream.')
    if abs(final_info['duration_seconds']-src_info['duration_seconds'])>5: raise RuntimeError(f'Duration mismatch >5s: {final_info["duration_seconds"]:.1f}s vs {src_info["duration_seconds"]:.1f}s')
    run(['ffmpeg','-v','error','-i',str(VIDEO_OUT),'-f','null','-'],'Full decode verification of final MP4')
    build_srt(segments); atomic_json(SEGMENTS_OUT,{'source_url':VIDEO_URL,'source_language_by_chunk':language_counts,'speaker_info':speaker_info,'segments':segments})
    report={'status':'AUDIO_DUB_FINAL_VERIFIED','method':'Audio-only first; ten-minute chunks; Demucs htdemucs separation; Faster-Whisper auto-language + word timestamps; SpeechBrain voice embeddings with MFCC fallback; Arabic translation; Edge neural TTS with word-boundary events; music/non-vocal stems remixed after speech synthesis.',
      'source_url':VIDEO_URL,'source_audio_name':src_audio.name,'source_audio_sha256':sha256(src_audio),'source_audio_duration_seconds':round(src_info['duration_seconds'],3),
      'final_filename':VIDEO_OUT.name,'final_size_bytes':VIDEO_OUT.stat().st_size,'final_sha256':sha256(VIDEO_OUT),'final_duration_seconds':round(final_info['duration_seconds'],3),
      'source_languages_by_chunk':language_counts,'speech_segment_count':len(segments),'speaker_count':speaker_info['speaker_count'],'speaker_profiles':speaker_info['speaker_profiles'],'speaker_embedding_method':speaker_info['method'],
      'audio_timing':'Source word timestamps from Whisper; Arabic word boundaries from Edge TTS mapped through atempo. Long phrases may overlap adjacent dialogue when >1.8x speed is needed.',
      'music_and_sound_effects':'Demucs drums/bass/other stems are remixed as accompaniment after Arabic TTS. Music and effects are not semantically separated perfectly; residual vocals may remain.',
      'age_inference_note':'Actual age cannot be reliably established from audio pitch alone; voice categories are low-confidence acoustic estimates.',
      'visual_lip_sync':{'status':'NOT_PERFORMED','reason':'The pipeline replaces audio but does not change mouth motion or face frames.'},
      'quality_note':'Automated full-length dubbing draft; human review recommended. Not certified Netflix-level.',
      'checks':{'ffprobe_stream_check':'passed','full_ffmpeg_decode':'passed','duration_match':'passed','final_sha256':'computed'},'completed_at_utc':utc()}
    atomic_json(REPORT_OUT,report); atomic_json(OUT/'run_manifest.json',{'status':report['status'],'final_file':VIDEO_OUT.name,'final_size_bytes':report['final_size_bytes'],'final_sha256':report['final_sha256'],'completed_at_utc':utc()})
    progress('audio_dub_final_verified',final_path=str(VIDEO_OUT),final_size_bytes=VIDEO_OUT.stat().st_size,final_sha256=report['final_sha256'],duration_seconds=report['final_duration_seconds'])

def main():
    setup()
    try:
        import torch
        if not torch.cuda.is_available(): raise RuntimeError('Colab GPU is unavailable; refusing a multi-hour CPU run. The workflow must request T4.')
        gpu=torch.cuda.get_device_name(0); log(f'GPU={gpu}; VRAM_GiB={torch.cuda.get_device_properties(0).total_memory/(1024**3):.1f}')
        if shutil.disk_usage('/content').free < 8*1024**3: raise RuntimeError('Less than 8 GiB free disk; stopping before source download.')
        for c in ('ffmpeg','ffprobe'):
            if not shutil.which(c): raise RuntimeError(f'Missing command: {c}')
        src=download_audio_only(); chunks=split_audio(src); separate_stems(chunks,'cuda')
        segments,languages=transcribe(chunks,'cuda'); segments,speakers=cluster_speakers(segments,'cuda')
        for ci in range(len(chunks)):
            rows=[s for s in segments if int(s['chunk_index'])==ci]
            atomic_json(TRANSCRIPTS/f'transcript_{ci:03d}.json',{'chunk_index':ci,'language':rows[0]['language'] if rows else 'unknown','segments':rows})
        dub_chunks(chunks,segments,speakers); check_stop('before final mux'); finalize(src,chunks,segments,speakers,languages)
        log('AUDIO_DUB_FINAL_VERIFIED')
    except SystemExit: raise
    except Exception as exc:
        old=json.loads(PROGRESS_OUT.read_text(encoding='utf-8')) if PROGRESS_OUT.exists() else {}
        atomic_json(PROGRESS_OUT,{'status':'FAILED_RESUMABLE','stage':old.get('stage','unknown'),'error_type':type(exc).__name__,'error':str(exc),'traceback':traceback.format_exc()[-10000:],'updated_at_utc':utc(),'resume_note':'Completed vocals/background stems, per-chunk transcripts and dubbed audio are stored in /content/dub-output/checkpoints while the Colab VM exists.'})
        log(f'ERROR {type(exc).__name__}: {exc}'); print(traceback.format_exc(),file=sys.stderr,flush=True); raise

if __name__=='__main__': main()
