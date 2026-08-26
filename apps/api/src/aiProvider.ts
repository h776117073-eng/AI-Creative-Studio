export type EditCommand = {
  type:'split'|'delete'|'move'|'trim_start'|'trim_end'|'set_volume'|'set_speed'|'rotate'|'flip_h'|'flip_v'|'set_brightness'|'set_contrast'|'set_saturation'|'grayscale'|'fade_in'|'fade_out'|'add_text'|'set_text'|'set_effect'|'set_transition'|'noop';
  time?:number; startTime?:number; value?:number; clipId?:string; text?:string; effect?:string; transition?:string; message?:string;
};
function numberFrom(text:string){const m=text.match(/(\d+(?:[.,]\d+)?)/);return m?Number(m[1].replace(',','.')):undefined;}
function clipFor(timeline:any,activeClipId?:string){const tracks=timeline?.tracks||[];for(const track of tracks){const found=(track.clips||[]).find((c:any)=>c.id===activeClipId);if(found)return found;}for(const type of ['video','audio','text','overlay']){const found=tracks.find((t:any)=>t.type===type)?.clips?.[0];if(found)return found;}return tracks.find((t:any)=>(t.clips||[]).length)?.clips?.[0];}
export function localCommand(text:string,timeline:any,activeClipId?:string):EditCommand{
  const s=text.toLowerCase().replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim();const clip=clipFor(timeline,activeClipId);const n=numberFrom(s);
  if(/(أضف نص|اضف نص|اكتب|عنوان|نص:|text:)/.test(s)){const raw=text.replace(/^(\s*)(أضف نص|اضف نص|اكتب|عنوان|نص\s*:|text\s*:)[\s:]*/i,'').trim();return{type:'add_text',text:raw||'نص جديد',time:n??timeline?.currentTime??0,message:'أضفت النص عند مؤشر التشغيل.'};}
  if(!clip)return{type:'noop',message:'أضف وسائط أولًا.'};
  if(/(قسّم|قسم|split)/.test(s))return{type:'split',time:/نصف|نصفين|half/.test(s)?clip.startTime+clip.duration/2:(n??timeline?.currentTime??clip.startTime+clip.duration/2),clipId:clip.id,message:'قسّمت المقطع عند مؤشر التشغيل.'};
  if(/(احذف|حذف|أزل|ازل|remove|delete)/.test(s))return{type:'delete',clipId:clip.id,message:'حذفت المقطع المحدد.'};
  if(/(حرّك|حرك|انقل|نقل|move)/.test(s)&&n!==undefined)return{type:'move',startTime:Math.max(0,n),clipId:clip.id,message:`نقلت المقطع إلى ${n} ثانية.`};
  if(/(آخر|النهاية|end|last)/.test(s)&&/(قص|اقطع|trim)/.test(s)&&n!==undefined)return{type:'trim_end',time:Math.max(clip.trimStart+.01,clip.trimEnd-n),clipId:clip.id,message:`قصصت آخر ${n} ثانية.`};
  if(/(بداية|أول|اول|start)/.test(s)&&/(قص|اقطع|trim)/.test(s)&&n!==undefined)return{type:'trim_start',time:Math.max(0,n),clipId:clip.id,message:`قصصت أول ${n} ثانية.`};
  if(/(صوت|volume|مستوى)/.test(s)&&n!==undefined)return{type:'set_volume',value:Math.max(0,Math.min(4,n>4?n/100:n)),clipId:clip.id,message:`ضبطت الصوت إلى ${n}%.`};
  if(/(كتم|mute)/.test(s))return{type:'set_volume',value:0,clipId:clip.id,message:'تم كتم الصوت.'};
  if(/(سرعة|speed|تسريع|تبطيء)/.test(s)){const v=n!==undefined?(n>4?n/100:n):1;return{type:'set_speed',value:Math.max(.25,Math.min(4,v)),clipId:clip.id,message:`ضبطت السرعة إلى ${Math.round(Math.max(.25,Math.min(4,v))*100)}%.`};}
  if(/(تدوير|دور|rotate)/.test(s))return{type:'rotate',value:n===undefined?90:n,clipId:clip.id,message:`دوّرت المقطع ${n??90} درجة.`};
  if(/(قلب|flip)/.test(s)&&/(أفقي|افقي|horizontal)/.test(s))return{type:'flip_h',clipId:clip.id,message:'قلبت المقطع أفقيًا.'};
  if(/(قلب|flip)/.test(s)&&/(رأسي|راسي|vertical)/.test(s))return{type:'flip_v',clipId:clip.id,message:'قلبت المقطع رأسيًا.'};
  if(/(سطوع|brightness)/.test(s)&&n!==undefined)return{type:'set_brightness',value:Math.max(-1,Math.min(1,n>1?n/100:n)),clipId:clip.id,message:'تم ضبط السطوع.'};
  if(/(تباين|contrast)/.test(s)&&n!==undefined)return{type:'set_contrast',value:Math.max(.1,Math.min(4,n>4?n/100:n)),clipId:clip.id,message:'تم ضبط التباين.'};
  if(/(تشبع|saturation)/.test(s)&&n!==undefined)return{type:'set_saturation',value:Math.max(0,Math.min(4,n>4?n/100:n)),clipId:clip.id,message:'تم ضبط التشبع.'};
  if(/(أبيض وأسود|ابيض واسود|grayscale|black and white)/.test(s))return{type:'grayscale',clipId:clip.id,message:'تم تحويل المقطع إلى أبيض وأسود.'};
  if(/(تمويه|blur)/.test(s))return{type:'set_effect',effect:'blur',clipId:clip.id,message:'تم تطبيق التمويه.'};
  if(/(vignette|تغميق الأطراف)/.test(s))return{type:'set_effect',effect:'vignette',clipId:clip.id,message:'تم تطبيق تغميق الأطراف.'};
  if(/(تلاشي|fade).*(دخول|بداية|in)/.test(s))return{type:'fade_in',value:n??1,clipId:clip.id,message:'تمت إضافة تلاشي دخول.'};
  if(/(تلاشي|fade).*(خروج|نهاية|out)/.test(s))return{type:'fade_out',value:n??1,clipId:clip.id,message:'تمت إضافة تلاشي خروج.'};
  if(/(انتقال|transition)/.test(s)&&/(fade|تلاشي)/.test(s))return{type:'set_transition',transition:'fade',clipId:clip.id,value:n??0.5,message:'تمت إضافة انتقال تلاشي.'};
  if(/(انتقال|transition)/.test(s)&&/(dissolve|ذوبان|مزج)/.test(s))return{type:'set_transition',transition:'dissolve',clipId:clip.id,value:n??0.5,message:'تمت إضافة انتقال مزج.'};
  if(/(انتقال|transition)/.test(s)&&/(zoom|تكبير)/.test(s))return{type:'set_transition',transition:'zoom',clipId:clip.id,value:n??0.5,message:'تمت إضافة انتقال تكبير.'};
  const effectRules:[RegExp,string,string][]=[
    [/(قالب|template).*(سينمائي|cinematic)/,'cinematic','تم تطبيق القالب السينمائي.'],[(/vlog/),'vlog','تم تطبيق قالب Vlog.'],[/(ريلز|reels)/,'reels','تم تطبيق قالب ريلز.'],
    [/(تحسين الصوت|حسّن الصوت|voice enhance|noise)/,'voice-enhance','تم تحسين الصوت.'],[(/تمويه/),'blur','تم تطبيق التمويه.'],[/(وهج|glow)/,'glow','تم تطبيق الوهج.'],[/(حبيبات|grain|film grain)/,'grain','تم تطبيق حبيبات الفيلم.'],
    [/(ليلي|سينمائية زرقاء|night)/,'night','تم تطبيق المعالجة الليلية السينمائية.'],[/(ملصق|sticker)/,'sticker','تمت إضافة الملصق.'],[/(رموز|emoji)/,'emoji','تمت إضافة الرموز.'],[/(تراكب|overlay|طبقة)/,'overlay','تمت إضافة طبقة التراكب.'],
    [/(نص متحرك|animated text)/,'animated-text','تمت إضافة حركة للنص.'],[/(ترجمة تلقائية|auto captions|captions)/,'auto-captions','تم إنشاء مسار ترجمة تلقائية.'],[/(حذف الصمت|قص الصمت|silence)/,'silence-cut','تم تحليل الصمت وتطبيق قصه.'],
    [/(مزامنة الإيقاع|beat sync|beats)/,'beat-sync','تمت مزامنة القطع مع الإيقاع.'],[/(تحسين الجودة|enhance|upscale)/,'enhance','تم تطبيق تحسين الجودة.'],[/(حركة كاميرا|camera motion)/,'camera-motion','تم تطبيق حركة كاميرا سينمائية.'],
    [/(تتبع الحركة|tracking|motion track)/,'tracking','تم تفعيل تتبع الحركة.'],[/(تسجيل|تعليق صوتي|voiceover)/,'voiceover','تم تجهيز مسار التعليق الصوتي.'],[/(تجميد|freeze)/,'freeze','تم تثبيت الإطار الحالي.'],[/(لقطة|snapshot)/,'snapshot','تم حفظ لقطة الإطار.'],
    [/(مفتاح AI|ai)/,'ai-pass','تم تشغيل أداة الذكاء الاصطناعي.']
  ];
  for(const [rx,effect,message] of effectRules)if(rx.test(s))return{type:'set_effect',effect,clipId:clip.id,message};
  return{type:'noop',message:'استخدم أدوات التحرير المتاحة أو اكتب أمرًا مباشرًا.'};
}
export async function parseWithOpenAI(text:string,timeline:any,fallback:EditCommand,activeClipId?:string):Promise<EditCommand>{
  const clip=clipFor(timeline,activeClipId);const local=localCommand(text,timeline,activeClipId);const base=process.env.AI_BASE_URL||'https://api.openai.com/v1';const key=process.env.AI_API_KEY||process.env.OPENAI_API_KEY;const model=process.env.AI_MODEL||process.env.OPENAI_MODEL;
  if(!key||!model)return local.type==='noop'?fallback:local;
  const tool={type:'function',name:'edit_timeline',description:'Edit the selected media clip at the playhead.',parameters:{type:'object',properties:{type:{type:'string',enum:['split','delete','move','trim_start','trim_end','set_volume','set_speed','rotate','flip_h','flip_v','set_brightness','set_contrast','set_saturation','grayscale','fade_in','fade_out','add_text','set_text','set_effect','set_transition','noop']},time:{type:'number'},startTime:{type:'number'},value:{type:'number'},clipId:{type:'string'},text:{type:'string'},effect:{type:'string'},transition:{type:'string'}},required:['type'],additionalProperties:false},strict:true};
  try{const r=await fetch(`${base.replace(/\/$/,'')}/responses`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,input:[{role:'system',content:'You are a professional mobile video editor command parser. Understand Arabic and English. Respect the selected clip and playhead. Return exactly one edit_timeline function call.'},{role:'user',content:`Playhead: ${timeline?.currentTime??0}\nSelected clip: ${JSON.stringify(clip||{})}\nRequest: ${text}`}],tools:[tool],tool_choice:{type:'function',name:'edit_timeline'}})});if(!r.ok)return local;const data:any=await r.json();const call=(data.output||[]).find((x:any)=>x.type==='function_call'&&x.name==='edit_timeline');if(!call)return local;const args=JSON.parse(call.arguments||'{}');return{...args,clipId:args.clipId||clip?.id,message:args.type==='noop'?'لم أفهم الأمر.':'تم تفسير الأمر وتنفيذه.'} as EditCommand;}catch{return local;}
}
