import {getConnectionOptions,generateProfileText} from './services.js';
import {customRequest,asMessages} from '../core/llm.js';
import {getWorldRevision} from '../core/world.js';
const tasks=new Set(['characters','shop']);
export function createTaskModels({context,backend}){
 const selected=task=>backend.settings.aiModels?.[task]||(task==='shop'?'phone':'tavern');
 function state(task){
  if(!tasks.has(task))throw Error('AI 填表功能無效');
  const options=[{id:'tavern',name:'沿用酒館目前模型'},...(task==='shop'?[{id:'phone',name:'沿用小手機文字模型'}]:[]),
   ...getConnectionOptions(context()).modelProfiles.map(p=>({id:'profile:'+p.id,name:`酒館連線：${p.name}${p.model?' · '+p.model:''}`})),
   ...(backend.settings.text?.presets||[]).filter(p=>p.url&&p.model).map(p=>({id:'custom:'+p.id,name:`自訂：${p.name} · ${p.model}`}))];
  const id=selected(task);if(!options.some(p=>p.id===id))options.push({id,name:'所選模型已不存在，請重新選擇',missing:true});
  return {selected:id,options};
 }
 function save(task,id){const s=state(task);if(!s.options.some(p=>p.id===id&&!p.missing))throw Error('所選模型已不存在，請重新選擇');const next=backend.getState();next.aiModels={...next.aiModels,[task]:id};backend.save(next);return state(task);}
 async function generate(c,args,id,{route='raw',responseLength=null}={}){
  const revision=getWorldRevision();
  const request={...args,...(responseLength===null?{}:{responseLength})};
  const messages=[...(request.systemPrompt?[{role:'system',content:request.systemPrompt}]:[]),...asMessages(request.prompt)];
  let result;
  if(id.startsWith('custom:')){
   const text=backend.settings.text.presets.find(p=>p.id===id.slice(7));
   if(!text?.url||!text?.model)throw Error('所選自訂模型已刪除或未設定，請重新選擇');
   result=await customRequest({text:{...text},key:backend.textKeys.get(text.id)||'',prompt:messages,responseLength:request.responseLength,signal:request.signal});
  }else if(id.startsWith('profile:')){
   result=await generateProfileText(c,{profileId:id.slice(8),messages,maxTokens:request.responseLength||4096,includePreset:route==='host'});
  }else if(id==='tavern'){
   if(route==='host'){
    if(typeof c.generateQuietPrompt!=='function')throw Error('目前酒館不支援沿用完整預設，請選擇獨立抽取');
    result=await c.generateQuietPrompt({quietPrompt:messages.map(m=>m.content).join('\n\n'),quietToLoud:false,removeReasoning:true,trimToSentence:false,...(request.responseLength?{responseLength:request.responseLength}:{})});
   }else{
    if(typeof c.generateRaw!=='function')throw Error('目前酒館不支援後臺生成');
    result=await c.generateRaw({...request,prompt:messages});
   }
  }else throw Error('模型選擇無效，請重新選擇');
  if(revision!==getWorldRevision())throw Error('世界模式已切換，本次 AI 結果未套用，請重新生成');
  return result;
 }
 return {state,save,generate,scanAdapter:{scanModel:()=>state('characters'),saveScanModel:id=>save('characters',id),generateScanModel:(c,args,preset)=>generate(c,args,preset.model,preset)}};
}
