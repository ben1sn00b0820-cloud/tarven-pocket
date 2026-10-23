/** Real extension/IndexedDB fixture. Only SillyTavern host APIs and model output are mocked. */
const markdown = new window.showdown.Converter({literalMidWordUnderscores:true,parseImgDimensions:true,simplifiedAutoLink:true,strikethrough:true,tables:true,simpleLineBreaks:true});
const listeners = new Map();
const eventTypes = Object.fromEntries(['APP_READY','CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_DELETED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','GENERATION_AFTER_COMMANDS','GENERATION_STARTED','GENERATION_ENDED','CHAT_COMPLETION_SETTINGS_READY'].map(x => [x,x]));
const eventSource = {
  on(name, fn) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); },
  removeListener(name, fn) { listeners.get(name)?.delete(fn); },
  async emit(name,...args) { for(const fn of listeners.get(name)||[]) await fn(...args); }
};
const user='你', name='林知夏';
let storedFixture={};try{storedFixture=JSON.parse(localStorage.getItem('tp-qa-host-fixture')||'{}');}catch{}
const chat=storedFixture.chat||[{name,is_user:false,is_system:false,mes:'窗邊的光落在桌沿。林知夏推過一杯拿鐵，笑著拿出手機。\n「下午一起去挑禮物吧。」',extra:{}}];
const books=storedFixture.books||{
  '咖啡館世界':{entries:{0:{uid:0,comment:'咖啡館',disable:false,constant:true,content:'COFFEE_LORE：{{char}}和{{user}}在老地方咖啡館。販售拿鐵、手作杯墊。'},1:{uid:1,disable:true,content:'DISABLED_BOOK_SENTINEL'}}},
  '賽車世界':{entries:{0:{uid:0,comment:'維修區',disable:false,constant:true,content:'RACING_LORE：角色曾在賽道維修區工作。'}}}
};
const extensionSettings=storedFixture.settings||{disabledExtensions:[],connectionManager:{selectedProfile:'main',profiles:[{id:'main',name:'主劇情模型（測試）',api:'openai',model:'mock-main'},{id:'phone',name:'手機專用模型（測試）',api:'openai',model:'mock-phone'}]},stTtsDialogue:{theme:'light',general:{voiceEnabled:false,floatingEnabled:true},chat:{contacts:[{id:'contact-xia',name,persona:'喜歡咖啡、閱讀和散步。'},{id:'contact-lu',name:'陸澤',persona:'朋友，喜歡賽車。'}]}}};
const prompts={}, requests=[], notices=[], commands={};
const hooks=[];
const hostCalls={saveChat:0,addOneMessage:0,saveSettings:0,saveMetadata:0,saveWorldInfo:[]};
function persistFixture(){localStorage.setItem('tp-qa-host-fixture',JSON.stringify({chat,books,settings:extensionSettings,chatId:context.chatId,chatMetadata:context.chatMetadata}));}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function updateMessageBlock(id,m){let el=document.querySelector(`.mes[mesid="${id}"]`);if(!el){el=document.createElement('article');el.className='mes';el.setAttribute('mesid',id);el.innerHTML='<div class="name"></div><div class="mes_text"></div>';document.querySelector('#chat').append(el);}el.querySelector('.name').textContent=m.name;let text=m.extra?.display_text||m.mes;for(const h of hooks)text=h(text,{isUser:m.is_user,isSystem:m.is_system,isReasoning:false,messageId:id});el.querySelector('.mes_text').innerHTML=formatMessage(text);}
// Exercise a real Markdown paragraph pass. This catches invalid block-card nesting
// that raw innerHTML assignment missed. Showdown 2.1.0 matches ST's dependency;
// this remains a fixture, not the complete ST formatting pipeline.
function formatMessage(text){return /<(?:span|section|div|article)\b[^>]*class=["'][^"']*(?:tp-|pocket-)/.test(String(text))?markdown.makeHtml(String(text)):escape(text);}
function redraw(){document.querySelector('#chat').replaceChildren();chat.forEach((m,i)=>updateMessageBlock(i,m));}
function mockCompletion(prompt,profileId='tavern'){
  const text=typeof prompt==='string'?prompt:JSON.stringify(prompt);requests.push({profileId,prompt:text});
  if(window.qa.responseQueue?.length)return window.qa.responseQueue.shift();
  if(window.qa.nextResponse!=null){const result=window.qa.nextResponse;window.qa.nextResponse=null;return result;}
  if(text.includes('你正在管理「萬寶商城」')||text.includes('商城生成')||text.includes('合理商品')||text.includes('"items"'))return JSON.stringify({items:[{title:'窗邊拿鐵',text:'老地方咖啡館的熱拿鐵，是知夏常點的午後飲品。',amount:35},{title:'手作杯墊',text:'小店手工製作的棉麻杯墊，和窗邊桌上的那款相同。',amount:28.5},{title:'午後書籤',text:'壓花書籤，適合送給喜歡閱讀的知夏。',amount:18}]});
  const phone=event=>'<phone>'+JSON.stringify({id:crypto.randomUUID(),from:name,...event})+'</phone>';
  if(text.includes('發佈一則符合現在劇情的 Instagram'))return phone({app:'instagram',action:'post',text:'午後的光，剛好落進拿鐵裡。'});
  if(text.includes('在 Instagram 私訊回覆'))return phone({app:'instagram',action:'dm',to:user,text:'好，我在門口等你。'});
  if(text.includes('寫一篇當前劇情的角色日記'))return phone({app:'diary',action:'entry',title:'午後的約定',text:'他在窗邊坐下的時候，我忽然覺得，今天可以過得慢一些。'});
  return name+'：收到，我在窗邊等你。\n'+name+'：[位置] 老地方咖啡館';
}
const context={name1:user,name2:name,characterId:0,groupId:null,chatId:storedFixture.chatId||'qa-cafe',chat,chatMetadata:storedFixture.chatMetadata||{},extensionSettings,eventTypes,event_types:eventTypes,eventSource,extensionPrompts:prompts,maxContext:8192,onlineStatus:'connected',
 characters:[{name,avatar:'xia.png',description:'溫柔直率、喜歡閱讀的朋友。\n身高：168 cm\n體重：52 kg\n身材：修長\n髮色：黑色',personality:'細心而坦率',data:{extensions:{world:'咖啡館世界'}}},{name:'陸澤',avatar:'lu.png',description:'喜歡賽車的朋友。'}],groups:[],powerUserSettings:{persona_description:'一位在咖啡館與朋友見面的學生。'},
 getCurrentChatId:()=>context.chatId,getRequestHeaders:()=>({'Content-Type':'application/json'}),getThumbnailUrl:()=>'/tests/avatar.svg',
 getWorldInfoNames:()=>Object.keys(books),loadWorldInfo:async name=>structuredClone(books[name]),saveWorldInfo:async(name,book)=>{books[name]=structuredClone(book);hostCalls.saveWorldInfo.push(name);persistFixture();},getWorldInfoPrompt:async()=>({worldInfoBefore:'ACTIVE_LORE：咖啡館的午後。',worldInfoAfter:''}),
 substituteParams:text=>String(text).replaceAll('{{user}}',user).replaceAll('{{char}}',name),
 setExtensionPrompt:(key,text)=>{prompts[key]=text;},saveSettingsDebounced:()=>{hostCalls.saveSettings++;persistFixture();},saveMetadata:async()=>{hostCalls.saveMetadata++;persistFixture();},saveChat:async()=>{hostCalls.saveChat++;persistFixture();},
 messageFormatter:{stage:{BEFORE_REGEX:'before'},addHook:fn=>hooks.push(fn)},messageFormatting:formatMessage,updateMessageBlock,addOneMessage:m=>{hostCalls.addOneMessage++;updateMessageBlock(chat.indexOf(m),m);},reloadCurrentChat:async()=>redraw(),
 generateRaw:async({prompt})=>mockCompletion(prompt),generateQuietPrompt:async({quietPrompt})=>mockCompletion(quietPrompt),
 CONNECT_API_MAP:{openai:{selected:'openai',source:'openai'}},ConnectionManagerRequestService:{sendRequest:async(id,messages)=>({content:mockCompletion(messages,id)})},
 SlashCommandParser:{addCommandObject:command=>{commands[command.name]=command.callback;}},SlashCommand:{fromProps:props=>props},
};
window.qa={context,requests,prompts,notices,commands,nextResponse:null,books,hostCalls,async send(text){const m={name:user,is_user:true,is_system:false,mes:text,extra:{}};chat.push(m);const id=chat.length-1;updateMessageBlock(id,m);await eventSource.emit(eventTypes.MESSAGE_SENT,id);await eventSource.emit(eventTypes.USER_MESSAGE_RENDERED,id);return id;},async incomingRaw(text){const m={name,is_user:false,is_system:false,mes:text,extra:{}};chat.push(m);const id=chat.length-1;window.qa.lastIncoming=id;updateMessageBlock(id,m);await eventSource.emit(eventTypes.MESSAGE_RECEIVED,id);await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED,id);return id;},async incoming(events){const m={name,is_user:false,is_system:false,mes:'她低頭在手機上輸入訊息。\n<phone>'+JSON.stringify(events)+'</phone>',extra:{}};chat.push(m);const id=chat.length-1;window.qa.lastIncoming=id;updateMessageBlock(id,m);await eventSource.emit(eventTypes.MESSAGE_RECEIVED,id);await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED,id);return id;},async emit(event,...args){await eventSource.emit(event,...args);}};
window.toastr={info:text=>notices.push(String(text)),error:text=>notices.push(String(text)),warning:text=>notices.push(String(text)),success:text=>notices.push(String(text))};
window.SillyTavern={getContext:()=>context};
redraw();
await import('/scripts/extensions/third-party/tavern-pocket/index.js');
await eventSource.emit(eventTypes.APP_READY);
