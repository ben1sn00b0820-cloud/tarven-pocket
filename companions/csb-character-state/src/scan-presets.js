import {clone,uid} from './schema.js';
import {assertSafe,safeId} from './core.js';

export const SCAN_PRESET_FORMAT='CSB_SCAN_PRESETS';
export const SCAN_PRESET_LIMIT=50;
const scanPresetBuiltins=[
  {id:'builtin-raw',name:'標準抽取 · 獨立提示',route:'raw',instructions:'',responseLength:null,builtin:true},
  {id:'builtin-host',name:'沿用酒館目前預設',route:'host',instructions:'',responseLength:null,builtin:true},
];
const isBuiltinScanPreset=id=>scanPresetBuiltins.some(p=>p.id===id);
const scanPresetObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const scanPresetSaving=new WeakSet();

/** Only extraction preferences are saved here: never connections, keys or host presets. */
export function validateScanPreset(input,{allowBuiltin=false}={}){
  if(!scanPresetObject(input))throw Error('掃描預設必須是物件');assertSafe(input);
  const id=input.id??uid('scanpreset');
  if(!safeId(id)||isBuiltinScanPreset(id)&&!allowBuiltin)throw Error('掃描預設 ID 不合法，或使用了內建預設 ID');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)throw Error('預設名稱需為 1 至 80 字');
  if(!['raw','host'].includes(input.route))throw Error('預設生成方式需為 raw 或 host');
  const instructions=input.instructions??'';
  if(typeof instructions!=='string'||instructions.length>20000)throw Error('掃描補充提示需為 20,000 字以內的文字');
  const responseLength=input.responseLength??null;
  if(responseLength!==null&&(!Number.isSafeInteger(responseLength)||responseLength<256||responseLength>32768))throw Error('回應額度需為 256 至 32,768 的整數，或留空沿用酒館設定');
  return {id,name:input.name.trim(),route:input.route,instructions,responseLength};
}

export function getScanPresets(settings={}){
  const custom=settings.scanPresets??[];
  if(!Array.isArray(custom)||custom.length>SCAN_PRESET_LIMIT)throw Error(`自訂掃描預設格式錯誤，最多 ${SCAN_PRESET_LIMIT} 份`);
  const ids=new Set(),presets=custom.map(input=>{
    const p=validateScanPreset(input);if(ids.has(p.id))throw Error('掃描預設 ID 重複');ids.add(p.id);return p;
  });
  return [...clone(scanPresetBuiltins),...presets];
}

export function resolveScanPreset(settings={},id){
  const list=getScanPresets(settings);
  if(id!==undefined&&id!==null){const preset=list.find(p=>p.id===id);if(!preset)throw Error('掃描預設已不存在，請重新選擇');return preset;}
  return list.find(p=>p.id===settings.scanPresetId)??list[0];
}

async function updateScanPresetSettings(host,mutate){
  const settings=host.settings();if(scanPresetSaving.has(settings))throw Error('正在保存掃描預設，請稍後');
  const context=host.context(),guard=host.contextGuard?.(context)??(()=>{});
  const before={scanPresets:settings.scanPresets,scanPresetId:settings.scanPresetId};
  const next={scanPresets:getScanPresets(settings).filter(p=>!p.builtin),scanPresetId:resolveScanPreset(settings).id};
  const result=mutate(next);guard();scanPresetSaving.add(settings);
  settings.scanPresets=next.scanPresets;settings.scanPresetId=next.scanPresetId;
  try{await context.saveSettingsDebounced();guard();host.onChange?.();return result;}
  catch(error){
    for(const key of Object.keys(before))if(settings[key]===next[key]){if(before[key]===undefined)delete settings[key];else settings[key]=before[key];}
    throw error;
  }finally{scanPresetSaving.delete(settings);}
}

export async function saveScanPreset(host,input){
  const preset=validateScanPreset(input);
  return updateScanPresetSettings(host,next=>{
    const index=next.scanPresets.findIndex(p=>p.id===preset.id);
    if(index<0){if(next.scanPresets.length>=SCAN_PRESET_LIMIT)throw Error(`最多 ${SCAN_PRESET_LIMIT} 份自訂掃描預設`);next.scanPresets.push(preset);}
    else next.scanPresets[index]=preset;
    return clone(preset);
  });
}
export async function deleteScanPreset(host,id){
  if(isBuiltinScanPreset(id))throw Error('內建預設不能刪除，可複製成自訂預設');
  return updateScanPresetSettings(host,next=>{
    const index=next.scanPresets.findIndex(p=>p.id===id);if(index<0)throw Error('掃描預設已不存在');
    next.scanPresets.splice(index,1);if(next.scanPresetId===id)next.scanPresetId='builtin-raw';return true;
  });
}
export async function selectScanPreset(host,id){
  return updateScanPresetSettings(host,next=>{resolveScanPreset(next,id);next.scanPresetId=id;return id;});
}
export function exportScanPresets(settings={}){
  return {format:SCAN_PRESET_FORMAT,version:1,presets:getScanPresets(settings).filter(p=>!p.builtin),selectedId:resolveScanPreset(settings).id};
}
export async function importScanPresets(host,input){
  if(!scanPresetObject(input)||input.format!==SCAN_PRESET_FORMAT||input.version!==1||!Array.isArray(input.presets)||input.presets.length>SCAN_PRESET_LIMIT)throw Error('請匯入 CSB_SCAN_PRESETS 第 1 版預設檔');
  assertSafe(input);const presets=input.presets.map(p=>validateScanPreset(p)),ids=new Set();
  for(const p of presets){if(ids.has(p.id))throw Error('匯入檔含有重複預設 ID');ids.add(p.id);}
  return updateScanPresetSettings(host,next=>{
    for(const p of presets){const i=next.scanPresets.findIndex(old=>old.id===p.id);if(i<0)next.scanPresets.push(p);else next.scanPresets[i]=p;}
    if(next.scanPresets.length>SCAN_PRESET_LIMIT)throw Error(`合併後超過 ${SCAN_PRESET_LIMIT} 份預設，請先刪除不需使用的預設`);
    if(input.selectedId!==undefined){resolveScanPreset(next,input.selectedId);next.scanPresetId=input.selectedId;}
    return {imported:presets.length,selectedId:next.scanPresetId};
  });
}

/** A quiet request can outlive the UI timeout. Do not overlap its host pipeline. */
const scanPresetHostRequests=new WeakSet();
export async function generateWithScanPreset(host,args,preset){
  const context=host.context();
  if(preset.route==='host'){
    const generate=host.adapter.generateScanHost??context.generateQuietPrompt;
    if(typeof generate!=='function')throw Error('此酒館未提供 generateQuietPrompt，無法沿用完整提示預設；請更新酒館或明確選擇「標準抽取」。');
    if(scanPresetHostRequests.has(generate))throw Error('上一個酒館預設掃描仍在模型端處理，請等待其完成後再掃描；沒有再送出請求。');
    scanPresetHostRequests.add(generate);
    try{
      return await generate.call(context,{
        quietPrompt:`${args.systemPrompt}\n\n本次抽取資料（只依此區資料與逐字引句填表）：\n${args.prompt}`,
        quietToLoud:false,skipWIAN:false,removeReasoning:true,trimToSentence:false,
        ...(preset.responseLength===null?{}:{responseLength:preset.responseLength}),
      });
    }finally{scanPresetHostRequests.delete(generate);}
  }
  const generate=host.adapter.generateScan??context.generateRaw;
  if(typeof generate!=='function')throw Error('此酒館未提供 generateRaw；請檢查模型連線或使用本機掃描');
  return generate.call(context,{...args,...(preset.responseLength===null?{}:{responseLength:preset.responseLength})});
}

export function withScanPresetPrompt(prompt,preset){
  if(!preset.instructions)return prompt;
  return {...prompt,systemPrompt:`掃描補充偏好：\n${preset.instructions}\n\n以下抽取格式、證據要求與欄位限制保持適用：\n${prompt.systemPrompt}`};
}
