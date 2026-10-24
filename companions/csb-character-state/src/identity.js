/** Name validation is separate from field length checks: a missing name is not a long name. */
export function characterName(value, label='姓名', {strict=false}={}) {
  if(value===undefined||value===null)throw Error(`${label} 缺少 name 字串；這不是超過 100 字，請填入角色姓名或沿用已存在的角色 ID`);
  if(typeof value!=='string')throw Error(`${label} 型別錯誤：收到 ${Array.isArray(value)?'陣列':typeof value}，必須是文字，不能是物件或整份表格`);
  const name=value.trim(),length=Array.from(name).length;
  if(!name)throw Error(`${label} 不能空白`);
  if(length>100)throw Error(`${label} 實際為 ${length} 字，超過 100 字上限；疑似把正文放進 name，已略過，未截斷姓名`);
  if(strict&&(/[\r\n<>\[\]{}:：。！？!?；;，、]/u.test(name)||/^(?:角色姓名|新角色姓名|姓名|未知|未設定|無名|\{\{.*\}\})$/u.test(name)))
    throw Error(`${label} 疑似正文、標籤或模板佔位符，請只填人物的名字`);
  return name;
}
export const nameKey=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();
const goodId=id=>typeof id==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id);
function nameHash(s){let h=2166136261;for(const c of s){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
export function resolveIdentity(row,state,{strict=true}={}){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('角色條目必須是物件，不能把整段正文當成角色');
  const rawName=row.name??row.姓名??row.set?.name??row.set?.姓名;
  const byId=goodId(row.id)?state.characters[row.id]:null;
  const name=rawName===undefined&&byId?byId.name:characterName(rawName,'角色姓名',{strict});
  const matches=Object.values(state.characters).filter(c=>[c.name,...(c.aliases??[])].some(n=>nameKey(n)===nameKey(name)));
  if(byId){
    if(!matches.some(c=>c.id===byId.id)&&rawName!==undefined&&nameKey(name)!==nameKey(byId.name))
      throw Error(`姓名「${name}」與 ID「${row.id}」指向不同人物；未自動合併，請核對身份`);
    return {id:byId.id,name:byId.name,existing:true};
  }
  if(matches.length>1)throw Error(`「${name}」對應多位角色，請指定正確的既有 ID`);
  if(matches.length===1)return {id:matches[0].id,name:matches[0].name,existing:true};
  let id=goodId(row.id)?row.id:`c_scan_${nameHash(nameKey(name))}`;
  if(state.characters[id])throw Error('新角色 ID 衝突，請手動選擇身份');
  return {id,name,existing:false};
}
/** Normalize identity only, without guessing field values or silently truncating names. */
export function normalizeIncomingIdentities(payload,state){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.characters)||payload.characters.length>300)return {payload,diagnostics:[]};
  const characters=[],diagnostics=[],mapping=new Map(),seen=new Set(),working={characters:{...state.characters}};
  for(let i=0;i<payload.characters.length;i++){
    const row=payload.characters[i];
    try{
      const resolved=resolveIdentity(row,working),copy={...row,id:resolved.id};
      if(!resolved.existing)copy.name=resolved.name;else delete copy.name;
      delete copy.姓名;
      if(copy.set&&typeof copy.set==='object'&&!Array.isArray(copy.set)){copy.set={...copy.set};delete copy.set.name;delete copy.set.姓名;}
      if(seen.has(resolved.id))throw Error(`同一更新重複列出「${resolved.name}」，請合併為一列`);
      if(row.id!==resolved.id)diagnostics.push({kind:'warning',row:i+1,message:`已依姓名對齊「${resolved.name}」的 ID：${resolved.id}`});
      if(row.id!==undefined)mapping.set(row.id,resolved.id);
      characters.push(copy);seen.add(resolved.id);
      working.characters[resolved.id]??={id:resolved.id,name:resolved.name,aliases:[],values:{},present:false};
    }catch(error){diagnostics.push({kind:'error',row:i+1,message:`第 ${i+1} 個角色：${error.message}`});}
  }
  const result={...payload,characters};
  // Do not let one rejected newcomer erase everyone else's presence.
  if(Array.isArray(payload.present)){
    const fixed=[...new Set(payload.present.map(id=>mapping.get(id)??id))];
    if(fixed.every(id=>working.characters[id]))result.present=fixed;
    else{delete result.present;diagnostics.push({kind:'warning',message:'在場名單包含未能識別的角色，保留原在場狀態'});}
  }
  return {payload:result,diagnostics};
}
