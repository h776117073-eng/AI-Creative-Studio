import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { parseWithOpenAI, type EditCommand } from './aiProvider.js';

export function registerAIRoute(app:Express,db:Database.Database){
  app.post('/api/projects/:id/ai-command',async(req,res)=>{
    try{
      const projectId=String(req.params.id);const p:any=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);if(!p)return res.status(404).json({error:'Project not found'});
      const timeline=JSON.parse(p.timeline_json);timeline.currentTime=Number(req.body?.playhead??timeline.currentTime??0);const activeClipId=String(req.body?.clipId||'');
      const fallback:EditCommand={type:'noop',message:'يمكنني تنفيذ أدوات التحرير المتاحة من شريط الأدوات.'};const command=await parseWithOpenAI(String(req.body?.text||''),timeline,fallback,activeClipId);
      if(command.type==='noop')return res.json({provider:process.env.AI_API_KEY||process.env.OPENAI_API_KEY?'ai':'local',command,timeline});
      const out=structuredClone(timeline);let owner:any=null;let target:any=null;
      for(const track of out.tracks){const found=track.clips?.find((c:any)=>c.id===command.clipId);if(found){owner=track;target=found;break;}}
      if(!target&&command.type!=='add_text'){for(const track of out.tracks){if(track.clips?.length){owner=track;target=track.clips[0];break;}}}

      if(command.type==='add_text'){
        let track=out.tracks.find((t:any)=>t.type==='text');if(!track){track={id:randomUUID(),name:'Text',type:'text',clips:[],muted:false,locked:false,visible:true,height:64,order:2};out.tracks.push(track);}
        const start=Math.max(0,Number(command.time??out.currentTime??0));const clip={id:randomUUID(),assetId:'',name:command.text||'نص',text:command.text||'نص جديد',startTime:start,endTime:start+3,trimStart:0,trimEnd:3,duration:3,fontSize:48,color:'#ffffff',opacity:1,align:'center',position:'center',keyframes:[]};track.clips.push(clip);
      }else if(!target){return res.json({provider:'local',command:{type:'noop',message:'لا يوجد مقطع يمكن تعديله.'},timeline});}
      else {
        target.effects=Array.isArray(target.effects)?target.effects:[];
        if(command.type==='split'){
          const t=Number(command.time);if(!(t>target.startTime&&t<target.endTime))return res.json({provider:'local',command:{type:'noop',message:`نقطة التقسيم ${t.toFixed(2)} ثانية خارج المقطع.`},timeline});
          const ratio=(t-target.startTime)/(target.endTime-target.startTime);const second=structuredClone(target);second.id=randomUUID();second.startTime=t;second.endTime=target.endTime;second.duration=second.endTime-second.startTime;if(owner.type==='video'||owner.type==='audio'){second.trimStart=target.trimStart+(target.trimEnd-target.trimStart)*ratio;target.endTime=t;target.duration=t-target.startTime;}owner.clips.splice(owner.clips.indexOf(target),1,target,second);
        }else if(command.type==='delete')owner.clips=owner.clips.filter((c:any)=>c.id!==target.id);
        else if(command.type==='move'){const s=Math.max(0,Number(command.startTime||0));target.startTime=s;target.endTime=s+target.duration;}
        else if(command.type==='trim_start'){const s=Math.max(0,Number(command.time||0));if(s>=target.trimEnd)return res.json({provider:'local',command:{type:'noop',message:'قيمة القص أكبر من مدة المقطع.'},timeline});const d=s-target.trimStart;target.trimStart=s;target.startTime=Math.max(0,target.startTime+d);target.duration=Math.max(.01,target.endTime-target.startTime);}
        else if(command.type==='trim_end'){const e=Math.max(target.trimStart+.01,Number(command.time||target.trimEnd));target.trimEnd=Math.min(e,target.trimEnd);target.endTime=target.startTime+(target.trimEnd-target.trimStart);target.duration=Math.max(.01,target.endTime-target.startTime);}
        else if(command.type==='set_volume')target.volume=Math.max(0,Math.min(4,Number(command.value??1)));
        else if(command.type==='set_speed')target.speed=Math.max(.25,Math.min(4,Number(command.value??1)));
        else if(command.type==='rotate')target.rotate=((Number(command.value??90)%360)+360)%360;
        else if(command.type==='flip_h')target.flipH=!target.flipH;
        else if(command.type==='flip_v')target.flipV=!target.flipV;
        else if(command.type==='set_brightness')target.brightness=Math.max(-1,Math.min(1,Number(command.value??0)));
        else if(command.type==='set_contrast')target.contrast=Math.max(.1,Math.min(4,Number(command.value??1)));
        else if(command.type==='set_saturation')target.saturation=Math.max(0,Math.min(4,Number(command.value??1)));
        else if(command.type==='grayscale')target.grayscale=!target.grayscale;
        else if(command.type==='fade_in')target.fadeIn=Math.max(.1,Number(command.value??1));
        else if(command.type==='fade_out')target.fadeOut=Math.max(.1,Number(command.value??1));
        else if(command.type==='set_effect'){const effect=String(command.effect||'').toLowerCase();target.effects=target.effects.filter((e:string)=>e!==effect);if(effect)target.effects.push(effect);}
        else if(command.type==='set_transition')target.transition={type:command.transition||'fade',duration:Math.max(.1,Number(command.value??.5))};
        else if(command.type==='set_text')target.text=command.text||target.text||'';
      }
      out.tracks.forEach((t:any)=>t.clips.sort((a:any,b:any)=>a.startTime-b.startTime));out.duration=Math.max(0,...out.tracks.flatMap((t:any)=>t.clips.map((c:any)=>c.endTime)));out.currentTime=Number(command.time??out.currentTime??0);
      const history=JSON.parse(p.history_json).slice(0,Number(p.history_index)+1);history.push(out);const bounded=history.slice(-100);db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(out),JSON.stringify(bounded),bounded.length-1,new Date().toISOString(),projectId);
      res.json({provider:process.env.AI_BASE_URL||process.env.AI_API_KEY||process.env.OPENAI_API_KEY?'ai':'local',command,timeline:out});
    }catch(error){console.error('ai-command failed',error);res.status(500).json({error:'Failed to execute AI command'});}
  });
}
