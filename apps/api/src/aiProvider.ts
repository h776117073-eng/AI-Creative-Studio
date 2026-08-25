export type EditCommand = {
  type:'split'|'delete'|'move'|'trim_start'|'trim_end'|'set_volume'|'set_speed'|'rotate'|'flip_h'|'flip_v'|'set_brightness'|'set_contrast'|'set_saturation'|'grayscale'|'fade_in'|'fade_out'|'noop';
  time?:number; startTime?:number; value?:number; clipId?:string; message?:string;
};
function numberFrom(text:string){const m=text.match(/(\d+(?:[.,]\d+)?)/);return m?Number(m[1].replace(',','.')):undefined;}
function clipFor(timeline:any,activeClipId?:string){const tracks=timeline?.tracks||[];for(const track of tracks){const found=(track.clips||[]).find((c:any)=>c.id===activeClipId);if(found)return found;}for(const type of ['video','audio']){const found=tracks.find((t:any)=>t.type===type)?.clips?.[0];if(found)return found;}return tracks.find((t:any)=>(t.clips||[]).length)?.clips?.[0];}
function localCommand(text:string,timeline:any,activeClipId?:string):EditCommand{
  const s=text.toLowerCase().replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim(); const clip=clipFor(timeline,activeClipId); if(!clip)return{type:'noop',message:'أضف وسائط أولًا.'}; const n=numberFrom(s);
  if(/(احذف|حذف|أزل|ازل|remove|delete)/.test(s))return{type:'delete',clipId:clip.id,message:'حذفت المقطع المحدد.'};
  if(/(قسّم|قسم|split)/.test(s)){const t=/نصف|نصفين|half/.test(s)?clip.startTime+clip.duration/2:(n??clip.startTime+clip.duration/2);return{type:'split',time:t,clipId:clip.id,message:'قسّمت المقطع.'};}
  if(/(حرّك|حرك|انقل|نقل|move)/.test(s)&&n!==undefined)return{type:'move',startTime:Math.max(0,n),clipId:clip.id,message:`نقلت المقطع إلى ${n} ثانية.`};
  if(/(آخر|النهاية|end|last)/.test(s)&&/(قص|اقطع|trim)/.test(s)&&n!==undefined)return{type:'trim_end',time:Math.max(clip.trimStart+.01,clip.trimEnd-n),clipId:clip.id,message:`قصصت آخر ${n} ثانية.`};
  if(/(بداية|أول|اول|start)/.test(s)&&/(قص|اقطع|trim)/.test(s)&&n!==undefined)return{type:'trim_start',time:Math.max(0,n),clipId:clip.id,message:`قصصت أول ${n} ثانية.`};
  if(/(صوت|volume|مستوى)/.test(s)&&n!==undefined)return{type:'set_volume',value:Math.max(0,Math.min(4,n>2?n/100:n)),clipId:clip.id,message:`ضبطت الصوت إلى ${n}%.`};
  if(/(كتم|mute)/.test(s))return{type:'set_volume',value:0,clipId:clip.id,message:'تم كتم الصوت.'};
  if(/(سرعة|speed|تسريع|تبطيء)/.test(s)){const v=n!==undefined?(n>4?n/100:n):1;return{type:'set_speed',value:Math.max(.25,Math.min(4,v)),clipId:clip.id,message:`ضبطت السرعة إلى ${Math.round(Math.max(.25,Math.min(4,v))*100)}%.`};}
  if(/(تدوير|rotate)/.test(s))return{type:'rotate',value:n===undefined?90:n,clipId:clip.id,message:`دوّرت المقطع ${n??90} درجة.`};
  if(/(قلب|flip)/.test(s)&&/(أفقي|افقي|horizontal)/.test(s))return{type:'flip_h',clipId:clip.id,message:'قلبت المقطع أفقيًا.'};
  if(/(قلب|flip)/.test(s)&&/(رأسي|راسي|vertical)/.test(s))return{type:'flip_v',clipId:clip.id,message:'قلبت المقطع رأسيًا.'};
  if(/(سطوع|brightness)/.test(s)&&n!==undefined)return{type:'set_brightness',value:Math.max(-1,Math.min(1,n>1?n/100:n)),clipId:clip.id,message:'تم ضبط السطوع.'};
  if(/(تباين|contrast)/.test(s)&&n!==undefined)return{type:'set_contrast',value:Math.max(.1,Math.min(4,n>4?n/100:n)),clipId:clip.id,message:'تم ضبط التباين.'};
  if(/(تشبع|saturation)/.test(s)&&n!==undefined)return{type:'set_saturation',value:Math.max(0,Math.min(4,n>4?n/100:n)),clipId:clip.id,message:'تم ضبط التشبع.'};
  if(/(أبيض وأسود|ابيض واسود|grayscale|black and white)/.test(s))return{type:'grayscale',clipId:clip.id,message:'تم تحويل المقطع إلى أبيض وأسود.'};
  if(/(تلاشي|fade).*(دخول|بداية|in)/.test(s))return{type:'fade_in',value:n??1,clipId:clip.id,message:'تمت إضافة تلاشي دخول.'};
  if(/(تلاشي|fade).*(خروج|نهاية|out)/.test(s))return{type:'fade_out',value:n??1,clipId:clip.id,message:'تمت إضافة تلاشي خروج.'};
  if(/(قص|اقطع|trim)/.test(s)&&n!==undefined)return{type:'trim_start',time:Math.max(0,n),clipId:clip.id,message:`قصصت بداية المقطع إلى ${n} ثانية.`};
  return{type:'noop',message:'يمكنني تنفيذ القص والتقسيم والتحريك والصوت والسرعة والتدوير والقلب والألوان والتلاشي.'};
}
export async function parseWithOpenAI(text:string,timeline:any,fallback:EditCommand,activeClipId?:string):Promise<EditCommand>{
  const clip=clipFor(timeline,activeClipId); const local=localCommand(text,timeline,activeClipId); const base=process.env.AI_BASE_URL||'https://api.openai.com/v1'; const key=process.env.AI_API_KEY||process.env.OPENAI_API_KEY; const model=process.env.AI_MODEL||process.env.OPENAI_MODEL;
  if(!key||!model)return local.type==='noop'?fallback:local;
  const tool={type:'function',name:'edit_timeline',description:'Edit the selected timeline clip.',parameters:{type:'object',properties:{type:{type:'string',enum:['split','delete','move','trim_start','trim_end','set_volume','set_speed','rotate','flip_h','flip_v','set_brightness','set_contrast','set_saturation','grayscale','fade_in','fade_out','noop']},time:{type:'number'},startTime:{type:'number'},value:{type:'number'},clipId:{type:'string'}},required:['type'],additionalProperties:false},strict:true};
  try{const r=await fetch(`${base.replace(/\/$/,'')}/responses`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,input:[{role:'system',content:'You are a professional video editor command parser. Understand Arabic and English. Return exactly one edit_timeline function call. Use the selected clip metadata and allow video or audio clips.'},{role:'user',content:`Selected clip: ${JSON.stringify(clip||{})}\nRequest: ${text}`}],tools:[tool],tool_choice:{type:'function',name:'edit_timeline'}})});if(!r.ok)return local;const data:any=await r.json();const call=(data.output||[]).find((x:any)=>x.type==='function_call'&&x.name==='edit_timeline');if(!call)return local;const args=JSON.parse(call.arguments||'{}');return{...args,clipId:args.clipId||clip?.id,message:args.type==='noop'?'لم أفهم الأمر.':'تم تفسير الأمر وتنفيذه.'} as EditCommand;}catch{return local;}
}
