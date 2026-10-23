import {defaultSettings,newDatabase,clone} from './src/schema.js';
import {applyUpdate} from './src/core.js';
import {StateController,KEY} from './src/controller.js';
import {el,statusPanel,openManager} from './src/ui.js';

const sample=()=>{
  const db=newDatabase();db.seed.scene={time:'辰時 · 微雨初歇',location:'青山鎮 · 望雲客棧'};
  db.seed=applyUpdate(db.seed,db.schema,{version:1,present:['c_zhiwei','c_xingzhou'],characters:[
    {id:'c_zhiwei',name:'沈知微',aliases:['知微'],reason:'預覽範例',set:{age:'26',gender:'女',identity:'遊歷中的醫師',relation:'同行友人',personality:'沉著敏銳，喜歡記錄旅途見聞。',affection:72,trust:83,energy:58,fatigue:36,stress:21,satiety:64,hydration:45,lewdness:null,height:168,weight:55,hair:'烏黑長髮，以素簪束起',eyes:'深褐色',build:'修長勻稱',part_8:'左手指節有輕微擦傷，已包紮',part_2:'長途行走後略感僵硬',outfit_0:'月白色交領外衫',outfit_1:'靛青長裙',outfit_2:'深色布靴',outfit_3:'素銀髮簪',mood:'放鬆，稍有倦意',location:'客棧二樓 · 臨窗座位',action:'捧著茶盞，聽你安排下一段路程',thought:'雨停之後，山路應該好走些。',items:'藥箱、旅途筆記、銀針包',memory:'與你約定同行前往北嶺。昨日替旅人處理傷勢，左手留下擦傷。'}},
    {id:'c_xingzhou',name:'陸行舟',aliases:['行舟'],reason:'預覽範例',set:{age:'29',gender:'男',identity:'鏢師',relation:'同行夥伴',affection:61,trust:76,energy:82,fatigue:18,stress:27,satiety:49,hydration:67,height:183,build:'肩背結實',mood:'平靜，留意周圍動靜',location:'客棧一樓 · 櫃檯旁',action:'向掌櫃詢問山路情況',outfit_0:'墨色短褂',outfit_1:'灰色長褲',memory:'熟悉北嶺道路；答應在此行中協助護送藥材。'}}
  ]},{manual:true}).state;return db;
};
let saved;try{saved=JSON.parse(localStorage.getItem('csb_preview_v1')||'null');}catch{}
const previewContext={chatId:'preview',chat:saved?.chat??[],chatMetadata:{[KEY]:saved?.db??sample()},extensionSettings:{[KEY]:saved?.settings??defaultSettings()},saveMetadata:async()=>persistPreview(),saveChat:async()=>persistPreview(),saveSettingsDebounced:()=>persistPreview()};
function persistPreview(){try{localStorage.setItem('csb_preview_v1',JSON.stringify({db:previewContext.chatMetadata[KEY],settings:previewContext.extensionSettings[KEY],chat:previewContext.chat}));}catch{}}
const host=new StateController({context:()=>previewContext,getMvu:()=>null});
let activeManager;
function manage(tab='characters'){if(activeManager?.dialog.isConnected)return;activeManager=openManager(host,tab);}
function paint(){const s=host.getSnapshot(),stage=document.querySelector('#preview-stage');const current=stage.querySelector('.csb-panel'),opened=current?new Set([...current.querySelectorAll('details[open]')].map(d=>d.dataset.char)):new Set(['c_zhiwei']);
  stage.replaceChildren(statusPanel(s.state,s.db.schema,{expanded:true,showAbsent:s.settings.showAbsent,onManage:()=>manage(),onEdit:id=>{manage();activeManager.editCharacter(id);},pinned:s.db.pinned}));
  for(const d of stage.querySelectorAll('[data-char]'))if(opened.has(d.dataset.char))d.open=true;
  document.querySelector('#demo-count').textContent=`${Object.keys(s.state.characters).length} 份角色記憶 · ${s.db.schema.fields.filter(f=>!f.hidden).length} 個共用欄位`;
}
host.onChange=paint;
document.querySelector('#open-manager').onclick=()=>manage();
document.querySelector('#open-fields').onclick=()=>manage('schema');
document.querySelector('#simulate-rest').onclick=async()=>{const c=host.getSnapshot().state.characters.c_zhiwei;if(!c)return;const payload={version:1,characters:[{id:c.id,set:{energy:Math.min(100,(c.values.energy??50)+10),hydration:Math.min(100,(c.values.hydration??40)+12),fatigue:Math.max(0,(c.values.fatigue??40)-8),action:'喝過熱茶，靠著窗邊休息',note:'短暫休息並補充水分，精神有所恢復。'},reason:'預覽事件：喝茶與休息'}]};previewContext.chat.push({name:'旁白',mes:`兩人喝過熱茶，在窗邊休息了片刻。\n<CSB_UPDATE>${JSON.stringify(payload)}</CSB_UPDATE>`,is_user:false});await host.rebuild();};
document.querySelector('#simulate-leave').onclick=async()=>{const state=host.getSnapshot().state,c=state.characters.c_xingzhou;if(!c)return;const present=Object.values(state.characters).filter(x=>x.present&&x.id!==c.id).map(x=>x.id);if(!c.present)present.push(c.id);previewContext.chat.push({name:'旁白',mes:`${c.present?'陸行舟出門查看道路。':'陸行舟回到了客棧。'}\n<CSB_UPDATE>${JSON.stringify({version:1,present,characters:[]})}</CSB_UPDATE>`,is_user:false});await host.rebuild();};
document.querySelector('#reset-preview').onclick=()=>{if(!confirm('重設預覽中的範例資料與欄位？'))return;previewContext.chat=[];previewContext.chatMetadata={[KEY]:sample()};previewContext.extensionSettings={[KEY]:defaultSettings()};persistPreview();paint();};
globalThis.csbPreview={host,context:previewContext,paint};paint();
