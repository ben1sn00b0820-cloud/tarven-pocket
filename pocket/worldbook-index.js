/** Full local worldbook index. Only retrieval results are sent to a model/UI.
 * Raw text stays unexpanded so changing persona/chat never reuses old macros.
 * This is a deterministic local text search, not ST's activation rule engine.
 */
export const WORLDBOOK_CONTEXT = Object.freeze({defaultBudget:48000,minBudget:2000,maxBudget:2000000,chunkChars:2000,chunkOverlap:120});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pause = () => new Promise(resolve => setTimeout(resolve,0));
const guard = options => options?.assertCurrent?.();
const clean = value => typeof value === 'string' ? value : '';
const lower = value => clean(value).toLocaleLowerCase();
const identity = (book,entryId) => JSON.stringify([book,String(entryId)]);
const disabled = entry => entry.disable === true || entry.disable === 1 || entry.enabled === false;

export function worldbookBudget(value = WORLDBOOK_CONTEXT.defaultBudget) {
    if (!Number.isSafeInteger(value) || value < WORLDBOOK_CONTEXT.minBudget || value > WORLDBOOK_CONTEXT.maxBudget) throw Error(`世界書生成預算須為 ${WORLDBOOK_CONTEXT.minBudget}–${WORLDBOOK_CONTEXT.maxBudget} 字元的整數；此預算只限制單次模型內容，不限制世界書讀取。`);
    return value;
}

export async function buildWorldbookIndex(name, book, options = {}) {
    if (!object(book) || !object(book.entries)) throw Error(`無法讀取世界書「${name}」，請確認它可在酒館世界書編輯器開啟。`);
    const entries=[]; let totalEntries=0,disabledEntries=0,totalChars=0,work=0;
    for (const [entryId,entry] of Object.entries(book.entries)) {
        guard(options);totalEntries++;
        if (!object(entry) || disabled(entry)) {disabledEntries++;continue;}
        if (typeof entry.content !== 'string') throw Error(`世界書「${name}」有內容格式錯誤的條目，請先修正。`);
        if (!entry.content.trim()) continue;
        const title=clean(entry.comment),keys=[...(Array.isArray(entry.key)?entry.key:[]),...(Array.isArray(entry.keysecondary)?entry.keysecondary:[])].filter(v=>typeof v==='string');
        const chunks=[];
        for (let start=0;start<entry.content.length;) {
            let end=Math.min(start+WORLDBOOK_CONTEXT.chunkChars,entry.content.length);
            // Keep a macro at a cut intact. Bounded lookaround avoids scanning
            // the entire remaining entry for every chunk of a giant chapter.
            if(end<entry.content.length){const edge=entry.content.slice(Math.max(start,end-100),end+100),open=edge.lastIndexOf('{{',100),close=edge.indexOf('}}',100);if(open>=0&&edge.slice(open,100).indexOf('}}')<0&&close>=100)end=Math.min(entry.content.length,end+close-100+2);}
            chunks.push({start,end});
            if(end===entry.content.length)break;
            start=Math.max(start+1,end-WORLDBOOK_CONTEXT.chunkOverlap);
            if(++work%128===0){await pause();guard(options);}
        }
        entries.push({book:name,entryId:String(entryId),title,content:entry.content,keys,constant:entry.constant===true||entry.constant===1,order:Number.isFinite(Number(entry.order))?Number(entry.order):0,chunks});
        totalChars+=entry.content.length;
        if(++work%64===0){await pause();guard(options);}
    }
    guard(options);
    return {name,entries,totalEntries,disabledEntries,enabledEntries:entries.length,totalChars};
}

function queryTerms(query) {
    // The query budget bounds search work, never source indexing. Keep both
    // task beginning and ending instead of importing a giant generic prompt.
    const raw=lower(String(query??'')),q=raw.length>6000?raw.slice(0,3000)+' '+raw.slice(-3000):raw;
    const terms=new Set();
    for(const match of q.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu)) {
        const word=match[0];
        if(/\p{Script=Han}/u.test(word)) {
            if(word.length<=24)terms.add(word);
            if(word.length>1)for(let i=0;i<word.length-1;i++)terms.add(word.slice(i,i+2));
        } else if(word.length>1)terms.add(word);
    }
    return {query:q,terms:[...terms].slice(0,256)};
}
function hits(value,terms) {let score=0;for(const term of terms)if(value.includes(term))score+=term.length>2?2:1;return score;}
function titleScore(entry,search) {
    const title=lower(entry.title),keyText=entry.keys.map(lower).join('\n');
    let score=hits(title,search.terms)*10+hits(keyText,search.terms)*15;
    for(const key of entry.keys){const k=lower(key);if(k&&search.query.includes(k))score+=50;}
    return score;
}
async function rank(indexes, query, options={}) {
    const search=queryTerms(query),matches=[];let work=0;
    for(const index of indexes)for(const entry of index.entries){
        guard(options);const base=titleScore(entry,search);let bestScore=-1,best=entry.chunks[0];const scored=[];
        for(const chunk of entry.chunks){
            const chunkText=lower(entry.content.slice(chunk.start,chunk.end)),score=base+hits(chunkText,search.terms)*3;
            const positions=search.terms.map(term=>chunkText.indexOf(term)).filter(at=>at>=0),hitAt=positions.length?Math.min(...positions):0;
            const scoredChunk={...chunk,score,hitAt};
            if(score>bestScore){bestScore=score;best=scoredChunk;}
            scored.push(scoredChunk);
            if(++work%128===0){await pause();guard(options);}
        }
        matches.push({entry,score:Math.max(0,bestScore),best,chunks:scored});
    }
    guard(options);return {matches,hasQuery:search.terms.length>0};
}
const compare = (a,b) => b.score-a.score || Number(b.entry.constant)-Number(a.entry.constant) || b.entry.order-a.entry.order || a.entry.book.localeCompare(b.entry.book) || a.entry.entryId.localeCompare(b.entry.entryId,undefined,{numeric:true});
const pageNumber = (value,fallback,max) => Number.isSafeInteger(value)&&value>=0 ? Math.min(value,max) : fallback;
const stats = indexes => ({books:indexes.map(({name,totalEntries,enabledEntries,disabledEntries,totalChars})=>({name,totalEntries,enabledEntries,disabledEntries,totalChars})),enabledEntries:indexes.reduce((n,b)=>n+b.enabledEntries,0),totalChars:indexes.reduce((n,b)=>n+b.totalChars,0)});

/** Paged, plain-text snippets; never serializes a complete index to the UI. */
export async function searchWorldbookIndex(indexes,{query='',offset=0,limit=30,...options}={}) {
    const ranked=await rank(indexes,query,options),matches=ranked.matches.filter(row=>!ranked.hasQuery||row.score>0).sort(compare);
    offset=pageNumber(offset,0,Number.MAX_SAFE_INTEGER);limit=Math.max(1,pageNumber(limit,30,100));
    const entries=matches.slice(offset,offset+limit).map(({entry,best})=>({book:entry.book,entryId:entry.entryId,title:entry.title.slice(0,300),preview:entry.content.slice(Math.max(best.start,best.start+(best.hitAt||0)-80),Math.min(best.end,Math.max(best.start,best.start+(best.hitAt||0)-80)+280)),chars:entry.content.length,constant:entry.constant}));
    guard(options);
    return {...stats(indexes),entries,total:matches.length,offset,limit,nextOffset:offset+entries.length<matches.length?offset+entries.length:null,query:String(query).slice(0,6000)};
}

export function readWorldbookIndexEntry(indexes,{book,entryId,offset=0,limit=12000,...options}={}) {
    guard(options);const entry=indexes.find(index=>index.name===book)?.entries.find(entry=>entry.entryId===String(entryId));
    if(!entry)throw Error('此世界書條目不存在、已停用或未接入目前手機。請重新整理世界書清單。');
    offset=pageNumber(offset,0,Number.MAX_SAFE_INTEGER);limit=Math.max(1,pageNumber(limit,12000,50000));
    const content=entry.content.slice(offset,offset+limit);
    return {book:entry.book,entryId:entry.entryId,title:entry.title.slice(0,300),content,offset,totalChars:entry.content.length,nextOffset:offset+content.length<entry.content.length?offset+content.length:null};
}

/** Rank all enabled entries/chunks, then fit actual serialized text to budget.
 * Pins take precedence but do not authorize exceeding a model context window.
 */
export async function selectWorldbookContext(indexes,{query='',budgetChars=WORLDBOOK_CONTEXT.defaultBudget,pinned=[],substitute=value=>value,...options}={}) {
    const budget=worldbookBudget(budgetChars);if(!indexes.length)return '';
    if(!Array.isArray(pinned)||pinned.some(pin=>!object(pin)||typeof pin.book!=='string'||!['string','number'].includes(typeof pin.entryId)))throw Error('世界書固定條目設定格式錯誤。');
    const ranked=await rank(indexes,query,options),pins=new Set(pinned.map(pin=>identity(pin.book,pin.entryId))),known=new Set(ranked.matches.map(row=>identity(row.entry.book,row.entry.entryId))),missing=[...pins].filter(id=>!known.has(id)).length;
    for(const row of ranked.matches)row.pinned=pins.has(identity(row.entry.book,row.entry.entryId));
    ranked.matches.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||compare(a,b));
    const rawChars=indexes.reduce((total,index)=>total+index.totalChars,0);
    const allFits=rawChars<budget-700 && ranked.matches.reduce((total,row)=>total+JSON.stringify({worldbook:row.entry.book.slice(0,240),entryId:row.entry.entryId.slice(0,100),title:row.entry.title.slice(0,240),range:[0,row.entry.content.length],totalChars:row.entry.content.length,pinned:row.pinned,content:row.entry.content}).length+1,0)<=budget-700;
    const selective=ranked.hasQuery&&!allFits&&ranked.matches.some(row=>row.score>0);
    const records=[],included=new Set(),covered=new Map();let used=0,selectedChars=0,partial=0;
    // Header and final coverage summary are reserved so the whole returned
    // payload, including JSON escaping, stays inside the configured budget.
    const reserve=700,remaining=()=>Math.max(0,budget-reserve-used);
    const append=(row,chunk,allowPartial=false)=>{
        const entry=row.entry,key=identity(entry.book,entry.entryId),ranges=covered.get(key)||[];
        if(ranges.some(range=>chunk.start>=range.start&&chunk.end<=range.end))return false;
        let start=chunk.start,end=chunk.end,content,encoded;
        for(let attempt=0;attempt<12;attempt++){
            content=substitute(entry.content.slice(start,end));
            if(typeof content!=='string')throw Error('世界書巨集替換失敗，請檢查所選條目。');
            encoded=JSON.stringify({worldbook:entry.book.slice(0,240),entryId:entry.entryId.slice(0,100),title:entry.title.slice(0,240),range:[start,end],totalChars:entry.content.length,pinned:row.pinned,content});
            if(encoded.length+1<=remaining())break;
            if(!allowPartial)return false;
            const overhead=encoded.length-content.length,target=Math.min(end-start-1,Math.floor((end-start)*Math.max(0,remaining()-overhead-2)/Math.max(1,encoded.length-overhead)));
            if(target<60)return false;
            start=Math.max(chunk.start,Math.min(chunk.end-target,chunk.start+(chunk.hitAt||0)-Math.min(160,Math.floor(target/4))));end=start+target;
        }
        if(encoded.length+1>remaining())return false;
        records.push(encoded);used+=encoded.length+1;selectedChars+=content.length;included.add(key);ranges.push({start,end});covered.set(key,ranges);if(start>0||end<entry.content.length)partial++;
        return true;
    };
    // First pass gives each relevant/pinned entry one useful excerpt instead
    // of letting one giant chapter consume all context before later matches.
    let selectionWork=0;
    for(const row of ranked.matches){
        guard(options);if(++selectionWork%128===0){await pause();guard(options);}if(remaining()<180)break;
        if(selective&&!row.pinned&&!row.entry.constant&&row.score===0)continue;
        const full={start:0,end:row.entry.content.length};
        if(row.entry.content.length<=remaining()&&append(row,full))continue;
        const best=row.chunks.slice().sort((a,b)=>b.score-a.score||a.start-b.start)[0];
        if(best)append(row,best,true);
    }
    // Use remaining space for additional matching parts of long entries.
    for(const row of ranked.matches){
        guard(options);if(++selectionWork%128===0){await pause();guard(options);}if(remaining()<180)break;
        if(selective&&!row.pinned&&!row.entry.constant&&row.score===0)continue;
        for(const chunk of row.chunks.slice().sort((a,b)=>b.score-a.score||a.start-b.start)){
            if(remaining()<180)break;
            if(selective&&!row.pinned&&!row.entry.constant&&chunk.score===0)continue;
            append(row,chunk,true);
        }
    }
    const counts=stats(indexes),omitted=counts.enabledEntries-included.size,omittedPins=[...pins].filter(id=>known.has(id)&&!included.has(id)).length;
    const header='[手機所選世界書：已完整讀取並索引所有啟用條目；以下依本次任務檢索，不模擬酒館關鍵字觸發、機率或遞迴規則。未列出的內容仍可在手機搜尋與分頁閱讀；模型只看見本次節選。]';
    const summary=`[世界書覆蓋：${indexes.length} 本；已索引 ${counts.enabledEntries} 條／${counts.totalChars} 字元；本次 ${included.size} 條／${selectedChars} 字元；未帶入 ${omitted} 條；局部片段 ${partial}；單次預算 ${budget} 字元。${missing?`另有 ${missing} 個固定條目已移除、停用或不在所選書內，未載入。`:''}${omittedPins?`另有 ${omittedPins} 個固定條目因本次預算未帶入。`:''}${pins.size&&partial?'固定長條目也可能只帶入相關片段；全文可在手機閱讀。':''}]`;
    guard(options);return header+'\n'+records.join('\n')+'\n'+summary;
}
