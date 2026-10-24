#!/usr/bin/env node
'use strict';
// Offline repair of existing CSB 1.2.0/1.2.1 installations only.
// No network, duplicate extension, chat-data changes, or server restart.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),zlib=require('node:zlib');
const {createRequire}=require('node:module');
const PAYLOAD='__PAYLOAD__';
const EXPECTED_DIGEST='__DIGEST__';
const FILES=['index.js','manifest.json','src/generation.js','src/scan.js','src/ui.js'];
const fail=message=>{throw Error(message);};
const exists=p=>fs.existsSync(p);
function safeUnder(root,relative){
  let current=root;
  for(const part of relative.split('/')){
    if(!part||part==='.'||part==='..'||part.includes('\\'))fail('不安全的修補路徑。');
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())fail('修補路徑包含符號連結，已中止：'+current);}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return current;
}
function inspectRoot(candidate){
  try{
    const root=fs.realpathSync(candidate),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    if(String(pkg.name).toLowerCase()==='sillytavern'&&fs.statSync(path.join(root,'server.js')).isFile()&&fs.statSync(path.join(root,'public/scripts/extensions')).isDirectory())return root;
  }catch{}
  return null;
}
function selectRoot(){
  if(process.argv.length>3)fail('用法：node CSB_Fix_1.2.1.cjs [酒館資料夾]');
  if(process.argv[2])return inspectRoot(process.argv[2])||fail('指定位置不是完整的 SillyTavern。');
  const cwd=inspectRoot(process.cwd());if(cwd)return cwd;
  if(process.env.SERVER_DIR){const host=inspectRoot(process.env.SERVER_DIR);if(host)return host;}
  const home=os.homedir(),roots=[...new Set(['SillyTavern','sillytavern','SillyTavern-Launcher/SillyTavern','SillyTavernLauncher/SillyTavern'].map(p=>inspectRoot(path.join(home,p))).filter(Boolean))];
  if(roots.length===1)return roots[0];
  fail(roots.length?'找到多個酒館，請在命令最後指定路徑。':'找不到酒館。請在命令最後加上你的 SillyTavern 資料夾路徑。');
}
function layoutFor(root){
  const logical=path.join(root,'public/scripts/extensions/third-party');
  let linked=false;try{linked=fs.lstatSync(logical).isSymbolicLink();}catch(e){if(e.code!=='ENOENT')throw e;}
  if(linked){
    const app=path.dirname(path.dirname(root));
    if(path.basename(app)!=='android-tavern'||root!==path.join(app,'bootstrap/server'))fail('非標準擴充目錄連結，已中止。');
    safeUnder(root,'public/scripts/extensions');
    const storage=safeUnder(app,'data/server'),parent=safeUnder(storage,'extensions');
    if(!exists(parent)||fs.realpathSync(logical)!==fs.realpathSync(parent))fail('SillyDroid 擴充目錄連結不符合預期。');
    for(const [key,expected] of [['SERVER_DIR',root],['TAVERN_SERVER_DIR',root],['APP_DATA_ROOT',storage],['TAVERN_DATA_ROOT',storage]])if(process.env[key]&&fs.realpathSync(process.env[key])!==fs.realpathSync(expected))fail('SillyDroid 環境路徑不一致：'+key);
    return {parent,storage,dataRoot:path.join(storage,'data')};
  }
  const parent=safeUnder(root,'public/scripts/extensions/third-party');
  let dataRoot=path.join(root,'data');
  const config=path.join(root,'config.yaml');
  if(exists(config)){
    const source=fs.readFileSync(config,'utf8');
    try{const value=createRequire(path.join(root,'package.json'))('yaml').parse(source)?.dataRoot;if(typeof value==='string'&&value)dataRoot=path.resolve(root,value);}
    catch{if(/^\s*dataRoot\s*:/m.test(source))fail('無法解析自訂 dataRoot，請先確認酒館依賴完整。');}
  }
  return {parent,storage:root,dataRoot};
}
function discover(layout){
  const folders=[layout.parent],targets=new Set();
  if(exists(layout.dataRoot))for(const user of fs.readdirSync(layout.dataRoot,{withFileTypes:true}))if(user.isDirectory()||user.isSymbolicLink())folders.push(path.join(layout.dataRoot,user.name,'extensions'));
  for(const folder of folders){
    if(!exists(folder))continue;
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
      const extension=path.join(folder,entry.name),file=path.join(extension,'manifest.json');
      if(!exists(file))continue;
      let manifest;try{manifest=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
      let target;
      if(manifest.generate_interceptor==='csbCharacterStateIntercept')target=extension;
      if(manifest.generate_interceptor==='stIphonieInterceptor')target=path.join(extension,'companions/csb-character-state');
      if(!target||!exists(path.join(target,'manifest.json')))continue;
      // Reject links anywhere in a selected extension or per-user route.
      const anchor=folder===layout.parent?layout.parent:layout.dataRoot;
      safeUnder(anchor,path.relative(anchor,target).split(path.sep).join('/'));
      targets.add(target);
    }
  }
  return [...targets];
}
function main(){
  const raw=zlib.gunzipSync(Buffer.from(PAYLOAD,'base64'));
  if(crypto.createHash('sha256').update(raw).digest('hex')!==EXPECTED_DIGEST)fail('修補包校驗失敗，請重新下載。');
  const bundle=JSON.parse(raw.toString('utf8'));
  if(JSON.stringify(Object.keys(bundle).sort())!==JSON.stringify(FILES))fail('修補包檔案清單不符。');
  const bytes=Object.fromEntries(FILES.map(file=>{if(typeof bundle[file]!=='string')fail('修補內容格式錯誤。');return [file,Buffer.from(bundle[file],'base64')];}));
  const manifest=JSON.parse(bytes['manifest.json'].toString('utf8'));
  if(manifest.version!=='1.2.1'||manifest.generate_interceptor!=='csbCharacterStateIntercept')fail('修補包版本不符。');
  const root=selectRoot(),layout=layoutFor(root),targets=discover(layout);
  if(!targets.length)fail('沒有找到已安裝的角色信息 CSB；本次沒有安裝新插件。');
  const plan=[];
  // Validate all installations before writing any file.
  for(const target of targets){
    const installed=JSON.parse(fs.readFileSync(safeUnder(target,'manifest.json'),'utf8'));
    if(installed.generate_interceptor!=='csbCharacterStateIntercept'||!['1.2.0','1.2.1'].includes(installed.version))fail('只支援 CSB 1.2.0／1.2.1，沒有更動：'+target+'（'+installed.version+'）');
    for(const required of ['src/controller.js','src/schema.js','src/ui.js','src/bridge.js'])if(!fs.statSync(safeUnder(target,required)).isFile())fail('CSB 檔案不完整：'+target);
    for(const relative of FILES){
      const file=safeUnder(target,relative);
      if(!fs.statSync(path.dirname(file)).isDirectory())fail('修補目錄不存在：'+file);
      if(exists(file)&&!fs.statSync(file).isFile())fail('修補目標不是一般檔案：'+file);
      plan.push({target,relative,file,original:exists(file)?fs.readFileSync(file):null,mode:exists(file)?fs.statSync(file).mode&0o777:0o644});
    }
  }
  const lock=safeUnder(layout.storage,'.csb-hotfix.lock'),backupRoot=safeUnder(layout.storage,'csb-hotfix-backups');
  let descriptor,backup,temporary;
  try{
    try{descriptor=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('發現另一個修補程序的鎖定檔，請勿同時執行。');throw e;}
    fs.writeSync(descriptor,String(process.pid));
    fs.mkdirSync(backupRoot,{recursive:true});backup=fs.mkdtempSync(path.join(backupRoot,'before-1.2.1-'));
    const records=[];
    for(let i=0;i<plan.length;i++){
      const item=plan[i],backupName=String(i)+'.bin';
      if(item.original!==null)fs.writeFileSync(path.join(backup,backupName),item.original,{flag:'wx',mode:item.mode});
      records.push({target:item.file,existed:item.original!==null,backup:item.original===null?null:backupName,mode:item.mode});
    }
    fs.writeFileSync(path.join(backup,'restore-map.json'),JSON.stringify(records,null,2));
    try{
      for(const item of plan){
        temporary=item.file+'.csb-fix-'+process.pid;
        fs.writeFileSync(temporary,bytes[item.relative],{flag:'wx',mode:item.mode});
        if(!fs.readFileSync(temporary).equals(bytes[item.relative]))fail('寫入校驗失敗：'+item.file);
        fs.renameSync(temporary,item.file);temporary=null;
      }
    }catch(error){
      const failures=[];
      for(const item of plan){try{if(item.original===null)fs.rmSync(item.file,{force:true});else{fs.writeFileSync(item.file,item.original,{mode:item.mode});fs.chmodSync(item.file,item.mode);}}catch(e){failures.push(item.file+': '+e.message);}}
      if(failures.length)throw Error('修補失敗，部分檔案需從備份還原：'+backup+'\n'+failures.join('\n'));
      throw Error('修補失敗，原檔已還原：'+error.message+'\n備份：'+backup);
    }
  }finally{
    if(temporary)try{fs.rmSync(temporary,{force:true});}catch{}
    if(descriptor!==undefined){fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
  console.log('已修復 '+targets.length+' 份角色信息 CSB，版本 1.2.1。');
  console.log('此修補只更新角色信息；傳音玉符主插件版本號保持原值。');
  for(const target of targets)console.log('修補位置：'+target);
  console.log('原檔備份：'+backup+'\n請用原本方式重啟酒館，並重新整理酒館頁面。\n聊天、角色資料與設定沒有更動。');
}
try{main();}catch(error){console.error('修補未完成：'+error.message);process.exitCode=1;}
