#!/usr/bin/env node
'use strict';
// 傳音玉符 — offline Termux / SillyDroid installer, revision 2.
// Version and matching presets come from the bundled manifest.
// Usage: node 傳音玉符_Install.cjs [SillyTavern-directory]
// No downloads, account changes, package upgrades, server restarts or model calls.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {createRequire}=require('node:module');
const PAYLOAD='__PAYLOAD__';
const EXPECTED_DIGEST='__DIGEST__';
const fail=message=>{throw new Error(message);};
const exists=p=>fs.existsSync(p);
const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";

function inspectRoot(candidate){
  try{
    const root=fs.realpathSync(candidate);
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    if(String(pkg.name).toLowerCase()!=='sillytavern'||!fs.statSync(path.join(root,'server.js')).isFile()||!fs.statSync(path.join(root,'public','scripts','extensions')).isDirectory())return null;
    return {root,version:pkg.version};
  }catch{return null;}
}
function selectRoot(){
  if(process.argv.length>3)fail('用法：node '+quote(__filename)+' [酒館資料夾]');
  if(process.argv[2])return inspectRoot(path.resolve(process.argv[2]))||fail('指定的資料夾不是完整的 SillyTavern 安裝。');
  const cwd=inspectRoot(process.cwd());if(cwd)return cwd;
  // SillyDroid's terminal exports this independently of its private HOME.
  if(process.env.SERVER_DIR){const host=inspectRoot(process.env.SERVER_DIR);if(host)return host;}
  const home=os.homedir();
  const guesses=[path.join(home,'SillyTavern'),path.join(home,'sillytavern'),path.join(home,'SillyTavern-Launcher','SillyTavern'),path.join(home,'SillyTavernLauncher','SillyTavern')];
  const found=[...new Map(guesses.map(inspectRoot).filter(Boolean).map(x=>[x.root,x])).values()];
  if(found.length===1)return found[0];
  if(found.length>1)fail('找到多個酒館，請指定要安裝的路徑：\n'+found.map(x=>x.root).join('\n')+'\nnode '+quote(__filename)+" '/你的酒館路徑'");
  fail('沒有找到酒館。請改用：\nnode '+quote(__filename)+" '/你的SillyTavern資料夾'\n把這個畫面回傳給我即可協助確認路徑。");
}
function safeUnder(root,relative){
  let current=root;
  for(const part of relative.split('/')){
    if(!part||part==='.'||part==='..'||part.includes('\\'))fail('安裝路徑格式不正確。');
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())fail('為避免覆蓋其他位置，已中止：路徑含符號連結 '+current);}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return current;
}
function dataRootOf(root){
  const config=path.join(root,'config.yaml');
  if(!exists(config))return path.join(root,'data');
  const source=fs.readFileSync(config,'utf8');
  try{
    const yaml=createRequire(path.join(root,'package.json'))('yaml');
    const value=yaml.parse(source)?.dataRoot;
    return typeof value==='string'&&value ? path.resolve(root,value) : path.join(root,'data');
  }catch(e){
    if(/^\s*dataRoot\s*:/m.test(source))fail('無法解析酒館的自訂資料目錄。請先用原本方式啟動酒館，確認依賴完整後再安裝。');
    return path.join(root,'data');
  }
}
function installLayout(root){
  const relative='public/scripts/extensions/third-party';
  const logical=path.join(root,relative);
  let linked=false;
  try{linked=fs.lstatSync(logical).isSymbolicLink();}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!linked){
    const parent=safeUnder(root,relative);
    return {host:'Termux / 一般酒館',parent,storage:root,dataRoot:dataRootOf(root)};
  }
  // Only accept the host-managed mapping observed in SillyDroid. Never
  // replace/unlink third-party, or allow arbitrary links in the install path.
  const appRoot=path.dirname(path.dirname(root));
  if(path.basename(appRoot)!=='android-tavern'||root!==path.join(appRoot,'bootstrap','server')){
    fail('擴充目錄含非 SillyDroid 標準連結，已中止：'+logical);
  }
  safeUnder(root,'public/scripts/extensions');
  const storage=safeUnder(appRoot,'data/server');
  const parent=safeUnder(storage,'extensions');
  if(!exists(parent)||!fs.statSync(parent).isDirectory()||fs.realpathSync(logical)!==fs.realpathSync(parent)){
    fail('SillyDroid 擴充目錄連結與標準資料位置不一致，已中止：'+logical);
  }
  for(const [key,expected] of [['SERVER_DIR',root],['TAVERN_SERVER_DIR',root],['APP_DATA_ROOT',storage],['TAVERN_DATA_ROOT',storage]]){
    if(!process.env[key])continue;
    let actual;try{actual=fs.realpathSync(process.env[key]);}catch{fail('SillyDroid 環境路徑無法讀取：'+key);}
    if(actual!==fs.realpathSync(expected))fail('SillyDroid 環境路徑不一致：'+key+'；本次未更改檔案。');
  }
  // SillyDroid passes --dataRoot explicitly, overriding config.yaml.
  return {host:'SillyDroid',parent,storage,dataRoot:path.join(storage,'data')};
}
function exportPreset(folder,name,bytes){
  try{
    let target=path.join(folder,name);
    if(exists(target)){
      if(fs.readFileSync(target).equals(bytes))return target;
      const ext=path.extname(name);target=path.join(folder,path.basename(name,ext)+'_'+Date.now()+ext);
    }
    fs.writeFileSync(target,bytes,{flag:'wx'});return target;
  }catch{return null;}
}
function main(){
  const raw=zlib.gunzipSync(Buffer.from(PAYLOAD,'base64'));
  if(crypto.createHash('sha256').update(raw).digest('hex')!==EXPECTED_DIGEST)fail('安裝包內容校驗失敗，請重新下載。');
  const bundle=JSON.parse(raw.toString('utf8'));
  const manifest=JSON.parse(Buffer.from(bundle['manifest.json'],'base64').toString('utf8'));
  const release=manifest.version;
  if(typeof release!=='string'||!/^\d+\.\d+\.\d+$/.test(release)||manifest.minimum_client_version!=='1.19.0')fail('安裝包版本不一致。');
  const regexName=`TavernPocket_Regex_v${release}.json`,worldName=`TavernPocket_Worldbook_v${release}.json`;
  for(const name of [regexName,worldName])if(typeof bundle[`presets/${name}`]!=='string')fail('安裝包缺少同版本配套：'+name);
  const {root,version}=selectRoot();
  const match=/^(\d+)\.(\d+)\.(\d+)(?:([+-]).*)?$/.exec(String(version));
  if(!match)fail('無法判斷酒館版本：'+String(version));
  const parts=match.slice(1,4).map(Number);
  const supported=parts[0]>1||(parts[0]===1&&(parts[1]>19||(parts[1]===19&&(parts[2]>0||(parts[2]===0&&match[4]!=='-')))));
  if(!supported)fail('你的酒館版本是 '+version+'，這個插件包的支援門檻是 1.19.0。未安裝、未更改酒館版本；請把這個畫面回傳給我，確認相容方案。');
  const layout=installLayout(root);
  const {parent,storage,dataRoot}=layout;
  // Both forks retain the upstream runtime namespace. Do not load two copies.
  const folders=[parent];
  if(exists(dataRoot))for(const u of fs.readdirSync(dataRoot,{withFileTypes:true}))if(u.isDirectory()||u.isSymbolicLink())folders.push(path.join(dataRoot,u.name,'extensions'));
  for(const folder of folders)if(exists(folder))for(const dir of fs.readdirSync(folder,{withFileTypes:true})){
    if(!dir.isDirectory()&&!dir.isSymbolicLink())continue;
    if(folder===folders[0]&&dir.name==='tavern-pocket')continue;
    const location=path.join(folder,dir.name),mf=path.join(location,'manifest.json');
    if(!exists(mf))continue;
    let other;try{other=JSON.parse(fs.readFileSync(mf,'utf8'));}catch{continue;}
    if(other.generate_interceptor==='stIphonieInterceptor'||/ST-iPhonie|iPhonie.*私用版/i.test(other.display_name||''))fail('找到另一份 ST-iPhonie：'+location+'\n兩份插件不能同時載入。請先在酒館停用並移除原版擴充（先用原版匯出手機備份），再執行安裝；本次未變更任何插件。');
  }
  if(exists(dataRoot))for(const user of fs.readdirSync(dataRoot,{withFileTypes:true})){
    if(!user.isDirectory()&&!user.isSymbolicLink())continue;
    const copy=path.join(dataRoot,user.name,'extensions','tavern-pocket');
    if(exists(copy))fail('找到個人版插件：'+copy+'\n已中止全域安裝，避免重複載入。請把此畫面回傳給我。');
  }
  const target=safeUnder(parent,'tavern-pocket');
  if(exists(target)&&!fs.lstatSync(target).isDirectory())fail('目的位置不是資料夾：'+target);
  const backupRoot=safeUnder(storage,'tavern-pocket-backups');
  const lock=safeUnder(storage,'.tavern-pocket-install.lock');
  let descriptor,stage,backup,installed=false;
  try{
    try{descriptor=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('發現安裝鎖，可能已有安裝程序在執行；請回傳畫面，勿重複安裝。');throw e;}
    fs.writeSync(descriptor,String(process.pid));
    stage=fs.mkdtempSync(path.join(storage,'.tavern-pocket-stage-'));
    for(const [relative,encoded] of Object.entries(bundle)){
      const destination=safeUnder(stage,relative);const bytes=Buffer.from(encoded,'base64');
      fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{flag:'wx'});
      if(!fs.readFileSync(destination).equals(bytes))fail('寫入校驗失敗：'+relative);
    }
    fs.mkdirSync(parent,{recursive:true});
    if(exists(target)){
      fs.mkdirSync(backupRoot,{recursive:true});
      const slot=fs.mkdtempSync(path.join(backupRoot,'previous-'));
      backup=path.join(slot,'tavern-pocket');fs.renameSync(target,backup);
    }
    try{fs.renameSync(stage,target);stage=null;installed=true;}
    catch(e){if(backup&&!exists(target)){fs.renameSync(backup,target);backup=null;}throw e;}
  }finally{
    if(stage)fs.rmSync(stage,{recursive:true,force:true});
    if(descriptor!==undefined){fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
  if(!installed)fail('安裝未完成。');
  const downloads=path.join(os.homedir(),'storage','downloads');
  const exportFolder=exists(downloads)?downloads:path.dirname(__filename);
  const regex=exportPreset(exportFolder,regexName,Buffer.from(bundle[`presets/${regexName}`],'base64'));
  const world=exportPreset(exportFolder,worldName,Buffer.from(bundle[`presets/${worldName}`],'base64'));
  console.log('\n✓ '+(manifest.display_name||'傳音玉符')+' v'+release+' 檔案已安裝');
  console.log('安裝器：r2（Termux / SillyDroid）\n執行環境：'+layout.host+'\n酒館版本：'+version+'\n安裝位置：'+target);
  if(backup)console.log('原版本備份：'+backup);
  console.log('\n下一步：用原本方式重新啟動酒館，重新整理瀏覽器，單擊懸浮球，或在對話輸入 /phone。');
  if(layout.host==='SillyDroid')console.log('SillyDroid：請使用 App 原本的酒館啟動／停止控制重啟，再重新載入酒館頁面。此離線安裝包不使用 Git 更新；後續以新版安裝器更新。');
  console.log('傳音玉符內「玉符接入 → 安裝／更新配套規則」可一鍵更新配套；也可手動匯入下列新檔。');
  console.log('正則：到「擴充功能 → Regex」匯入 '+(regex||path.join(target,'presets',regexName))+'，搭配插件將完整傳音玉符事件顯示為正文卡片，原始訊息仍保留。');
  console.log('世界書為選配：'+(world||path.join(target,'presets',worldName))+'；插件已預設注入傳音玉符協定，不必重複啟用。');
  console.log('千里傳音在底部綠色圖示；角色信息／浮光錄／修行札記／萬寶閣／玉符接入在首頁。');
  console.log('舊聊天與既有設定保留。靈石袋沿用原有帳面數值，可在「千里傳音 → 我 → 靈石袋」查看與設定。');
}
try{main();}catch(e){console.error('\n安裝未完成：'+e.message);process.exitCode=1;}
