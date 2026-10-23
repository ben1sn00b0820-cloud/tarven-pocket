'use strict';
// Official TTS parameter snapshot: 2026-09-30 (Eleven v4 added 2026-09-28). See research/engine-parameters/README.md.

const n=(key,label,value,min,max,step=.01,help='')=>({key,label,type:'number',value,min,max,step,help});
const s=(key,label,value,options,help='')=>({key,label,type:'select',value,options:options.map(o=>Array.isArray(o)?o:[o,o]),help});
const b=(key,label,value,help='')=>({key,label,type:'boolean',value,help});
const t=(key,label,help='',type='text')=>({key,label,type,value:'',help});
const rows=(key,label,columns,max,help='')=>({key,label,type:'rows',value:[],columns,max,help});
const group=(id,title,fields)=>({id,title,fields});
const refs=(key,label,id,version,optional=false)=>rows(key,label,[t(id,'詞典 ID'),{...t(version,'版本 ID'),optional}],3,'最多三份，按新增順序應用。');
const fish={model:'s2.1-pro',models:['s2.1-pro','s2.1-pro-free','s2-pro','s1','drama-3-preview'],source:'https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech',groups:[
 group('common','常用設定',[n('prosody.speed','語速',1,.5,2,.05),n('prosody.volume','音量 · dB',0,undefined,undefined,.5,'0 保持原音量；官網未規定上下限。'),b('prosody.normalize_loudness','統一響度',true,'S2 系列有效；s1 接收但不生效。預覽模型尚待核驗。'),n('temperature','表現變化',.7,0,1,.05,'數值越高，表現越多變。'),n('top_p','取樣多樣性',.7,0,1,.05)]),
 group('audio','音訊輸出',[s('format','音訊格式','mp3',['mp3','wav','pcm','opus']),s('sample_rate','取樣率',44100,[8000,16000,24000,32000,44100,48000]),s('mp3_bitrate','MP3 位元速率 · kbps',128,[64,128,192]),s('opus_bitrate','Opus 位元速率 · bps',-1000,[[-1000,'自動'],24000,32000,48000,64000],'相容介面文件稱 Opus 位元速率自動選擇；原生欄位是否覆蓋需實測，當前請求省略。')]),
 group('generation','更多生成引數',[s('latency','延遲模式','normal',[['normal','質量優先'],['balanced','均衡'],['low','低延遲']]),n('chunk_length','分段長度',300,100,300,1),n('min_chunk_length','最小分段長度',50,0,100,1),n('max_new_tokens','每段生成上限',1024,undefined,undefined,1,'官網未規定上下限。'),n('repetition_penalty','重複懲罰',1.2,undefined,undefined,.05),n('early_stop_threshold','提前結束閾值',1,0,1,.05),b('normalize','規範數字與文字讀法',true),b('condition_on_previous_chunks','沿用前段聲音上下文',true),t('features','功能標記','每行一個，例如 quality-guard；是否生效由 Fish 後端決定。','lines')]),
 group('dictionary','發音詞典',[s('dictionary_mode','詞典方式','references',[['references','平臺詞典'],['inline','直接填寫發音']]),refs('pronunciation_dictionary','平臺詞典','id','version'),rows('inline_dictionary','發音條目',[t('key','原詞'),t('value','發音'),b('case_sensitive','區分大小寫',false)],5000,'直接詞典與平臺詞典二選一。')]),
 group('reference','參考音訊',[rows('references','參考音訊與原文',[{...t('audio','音訊檔案'),type:'file'},t('text','音訊原文')],10,'替代角色音色 ID。檔案儲存在當前瀏覽器並按酒館賬戶隔離，點選播放時傳送參考音訊。')])
]};
const miniLanguages=['auto','Chinese','Chinese,Yue','English','Arabic','Russian','Spanish','French','Portuguese','German','Turkish','Dutch','Ukrainian','Vietnamese','Indonesian','Japanese','Italian','Korean','Thai','Polish','Romanian','Greek','Czech','Finnish','Hindi','Bulgarian','Danish','Hebrew','Malay','Persian','Slovak','Swedish','Croatian','Filipino','Hungarian','Norwegian','Slovenian','Catalan','Nynorsk','Tamil','Afrikaans'];
const mini={model:'speech-2.8-hd',models:['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo','speech-02-hd','speech-02-turbo','speech-01-hd','speech-01-turbo'],source:'https://platform.minimax.io/docs/api-reference/speech-t2a-http',groups:[
 group('common','常用設定',[n('voice_setting.speed','語速',1,.5,2,.05),n('voice_setting.vol','音量',1,.01,10,.01,'官網範圍大於 0 且不超過 10。'),n('voice_setting.pitch','音高',0,-12,12,1),s('voice_setting.emotion','情緒','',[['','跟隨臺詞'],...['happy','sad','angry','fearful','disgusted','surprised','calm','fluent','whisper']],'fluent、whisper 按當前文件僅列為 2.6 系列支援。固定選擇會覆蓋臺詞情緒。')]),
 group('audio','音訊輸出',[s('audio_setting.format','音訊格式','mp3',['mp3','pcm','flac','wav','pcmu_raw','pcmu_wav','opus']),s('audio_setting.sample_rate','取樣率',32000,[8000,16000,22050,24000,32000,44100]),s('audio_setting.bitrate','MP3 位元速率 · bps',128000,[32000,64000,128000,256000]),s('audio_setting.channel','聲道',1,[[1,'單聲道'],[2,'雙聲道']]),b('audio_setting.force_cbr','恆定位元速率',false,'僅流式 MP3 輸出有效。')]),
 group('effects','聲音效果',[n('voice_modify.pitch','低沉 / 明亮',0,-100,100,1),n('voice_modify.intensity','強勁 / 柔和',0,-100,100,1),n('voice_modify.timbre','渾厚 / 清脆',0,-100,100,1),s('voice_modify.sound_effects','環境效果','',[['','無'],['spacious_echo','空曠回聲'],['auditorium_echo','禮堂回聲'],['lofi_telephone','電話音效'],['robotic','機器人']])]),
 group('language','語言與發音',[s('language_boost','語言增強','auto',miniLanguages),b('voice_setting.text_normalization','規範數字與文字讀法',false),b('voice_setting.latex_read','朗讀 LaTeX 公式',false,'開啟後語言增強固定為中文。'),t('pronunciation_dict.tone','自定義讀音','每行一條 原文/讀法，例如 處理/(chu3)(li3)。','lines')]),
 group('stream','流式與字幕',[b('stream','流式輸出',false),b('stream_options.exclude_aggregated_audio','末塊省略完整音訊',false),s('output_format','返回方式','hex',[['hex','音訊資料'],['url','下載連結']],'流式僅支援音訊資料；連結有效期 24 小時。'),b('subtitle_enable','生成字幕',false),s('subtitle_type','字幕粒度','sentence',[['sentence','按句'],['word','按詞'],['word_streaming','按詞 · 流式']])]),
 group('mix','混合音色',[rows('timbre_weights','音色權重',[t('voice_id','音色 ID'),n('weight','權重',50,1,100,1)],4,'官網標為舊版欄位；設定混合音色時，voice_id 留空。最多四個音色。')])
]};
const formats=['mp3_44100_128','alaw_8000','mp3_22050_32','mp3_24000_48','mp3_44100_192','mp3_44100_32','mp3_44100_64','mp3_44100_96','opus_48000_128','opus_48000_192','opus_48000_32','opus_48000_64','opus_48000_96','pcm_16000','pcm_22050','pcm_24000','pcm_32000','pcm_44100','pcm_48000','pcm_8000','ulaw_8000','wav_16000','wav_22050','wav_24000','wav_32000','wav_44100','wav_48000','wav_8000'];
const eleven={model:'eleven_v4',models:['eleven_v4','eleven_v3','eleven_multilingual_v2','eleven_flash_v2_5','eleven_flash_v2','eleven_turbo_v2_5','eleven_turbo_v2','eleven_v3_conversational'],source:'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',groups:[
 group('common','常用設定',[n('voice_settings.stability','穩定性',.5,0,1,.05,'數值越低越有表現力，越高越平穩。eleven_v3 只接受 0（有創意）、0.5（自然）、1（穩定）三檔，其他數值傳送時取最近的一檔。'),n('voice_settings.speed','語速',1,.7,1.2,.05,'官網產品頁建議 0.7–1.2；通用 REST 結構未給範圍，官方技能另列 0.25–4。當前按產品頁範圍提供。v3 產品頁標為不支援。'),n('voice_settings.similarity_boost','音色相似度',.75,0,1,.05),n('voice_settings.style','風格強度',0,0,1,.05),b('voice_settings.use_speaker_boost','增強原聲特徵',true)]),
 group('audio','音訊輸出',[s('output_format','音訊格式','mp3_44100_128',formats,'MP3 192 kbps 需要 Creator 或更高；PCM/WAV 44.1 kHz 需要 Pro 或更高，仍以賬戶可用能力為準。')]),
 group('language','語言與文字',[t('language_code','語言程式碼','留空跟隨角色語言。使用 ISO 639-1 程式碼，如 zh、en、ja；Multilingual v2 不支援。'),s('apply_text_normalization','文字規範化','auto',[['auto','自動'],['on','開啟'],['off','關閉']]),b('apply_language_text_normalization','日語讀法規範化',false,'當前僅日語；會增加生成延遲。')]),
 group('continuity','前後文與隨機性',[n('seed','隨機種子','',0,4294967295,1,'留空自動；相同種子也不保證完全相同結果。'),t('previous_text','前文','連續合成的上一段文字。','textarea'),t('next_text','後文','連續合成的下一段文字。','textarea'),t('previous_request_ids','前段請求 ID','每行一個，最多三個；設定後優先於前文。','lines'),t('next_request_ids','後段請求 ID','每行一個，最多三個；設定後優先於後文。','lines')]),
 group('dictionary','發音詞典',[refs('pronunciation_dictionary_locators','平臺詞典','pronunciation_dictionary_id','version_id',true)]),
 group('request','請求選項',[b('enable_logging','保留生成記錄',true,'關閉為零保留模式，僅 Enterprise 賬戶可用；不能用於前後請求拼接。'),s('optimize_streaming_latency','延遲最佳化（舊版）','',[['','預設'],[0,'0 · 關閉'],[1,'1 · 普通'],[2,'2 · 較強'],[3,'3 · 最大'],[4,'4 · 最大並關閉文字規範化']],'官網已棄用，保留為可選舊版引數。'),b('use_pvc_as_ivc','使用即時克隆版本（舊版）',false,'官網已棄用的臨時選項。')])
]};
// Xiaomi MiMo-V2.5 TTS (2026-10-02): OpenAI-style /chat/completions. The line is the assistant message; the user message carries
// the 风格说明 (and, for voice design, the role's voice description). Answers base64 WAV, 24 kHz mono.
const MIMO_VOICES=[['冰糖','冰糖 · 中文女聲'],['茉莉','茉莉 · 中文女聲'],['苏打','蘇打 · 中文男聲'],['白桦','白樺 · 中文男聲'],['Mia','Mia · 英文女聲'],['Chloe','Chloe · 英文女聲'],['Milo','Milo · 英文男聲'],['Dean','Dean · 英文男聲'],['mimo_default','預設音色']];
const mimo={model:'mimo-v2.5-tts',models:['mimo-v2.5-tts','mimo-v2.5-tts-voicedesign','mimo-v2.5-tts-voiceclone'],source:'https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5',groups:[
 group('common','常用設定',[t('style','風格說明','每句都帶上的整體表演要求，如「溫柔，語速稍慢，像在耳邊說話」，留空不發。音色設計模型會把它接在角色的音色描述後面。','textarea')]),
 group('clone','克隆樣本',[rows('samples','克隆樣本',[{...t('audio','音訊檔案'),type:'file'},t('name','名字')],20,'聲音克隆模型用：上傳 mp3 或 wav（編碼後不超過 10 MB），起個名字，角色的音色填這個名字。檔案儲存在當前瀏覽器。')])
]};
const mimoMode=model=>model.endsWith('voicedesign')?'design':model.endsWith('voiceclone')?'clone':'preset';
const catalogs={fish,mini,eleven,mimo};
function defaults(key){return Object.fromEntries(catalogs[key].groups.flatMap(g=>g.fields.map(f=>[f.key,structuredClone(f.value)])));}
function allowed(key,field,c){let list=field.options||[];const p=c.params;
 if(key==='fish'&&field.key==='sample_rate'){const rates=p.format==='mp3'?[32000,44100]:p.format==='opus'?[48000]:[8000,16000,24000,32000,44100];list=list.filter(([v])=>rates.includes(v));}
 if(key==='mini'&&field.key==='voice_setting.emotion'&&!c.model.startsWith('speech-2.6'))list=list.filter(([v])=>!['fluent','whisper'].includes(v));
 if(key==='mini'&&field.key==='language_boost'&&/^speech-0/.test(c.model))list=list.filter(([v])=>!['Persian','Filipino','Tamil'].includes(v));
 if(key==='mini'&&field.key==='audio_setting.sample_rate'&&p['audio_setting.format'].startsWith('pcmu'))list=list.filter(([v])=>v===8000);
 if(key==='mini'&&field.key==='output_format'&&p.stream)list=list.filter(([v])=>v==='hex');
 if(key==='mini'&&field.key==='subtitle_type'&&!p.stream)list=list.filter(([v])=>v!=='word_streaming');
 return list;
}
function unavailable(key,f,c){const p=c.params,k=f.key;
 if(key==='fish'){
  if(k==='prosody.normalize_loudness'&&!c.model.startsWith('s2'))return '該模型未確認支援響度統一。';
  if(k==='mp3_bitrate'&&p.format!=='mp3')return '僅 MP3 使用。';
  if(k==='opus_bitrate')return '相容通道按自動位元速率輸出，原生位元速率覆蓋尚待實測。';
  if(k==='pronunciation_dictionary'&&p.dictionary_mode!=='references')return '當前使用直接發音條目。';
  if(k==='inline_dictionary'&&p.dictionary_mode!=='inline')return '當前使用平臺詞典。';
 }
 if(key==='mini'){
  if(k==='audio_setting.bitrate'&&p['audio_setting.format']!=='mp3')return '僅 MP3 使用。';
  if(k==='audio_setting.force_cbr'&&(!p.stream||p['audio_setting.format']!=='mp3'))return '僅流式 MP3 使用。';
  if(k==='stream_options.exclude_aggregated_audio'&&!p.stream)return '開啟流式輸出後可選。';
  if(k==='subtitle_type'&&!p.subtitle_enable)return '開啟字幕後可選。';
  if(k==='language_boost'&&p['voice_setting.latex_read'])return '公式朗讀會固定使用中文。';
  if(k.startsWith('voice_modify.')&&!(p.stream?p['audio_setting.format']==='mp3':['mp3','wav','flac'].includes(p['audio_setting.format'])))return '音效支援非流式 MP3/WAV/FLAC，或流式 MP3。';
 }
 if(key==='eleven'){
  if(k.startsWith('voice_settings.')&&!['voice_settings.stability','voice_settings.similarity_boost'].includes(k)&&c.model==='eleven_v4')return 'v4 只支援穩定性和音色相似度，風格、語速和 SSML 不起作用。';
  if(k.startsWith('voice_settings.')&&k!=='voice_settings.stability'&&c.model.startsWith('eleven_v3'))return '按 v3 產品頁與專用引數結構，此項不作為已支援引數傳送。';
  if(['voice_settings.style','voice_settings.use_speaker_boost'].includes(k)&&c.model.includes('flash'))return 'Flash 專用聲音結構未列此項，需賬戶能力核驗。';
  if(k==='language_code'&&c.model==='eleven_multilingual_v2')return 'Multilingual v2 不支援強制語言程式碼。';
  if(k==='apply_language_text_normalization'&&/^eleven_v[34]/.test(c.model))return 'v3、v4 不接受這一項。';
  if(['previous_request_ids','next_request_ids'].includes(k)&&!p.enable_logging)return '關閉生成記錄後無法使用請求拼接。';
 }
 return '';
}
/** Fish Audio's address, or the relay (中转) the user set: every Fish request (speech, voices, balance) goes there. */
export const FISH_API='https://api.fish.audio';
export const fishBase=c=>typeof c?.relay==='string'&&/^https?:\/\/[^\s]+$/.test(c.relay)?c.relay:FISH_API;
/** A relay speaks Fish's own paths ('fish': /compat/v1/audio/speech, /model, /wallet) or OpenAI's ('openai': /v1/audio/speech only). */
export const fishOpenAI=c=>!!(c?.relay&&c.relayApi==='openai');
/** The speech address of an OpenAI-form relay. Its address is often written up to /v1 (as OpenAI services are): not twice. */
export const openaiSpeech=base=>String(base).replace(/\/v1$/i,'')+'/v1/audio/speech';
function normalize(key,c){if(key==='fish'){c.relay=typeof c.relay==='string'?c.relay.trim().replace(/\/+$/,''):'';c.relayApi=c.relayApi==='openai'?'openai':'fish';}for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(f.type==='select'){const opts=allowed(key,f,c);if(!opts.some(([v])=>v===c.params[f.key]))c.params[f.key]=opts.find(([v])=>v===f.value)?.[0]??opts[0]?.[0];}}if(key==='mini'&&c.params['voice_setting.latex_read'])c.params.language_boost='Chinese';}
function activeParameters(key,c){const out={};for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(unavailable(key,f,c))continue;const v=c.params[f.key];if(v===''||v===undefined||Array.isArray(v)&&!v.length)continue;out[f.key]=structuredClone(v);}return out;}
function setPath(target,key,value){const parts=key.split('.');let node=target;for(const part of parts.slice(0,-1))node=node[part]??=( {} );node[parts.at(-1)]=value;}
// ElevenLabs defaults are left out of requests: a model may reject a field it does not know even when it holds the default
// (eleven_v4 rejects apply_language_text_normalization:false).
const ELEVEN_DEFAULTS={apply_text_normalization:'auto',apply_language_text_normalization:false,use_pvc_as_ivc:false,enable_logging:true};
function requestPreview(key,c,voice='角色音色 ID',text='雨還沒停。再坐一會兒吧。',model=c.model){c=structuredClone(c);c.model=model;normalize(key,c);const values=activeParameters(key,c);let body={},query={};for(let [k,v] of Object.entries(values)){if(['dictionary_mode','inline_dictionary'].includes(k))continue;if(key==='eleven'&&Object.hasOwn(ELEVEN_DEFAULTS,k)&&ELEVEN_DEFAULTS[k]===v)continue;if(key==='eleven'&&['output_format','enable_logging','optimize_streaming_latency'].includes(k)){query[k]=v;continue;}const f=catalogs[key].groups.flatMap(g=>g.fields).find(f=>f.key===k);if(f?.type==='lines')v=String(v).split('\n').map(x=>x.trim()).filter(Boolean);setPath(body,k,v);}
 if(key==='fish'){if(c.params.dictionary_mode==='inline'&&c.params.inline_dictionary.length)body.pronunciation_dictionary=[{items:c.params.inline_dictionary}];if(body.references)body.references=body.references.map(r=>({audio:'[本地參考音訊：'+r.audio+']',text:r.text}));const format=body.format;delete body.format;return {url:fishBase(c)+'/compat/v1/audio/speech',body:{model:'fish-audio/'+model,input:text,voice:body.references?'':voice,response_format:format,provider:{options:{'fish-audio':body}}}};}
 if(key==='mimo'){const mode=mimoMode(model),style=[mode==='design'?voice:'',c.params.style].map(x=>String(x||'').trim()).filter(Boolean).join('\n'),audio={format:'wav'};
  if(mode==='preset')audio.voice=voice;else if(mode==='clone')audio.voice='[克隆樣本：'+voice+']';
  return {url:'https://api.xiaomimimo.com/v1/chat/completions',body:{model,messages:[...(style?[{role:'user',content:style}]:[]),{role:'assistant',content:text}],audio}};}
 if(key==='mini'){body.model=model;body.text=text;body.voice_setting??={};body.voice_setting.voice_id=body.timbre_weights?.length?'':voice;return {url:'https://'+(c.region==='cn'?'api.minimaxi.com':c.region==='uw'?'api-uw.minimax.io':'api.minimax.io')+'/v1/t2a_v2',body};}
 if(model.startsWith('eleven_v3')&&typeof body.voice_settings?.stability==='number')body.voice_settings.stability=[0,.5,1].reduce((a,b)=>Math.abs(b-body.voice_settings.stability)<Math.abs(a-body.voice_settings.stability)?b:a);
 body.model_id=model;body.text=text;return {url:'https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(voice),query,body};
}
function validate(key,c){for(const f of catalogs[key].groups.flatMap(g=>g.fields)){if(unavailable(key,f,c))continue;const v=c.params[f.key];if(f.type==='number'&&v!==''){if(!Number.isFinite(v)||f.min!==undefined&&v<f.min||f.max!==undefined&&v>f.max||f.step===1&&!Number.isInteger(v))return f.label+'數值無效';}if(f.type==='rows'){if(v.length>f.max)return f.label+'條目過多';for(const row of v)for(const col of f.columns){const x=row[col.key];if(!col.optional&&col.type!=='boolean'&&(x===undefined||String(x).trim()===''))return f.label+'：請填寫'+col.label;if(col.type==='number'&&(!Number.isFinite(x)||x<col.min||x>col.max||!Number.isInteger(x)))return f.label+'：'+col.label+'數值無效';}}if(['previous_request_ids','next_request_ids'].includes(f.key)&&String(v).split('\n').filter(x=>x.trim()).length>3)return f.label+'最多三個';}return '';}
// Official tag vocabularies (2026-09-30). Fish S1 and MiniMax take a fixed list; Fish S2 and Eleven v3/v4 read
// free-form English in square brackets, so the lists there are the documented examples.
const FISH_S1_EMOTIONS=['happy','sad','angry','excited','calm','nervous','confident','surprised','satisfied','delighted','scared','worried','upset','frustrated','depressed','empathetic','embarrassed','disgusted','moved','proud','relaxed','grateful','curious','sarcastic','disdainful','unhappy','anxious','hysterical','indifferent','uncertain','doubtful','confused','disappointed','regretful','guilty','ashamed','jealous','envious','hopeful','optimistic','pessimistic','nostalgic','lonely','bored','contemptuous','sympathetic','compassionate','determined','resigned'];
const FISH_S1_TONES=['in a hurry tone','shouting','screaming','whispering','soft tone'];
const FISH_S1_SOUNDS=['laughing','chuckling','sobbing','crying loudly','sighing','groaning','panting','gasping','yawning','snoring','break','long-break'];
const MINI_SOUNDS=['laughs','chuckle','coughs','clear-throat','groans','breath','pant','inhale','exhale','gasps','sniffs','sighs','snorts','burps','lip-smacking','humming','hissing','emm','sneezes'];
const ELEVEN_TAGS=['laughs','laughs harder','starts laughing','whispers','sighs','exhales','sarcastic','curious','excited','crying','mischievously','shouting','nervous','sad','angry'];
const MIMO_STYLES=['开心','悲伤','愤怒','恐惧','惊讶','兴奋','委屈','平静','冷漠','怅然','欣慰','无奈','愧疚','释然','嫉妒','厌倦','忐忑','动情','温柔','高冷','活泼','严肃','慵懒','俏皮','深沉','干练','凌厉'];
const MIMO_SOUNDS=['吸气','深呼吸','叹气','长叹一口气','喘息','屏息','紧张','害怕','激动','疲惫','撒娇','心虚','震惊','不耐烦','颤抖','声音颤抖','变调','破音','鼻音','气声','沙哑','笑','轻笑','大笑','冷笑','抽泣','呜咽','哽咽','嚎啕大哭'];
const fishS1=model=>model==='s1';
const elevenTagged=model=>/^eleven_v[34]/.test(model);
function tags(key,model){return key==='mimo'?MIMO_STYLES:key==='mini'?['happy','sad','angry','fearful','disgusted','surprised','calm',...(model.startsWith('speech-2.6')?['fluent','whisper']:[])]:key==='eleven'?(elevenTagged(model)?ELEVEN_TAGS:['透過文字和標點表達情緒']):fishS1(model)?FISH_S1_EMOTIONS:['自然語言描述，如 happy、whispers sweetly、slightly sad'];}
// What the 情绪 field of a line may say, in Chinese or English, and the MiniMax emotion it means.
const MINI_EMOTION_WORDS={happy:['happy','joyful','excited','cheerful','delighted','开心','高兴','快乐','喜悦','兴奋','愉快','欣喜','得意','雀跃','幸福','激动'],sad:['sad','upset','depressed','sorrowful','crying','难过','伤心','悲伤','沮丧','失落','委屈','哭泣','哽咽','低落','心疼'],angry:['angry','furious','annoyed','mad','生气','愤怒','恼火','不满','暴怒','气愤','不耐烦','烦躁'],fearful:['fearful','scared','afraid','nervous','anxious','害怕','恐惧','紧张','担心','不安','惊恐','慌张','焦虑'],disgusted:['disgusted','contemptuous','disdainful','厌恶','嫌弃','恶心','鄙视','轻蔑','不屑'],surprised:['surprised','shocked','astonished','惊讶','吃惊','震惊','意外','诧异','惊喜'],calm:['calm','gentle','neutral','soft','relaxed','平静','冷静','温柔','淡然','冷淡','平淡','轻声','温和','沉稳','认真','严肃'],fluent:['fluent','流畅','生动'],whisper:['whisper','whispering','whispers','低语','耳语','悄悄','小声']};
/** One line for the engine card: how this model reads emotion and tags. */
function tagNote(key,model){
 if(key==='mimo')return '臺詞的情緒會自動寫成句首的圓括號標籤，如 (開心)，中文最準；原文裡還可以在任意位置插方括號的細節標籤，如 [輕笑]、[嘆氣]。'+(mimoMode(model)==='design'?'音色設計模型：角色的「音色」一欄寫音色描述。':mimoMode(model)==='clone'?'聲音克隆模型：角色的「音色」一欄寫克隆樣本的名字。':'');
 if(key==='mini')return '臺詞裡的情緒會自動對應到下面這幾個（中文也行）；對應不上時由模型自己判斷。'+(model.startsWith('speech-2.8')?'原文裡還能插下面這些圓括號語氣聲。':'');
 if(key==='eleven')return elevenTagged(model)?'原文裡用方括號英文標籤控制語氣，如 [whispers]、[sarcastic]；臺詞的情緒會自動放在開頭。'+(model==='eleven_v4'?'v4 只用穩定性和音色相似度兩項設定。':''):'這個模型不讀語氣標籤，情緒靠措辭和標點表達。';
 return fishS1(model)?'圓括號固定標籤：情緒放句首，如 (sad)；語氣和聲音可以放在句中，如 (whispering)、(laughing)。臺詞的情緒會自動寫成句首標籤。':'方括號裡寫英文自然語言描述，放在任意位置都行，如 [whispers sweetly]、[slightly sad]，一句最多三個。臺詞的情緒會自動放在開頭。';
}
/** The MiniMax emotion for a line's 情绪, or '' to let the model choose (unknown words, or not supported by the model). */
function miniEmotion(model,emotion){const word=String(emotion||'').trim().toLowerCase();if(!word)return '';const found=Object.entries(MINI_EMOTION_WORDS).find(([,words])=>words.some(w=>word===w||word.includes(w)))?.[0]||'';return tags('mini',model).includes(found)?found:'';}
/** Puts a line's 情绪 at the start of the text as the model's own tag, when the model reads tags and the text has none there. */
const ENGLISH={fearful:'scared',whisper:'whispering',fluent:''};
function emotionTag(key,model,emotion,text){let word=String(emotion||'').trim();if(!word||/^\s*[[(]/.test(text))return text;
 // MiMo reads Chinese style words best: the 情绪 goes in as written.
 if(key==='mimo')return /^\s*[（]/.test(text)||word.length>20||/[()（）[\]]/.test(word)?text:`(${word})${text}`;
 // A Chinese 情绪 becomes the nearest English word, which both engines read best.
 if(!/^[a-z]/i.test(word)){const found=Object.entries(MINI_EMOTION_WORDS).find(([,words])=>words.some(w=>word.includes(w)))?.[0];word=found?ENGLISH[found]??found:'';if(!word)return text;}
 if(key==='fish'&&fishS1(model)){const w=word.toLowerCase();return FISH_S1_EMOTIONS.includes(w)||FISH_S1_TONES.includes(w)?`(${w}) ${text}`:text;}
 if(key==='fish'||key==='eleven'&&elevenTagged(model))return /^[a-z][a-z ,'-]{1,40}$/i.test(word)?`[${word.toLowerCase()}] ${text}`:text;
 return text;}
export const TTSParameters={fishBase,fishOpenAI,openaiSpeech,catalogs,defaults,allowed,unavailable,normalize,activeParameters,requestPreview,validate,tags,tagNote,miniEmotion,emotionTag,vocab:{FISH_S1_EMOTIONS,FISH_S1_TONES,FISH_S1_SOUNDS,MINI_SOUNDS,ELEVEN_TAGS,MIMO_STYLES,MIMO_SOUNDS,MIMO_VOICES},mimoMode};
