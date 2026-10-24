import {DEFAULT_FORMAT,LEGACY_FORMATS,parseDialogue,decodeText,escapeHTML} from './protocol.js';

// Only machine-derived utterances may be collapsed. Ordinary repeated prose is
// never deduplicated, and this function always returns a new display/prompt copy.
const quote = '(?:「[^「」\\r\\n]*」|『[^『』\\r\\n]*』|“[^“”\\r\\n]*”|"[^"\\r\\n]*")';
const previousQuote = new RegExp('(?:^|\\n)[\\t ]*(' + quote + ')[\\t \\r\\n]*$');
const followingQuote = new RegExp('^[\\t \\r\\n]*(' + quote + ')(?=[\\t ]*(?:\\r?\\n|$))');
const overlaps = (a,b) => a.start < b.end && a.end > b.start;
const comparable = text => decodeText(String(text)).normalize('NFC').trim()
    .replace(/\s+/g,' ').replace(/\.{3,}|…+|⋯+/g,'…');

function protectedRanges(message){
    // Markdown/HTML examples are not instructions to render a spoken line.
    const patterns=[/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g,
        /<(pre|code|script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        /<(phone|CSB_UPDATE)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        // A tag-looking value inside an unrelated element's attribute is data.
        /<(?!\/?tts\b)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi];
    return patterns.flatMap(pattern=>[...message.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length})));
}

function readLines(message,formats,protectedText){
    const lines=[];
    for(const format of [...new Set([...formats,DEFAULT_FORMAT,...LEGACY_FORMATS])]){
        let found;try{found=parseDialogue(message,format);}catch{continue;}
        for(const line of found){
            if(!Number.isInteger(line.start)||!Number.isInteger(line.end)||line.start<0||line.end>message.length||line.end<=line.start)continue;
            if(protectedText.some(p=>overlaps(line,p))||lines.some(p=>overlaps(line,p)))continue;
            lines.push(line);
        }
    }
    return lines.sort((a,b)=>a.start-b.start);
}

function adjacentQuote(message,line,lines,protectedText){
    const before=message.slice(0,line.start),prior=previousQuote.exec(before);
    if(prior){
        const raw=prior[1],start=before.lastIndexOf(raw),candidate={start,end:start+raw.length};
        if(![...lines,...protectedText].some(p=>overlaps(candidate,p))&&comparable(raw.slice(1,-1))===comparable(line.translation)){
            return {start:candidate.end,end:line.end};
        }
    }
    const after=message.slice(line.end),next=followingQuote.exec(after);
    if(next){
        const raw=next[1],start=line.end+next[0].lastIndexOf(raw),candidate={start,end:start+raw.length};
        if(![...lines,...protectedText].some(p=>overlaps(candidate,p))&&comparable(raw.slice(1,-1))===comparable(line.translation)){
            return {start:line.start,end:candidate.start};
        }
    }
    return null;
}

/**
 * Render historical TTS markup as ordinary story text, optionally HTML-escaping
 * the extracted translation. Only an adjacent, standalone ordinary quote with
 * the same wording can replace a tag-derived utterance. Two ordinary quotes,
 * two tagged speakers, or lines separated by narration always remain distinct.
 *
 * Unreadable but fully closed <tts> containers are hidden rather than guessing
 * what their metadata means. For an unclosed pipe-format tag, only its explicit
 * metadata-bearing first line is hidden; later narrative lines are preserved.
 * Other undecodable unclosed content stays unchanged for source inspection.
 */
export function cleanNarrativeText(message,formats=[],{html=false}={}){
    const source=String(message??'');
    if(!source||source.length>500000)return source;
    const configured=Array.isArray(formats)?formats:[];
    if(!/<\/?tts\b/i.test(source)&&!configured.some(format=>typeof format==='string'&&!/<tts\b/i.test(format)))return source;
    const protectedText=protectedRanges(source),lines=readLines(source,configured,protectedText);
    const edits=lines.map(line=>{
        const duplicate=adjacentQuote(source,line,lines,protectedText);
        return duplicate?{...duplicate,text:''}:{start:line.start,end:line.end,text:'“'+(html?escapeHTML(line.translation):line.translation)+'”'};
    });
    const occupied=()=>[...protectedText,...lines,...edits];
    for(const match of source.matchAll(/<tts\b[^>]*>[\s\S]*?<\/tts\s*>/gi)){
        const range={start:match.index,end:match.index+match[0].length};
        if(!occupied().some(p=>overlaps(range,p)))edits.push({...range,text:''});
    }
    // During a partial/malformed pipe tag, do not display role|emotion metadata.
    // The line boundary is intentional: never consume subsequent story text.
    for(const match of source.matchAll(/<tts\b[^>]*>[^<\r\n]*/gi)){
        const range={start:match.index,end:match.index+match[0].length};
        if(occupied().some(p=>overlaps(range,p)))continue;
        const body=match[0].slice(match[0].indexOf('>')+1);
        if(/^[^|]{1,100}\|[^|]{0,100}(?:\||$)/.test(body))edits.push({...range,text:''});
    }
    for(const match of source.matchAll(/<\/tts\s*>/gi)){
        const range={start:match.index,end:match.index+match[0].length};
        if(!occupied().some(p=>overlaps(range,p)))edits.push({...range,text:''});
    }
    if(!edits.length)return source;
    edits.sort((a,b)=>a.start-b.start);
    let output='',at=0;
    for(const edit of edits){
        if(edit.start<at)continue;
        output+=source.slice(at,edit.start)+edit.text;at=edit.end;
    }
    return output+source.slice(at);
}
