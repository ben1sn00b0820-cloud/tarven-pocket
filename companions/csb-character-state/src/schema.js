export const VERSION = 1;
export const TYPES = {text:'短文字',longtext:'長文字',number:'數字',bar:'進度條',select:'單選',multiselect:'多選',boolean:'是／否'};
export const POLICIES = {dynamic:'隨劇情更新',static:'初始化後固定',manual:'僅手動修改'};
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = (prefix='f') => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-','') || (Date.now().toString(36)+Math.random().toString(36).slice(2))}`;
export function field(id,label,group,type='text',options={}) {
  return {id,label,group,type,unit:'',default:null,policy:'dynamic',hidden:false,hideEmpty:false,color:'#c7ab73',icon:'',min:0,max:100,maxDelta:null,display:'value',direction:'neutral',options:[],thresholds:[],description:'',...options};
}
export function defaultSchema() {
  const fields = [
    field('age','年齡','basic','text',{unit:'歲',policy:'static'}),
    field('gender','性別','basic','text',{policy:'static'}),
    field('identity','身分','basic'),field('relation','與你的關係','basic'),
    field('personality','性格與背景','basic','longtext',{policy:'static'}),
    field('affection','好感度','gauges','bar',{color:'#e989a8',description:'角色對使用者的好感；依互動更新。'}),
    field('trust','信任值','gauges','bar',{color:'#ac9bf3',description:'角色對使用者的信任；不等同好感。'}),
    field('energy','精力值','gauges','bar',{color:'#d7b775',description:'越高越有活力；依休息、活動更新。'}),
    field('fatigue','疲倦值','gauges','bar',{color:'#a0aeca',direction:'negative'}),
    field('stress','壓力值','gauges','bar',{color:'#e89b7f',direction:'negative'}),
    field('satiety','飽食度','gauges','bar',{color:'#9fcda4',description:'越高越飽足；有進食或合理時間推移才更新。'}),
    field('hydration','飲水度','gauges','bar',{color:'#8acbdc',description:'水分充足程度，越高越充足。'}),
    field('lewdness','淫蕩值','gauges','bar',{color:'#c69de0',description:'成人虛構角色的性開放設定。只依明確設定或自述，不從衣著、外貌或友善推斷，未設定保持未知。'}),
    field('height','身高','features','number',{unit:'cm',min:0,max:10000,policy:'static'}),
    field('weight','體重','features','number',{unit:'kg',min:0,max:100000}),
    field('hair','髮色／髮型','features'),field('eyes','瞳色','features','text',{policy:'static'}),field('build','體型','features'),
    ...['頭部','面部','頸肩','胸部','背部','腹部','腰部','手臂','手部','腿部','足部','皮膚'].map((label,i)=>field(`part_${i}`,label,'body')),
    ...['上衣','下裝','鞋襪','配件'].map((label,i)=>field(`outfit_${i}`,label,'outfit')),
    field('outfit','整體衣著','outfit'),
    field('mood','心情','scene'),field('location','位置','scene'),field('action','行動','scene'),
    field('condition','身體狀況','scene'),field('thought','當前所想','scene','longtext',{description:'只記已表露或敘事視角允許得知的想法。'}),
    field('items','持有物品','scene','longtext'),field('note','近期變化','scene','longtext'),
    field('memory','重要經歷與約定','memory','longtext',{description:'保存仍有效的重要事件、承諾與關係背景；新增事件時保留既有重要事實，不以無關細節覆蓋。'})
  ];
  return {version:VERSION,groups:[
    {id:'basic',label:'基本資料',icon:'◇',layout:'grid',collapsed:false},
    {id:'gauges',label:'狀態數值',icon:'◈',layout:'grid',collapsed:false},
    {id:'features',label:'身體特徵',icon:'⌁',layout:'grid',collapsed:false},
    {id:'body',label:'身體部位',icon:'✧',layout:'grid',collapsed:true},
    {id:'outfit',label:'當前服裝',icon:'♧',layout:'grid',collapsed:true},
    {id:'scene',label:'當前狀態',icon:'☽',layout:'list',collapsed:false},
    {id:'memory',label:'角色記憶',icon:'▤',layout:'list',collapsed:true}
  ],fields};
}
export function defaultSettings() {return {enabled:true,autoUpdate:true,allowNew:true,showAbsent:false,inlineCards:true,mvuSync:false,promptBudget:42000,template:defaultSchema()};}
export function emptyState() {return {characters:{},scene:{time:'',location:''}};}
export function newDatabase(template=defaultSchema()) {return {version:VERSION,schema:clone(template),seed:emptyState(),manual:[],processed:{},locks:{},pinned:[],enabled:true};}
export function valueOf(character,field) {return Object.hasOwn(character.values,field.id) ? character.values[field.id] : field.default;}
