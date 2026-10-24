const backgroundType=type=>type==='quiet'||type==='impersonate';

/** Event hints are reconciled with current host state, never expired by time alone. */
export function createGenerationGuard({context,document=globalThis.document,readHostState,now=Date.now,graceMs=1500}={}){
  let narrative=false,backgroundOnly=false,backgroundPending=false,startedAt=0,sawLive=false;

  function domState(){
    const generating=document?.body?.dataset?.generating;
    if(generating==='true')return true;
    if(generating==='false')return false;
    const stop=document?.getElementById?.('mes_stop')??document?.querySelector?.('#mes_stop');
    if(!stop)return null;
    if(stop.hidden)return false;
    const view=document?.defaultView;
    const computed=typeof view?.getComputedStyle==='function'?view.getComputedStyle(stop)
      :typeof globalThis.getComputedStyle==='function'?globalThis.getComputedStyle(stop):null;
    const style=computed??stop.style;
    if(style?.display==='none'||['hidden','collapse'].includes(style?.visibility))return false;
    return computed?true:null;
  }

  function probe(){
    let stream,live=null;
    try{stream=context?.()?.streamingProcessor;}catch{}
    const active=!!stream&&stream.isFinished!==true&&stream.isStopped!==true;
    try{const value=readHostState?.();if(typeof value==='boolean')live=value;}catch{}
    if(live===null){try{live=domState();}catch{}}
    // A terminal stream is useful only when no broader host signal exists.
    if(live===null&&stream&&!active)live=false;
    return {live,narrativeStream:active&&!backgroundType(stream.type),backgroundStream:active&&backgroundType(stream.type)};
  }

  function reset(){narrative=false;backgroundOnly=false;backgroundPending=false;startedAt=0;sawLive=false;}

  function isBusy(){
    const state=probe();
    if(state.narrativeStream){narrative=true;backgroundOnly=false;backgroundPending=false;sawLive=true;return true;}
    if(state.backgroundStream&&!narrative){backgroundOnly=true;return false;}
    if(state.live===true){
      if(backgroundOnly&&!narrative)return false;
      narrative=true;sawLive=true;return true;
    }
    if(state.live===false){
      // Quiet STARTED also precedes the host lock. Do not forget its type
      // merely because a scheduler probes during that initially idle gap.
      if(backgroundOnly&&backgroundPending&&!narrative)return false;
      // STARTED precedes the host's lock in some versions. Only an observed
      // idle signal can clear this grace; elapsed time alone never clears it.
      if(narrative&&!sawLive&&now()-startedAt<graceMs)return true;
      reset();return false;
    }
    return narrative;
  }

  function start(type,options={},dryRun=false){
    if(dryRun)return;
    if(backgroundType(type)){
      // A quiet request may overlap a real response. Preserve its ownership.
      if(!narrative){backgroundOnly=true;backgroundPending=true;}
      return;
    }
    startedAt=now();sawLive=false;
    narrative=true;backgroundOnly=false;backgroundPending=false;
  }

  function finish(){
    const state=probe();
    // ENDED has no request identity. A quiet request finishing must not
    // release a concurrently active real response.
    if(state.narrativeStream||(state.live===true&&narrative)){
      narrative=true;backgroundOnly=false;backgroundPending=false;sawLive=true;return;
    }
    if(backgroundOnly&&(state.live===true||state.backgroundStream)){
      narrative=false;backgroundPending=false;sawLive=false;return;
    }
    reset();
  }

  return {start,finish,reset,isBusy};
}
