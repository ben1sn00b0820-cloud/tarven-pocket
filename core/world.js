/** World presentation is account-wide; switching never converts stored balances. */
export const WORLD_MODES = Object.freeze({xianxia:'修仙', ancient:'古風', modern:'現代'});
const profiles = {
  xianxia:{name:'修仙', currency:'靈石', base:'下品靈石', units:{lower:1,middle:100,supreme:100000}, labels:{lower:'下品靈石',middle:'中品靈石',supreme:'極品靈石'}, counts:{lower:'枚',middle:'枚',supreme:'枚'}, hint:'1 極品 = 1000 中品；1 中品 = 100 下品。', example:'2 中品靈石', mixed:'1 極品 2 中品 3 下品'},
  ancient:{name:'古風', currency:'金銀銅錢', base:'文銅錢', units:{lower:1,middle:1000,supreme:10000}, labels:{lower:'文銅錢',middle:'兩銀子',supreme:'兩金子'}, counts:{lower:'',middle:'',supreme:''}, hint:'遊戲換算：1 兩金子 = 10 兩銀子；1 兩銀子 = 1000 文銅錢。', example:'2 兩銀子', mixed:'1 兩金子 2 兩銀子 3 文銅錢'},
  modern:{name:'現代', currency:'元', base:'元', units:{lower:1,middle:100,supreme:10000}, labels:{lower:'元',middle:'百元',supreme:'萬元'}, counts:{lower:'',middle:'',supreme:''}, hint:'以元記帳；1 百元 = 100 元，1 萬元 = 10000 元。', example:'200 元', mixed:'1203 元'},
};
for(const p of Object.values(profiles)){Object.freeze(p.units);Object.freeze(p.labels);Object.freeze(p.counts);Object.freeze(p);}
let mode='xianxia',revision=0;
const listeners=new Set(),translations=new Map(),patterns=new Map();
export const normalizeWorldMode=value=>Object.hasOwn(WORLD_MODES,value)?value:'xianxia';
export const getWorldMode=()=>mode;
export const getWorldRevision=()=>revision;
export const worldProfile=(value=mode)=>profiles[normalizeWorldMode(value)];
export function setWorldMode(value){const next=normalizeWorldMode(value);if(mode===next)return false;mode=next;revision++;translations.clear();for(const fn of listeners)fn();return true;}
export function onWorldChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
export function currencyRule(){const p=worldProfile();return `目前世界模式為${p.name}。貨幣為${p.currency}。${p.hint} 所有新交易的 amount / price 數字一律以整數${p.base}記帳。切換世界模式只改顯示與新交易規則，舊帳數字原值保留，不自動換匯或乘倍數。`;}
const terms={
 modern:{'傳音玉符':'小手機','玉符設定':'手機設定','玉符接入':'手機接入','千里傳音':'微信','浮光錄':'Instagram','論道臺':'論壇','修行札記':'日記','吾身錄':'我','留影閣':'相簿','隨行箋':'備忘錄','丹青閣':'AI 繪圖','觀心鏡':'查手機','萬寶商城':'購物商城','萬寶閣':'購物商城','萬寶':'商城','靈石袋':'錢包','福緣靈囊':'紅包','靈石轉贈':'轉帳','傳音氣泡':'聊天氣泡','傳音背景':'聊天背景','玉符掛飾':'手機掛件','傳情箋':'情書','靈茶':'奶茶','凝露飲':'咖啡','桂花糕':'蛋糕','靈獸布偶':'玩偶','凝香露':'香水','玉墜':'項鍊','玲瓏棋盤':'遊戲機','玉符':'手機','靈石':'金額'},
 ancient:{'傳音玉符':'隨身手札','玉符設定':'手札設定','玉符接入':'手札接入','千里傳音':'飛鴿傳書','浮光錄':'浮生錄','論道臺':'茶館','修行札記':'起居札記','留影閣':'畫冊','觀心鏡':'人物見聞','萬寶商城':'萬寶商行','萬寶閣':'萬寶商行','靈石袋':'錢袋','福緣靈囊':'紅封','靈石轉贈':'銀錢轉贈','傳音氣泡':'書信氣泡','傳音背景':'書信背景','玉符掛飾':'手札掛飾','靈茶':'清茶','靈獸布偶':'布偶','玉符':'手札','靈石':'銀錢'},
};
/** Translate only source-code UI/prompt text. Template interpolations are never rewritten. */
function translate(value){
 if(mode==='xianxia')return value;
 if(translations.has(value))return translations.get(value);
 const original=value,p=worldProfile();
 value=value.replace(/1 極品 = 1000 中品[；，]1 中品 = 100 下品[。；]?/g,p.hint)
  .replaceAll('1 極品 2 中品 3 下品',p.mixed)
  .replaceAll('2 枚中品靈石要輸出 price:200',mode==='ancient'?'2 兩銀子要輸出 price:2000':'200 元要輸出 price:200')
  .replaceAll('2 中品填 200',mode==='ancient'?'2 兩銀子填 2000':'200 元填 200')
  .replaceAll('2 中品靈石',p.example).replaceAll('靈石品級','貨幣單位').replaceAll('品級','單位');
 const map={...terms[mode], '枚下品靈石':p.base,'下品靈石':p.base,'中品靈石':p.labels.middle,'極品靈石':p.labels.supreme,'下品':p.base,'中品':p.labels.middle,'極品':p.labels.supreme};
 if(!patterns.has(mode))patterns.set(mode,new RegExp(Object.keys(map).sort((a,b)=>b.length-a.length).join('|'),'g'));
 const output=value.replace(patterns.get(mode),key=>map[key]);
 if(translations.size<1024)translations.set(original,output);return output;
}
export function worldText(value,...values){
 if(Array.isArray(value)&&Object.hasOwn(value,'raw'))return value.reduce((s,part,i)=>s+translate(part)+(i<values.length?String(values[i]):''),'');
 return translate(String(value));
}
