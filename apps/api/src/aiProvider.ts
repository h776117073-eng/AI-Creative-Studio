export type EditCommand = {
  type:'split'|'delete'|'move'|'trim_start'|'trim_end'|'noop';
  time?:number;
  startTime?:number;
  clipId?:string;
  message?:string;
};

function numberFrom(text:string):number|undefined {
  const m=text.match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',','.')) : undefined;
}

function localCommand(text:string, clip:any):EditCommand {
  const s=text.toLowerCase().replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim();
  if(!clip) return {type:'noop',message:'أضف فيديو أولًا حتى أستطيع تعديله.'};

  if(/\b(noop|لا شيء)\b/.test(s)) return {type:'noop',message:'لم أجرِ أي تغيير.'};

  if(/(احذف|حذف|أزل|ازل|remove|delete)(?:\s+(المقطع|المقطع المحدد|clip))?$/.test(s)) {
    return {type:'delete',clipId:clip.id,message:'حذفت المقطع المحدد.'};
  }

  if(/(قسّم|قسم|split)/.test(s)) {
    if(/نصف|نصفين|half/.test(s)) {
      const midpoint=clip.startTime + clip.duration/2;
      return {type:'split',time:midpoint,clipId:clip.id,message:'قسّمت المقطع إلى نصفين.'};
    }
    const n=numberFrom(s);
    if(n!==undefined) return {type:'split',time:n,clipId:clip.id,message:`قسّمت المقطع عند ${n} ثانية.`};
  }

  if(/(حرّك|حرك|انقل|نقل|move)/.test(s)) {
    const n=numberFrom(s);
    if(n!==undefined) return {type:'move',startTime:Math.max(0,n),clipId:clip.id,message:`نقلت المقطع إلى ${n} ثانية.`};
  }

  if(/(آخر|النهاية|end|last)/.test(s) && /(قص|اقطع|trim)/.test(s)) {
    const n=numberFrom(s);
    if(n!==undefined) {
      const endTime=Math.max(clip.trimStart+0.01,clip.trimEnd-n);
      return {type:'trim_end',time:endTime,clipId:clip.id,message:`قصصت آخر ${n} ثانية من المقطع.`};
    }
  }

  if(/(بداية|أول|اول|start)/.test(s) && /(قص|اقطع|trim)/.test(s)) {
    const n=numberFrom(s);
    if(n!==undefined) return {type:'trim_start',time:Math.max(0,n),clipId:clip.id,message:`قصصت أول ${n} ثانية من المقطع.`};
  }

  if(/(قص|اقطع|trim)/.test(s)) {
    const n=numberFrom(s);
    if(n!==undefined) return {type:'trim_start',time:Math.max(0,n),clipId:clip.id,message:`قصصت بداية المقطع إلى ${n} ثانية.`};
  }

  return {type:'noop',message:'لم أفهم الأمر. جرّب: قص أول 2 ثانية، قص آخر 2 ثانية، قسّم عند 5، انقل إلى 3، أو احذف المقطع.'};
}

export async function parseWithOpenAI(text:string, timeline:any, fallback:EditCommand, activeClipId?:string):Promise<EditCommand> {
  const clips=timeline?.tracks?.find((t:any)=>t.type==='video')?.clips || [];
  const clip=clips.find((c:any)=>c.id===activeClipId) || clips[0];
  const local=localCommand(text,clip);
  const key=process.env.OPENAI_API_KEY;
  if(!key) return local;

  const model=process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const tool={type:'function',name:'edit_timeline',description:'Edit the active video timeline clip.',parameters:{type:'object',properties:{type:{type:'string',enum:['split','delete','move','trim_start','trim_end','noop']},time:{type:'number',minimum:0},startTime:{type:'number',minimum:0},clipId:{type:'string'}},required:['type'],additionalProperties:false},strict:true};
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,input:[{role:'system',content:'You are a video editing command parser. Return exactly one edit_timeline function call. Understand Arabic and English editing requests. Use the active clip metadata to translate relative requests such as cutting the last N seconds or splitting in half into exact timeline values.'},{role:'user',content:`Active clip: ${JSON.stringify(clip||{})}. User request: ${text}`}],tools:[tool],tool_choice:{type:'function',name:'edit_timeline'}})});
    if(!response.ok) return local;
    const data:any=await response.json();
    const call=(data.output||[]).find((item:any)=>item.type==='function_call'&&item.name==='edit_timeline');
    if(!call) return local;
    const args=JSON.parse(call.arguments||'{}');
    return {...args,clipId:args.clipId||clip?.id,message:args.type==='noop'?'لم أفهم الأمر.':'تم تفسير الأمر وتنفيذه.'} as EditCommand;
  } catch {
    return local;
  }
}
