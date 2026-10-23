// Talks to the Toads 31 API when config.js gives an address. Lists are kept on the phone too,
// so the app carries on with the last saved list when the signal drops.
window.ToadsApi=(()=>{
  const cfg=window.TOADS_CONFIG||{}, base=cfg.apiUrl?String(cfg.apiUrl).replace(/\/+$/,""):null, CACHE=`toads31.cache.${cfg.stage||"local"}.`;
  // lists saved before test and live were kept apart
  try{localStorage.removeItem("toads31.cache.players");localStorage.removeItem("toads31.cache.venues")}catch(e){}
  async function call(method,path,body){
    const ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),6000);
    try{
      const r=await fetch(base+path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:ctl.signal});
      let data=null;try{data=await r.json()}catch(e){}
      return {status:r.status,data};
    }finally{clearTimeout(t)}
  }
  // Finished games wait here until the API has them, so a game played with no signal is sent later
  const QUEUE=`toads31.queue.${cfg.stage||"local"}`, REJECTED=`toads31.rejected.${cfg.stage||"local"}`;
  const read=k=>{try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)?v:[]}catch(e){return[]}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  let flushing=false;
  function cached(kind){try{const v=JSON.parse(localStorage.getItem(CACHE+kind));return Array.isArray(v)?v:[]}catch(e){return[]}}
  function keep(kind,items){try{localStorage.setItem(CACHE+kind,JSON.stringify(items))}catch(e){}}
  return {
    enabled:!!base,
    cached,
    // kind is "players" or "venues" → {items, fresh}; fresh is false when the saved list was used
    async list(kind){
      try{
        const r=await call("GET","/"+kind);
        if(r.status===200&&r.data&&Array.isArray(r.data[kind])){keep(kind,r.data[kind]);return{items:r.data[kind],fresh:true}}
      }catch(e){}
      return {items:cached(kind),fresh:false};
    },
    queued:()=>read(QUEUE),
    enqueue(rec){write(QUEUE,read(QUEUE).filter(x=>x.id!==rec.id).concat([rec]))},
    unqueue(id){write(QUEUE,read(QUEUE).filter(x=>x.id!==id))},
    // Send waiting games in order, except holdId (a game that can still be undone).
    // → {sent, failed, left}; null when a send is already under way
    async flush(holdId){
      if(!base||flushing)return null;
      flushing=true;let sent=0,failed=false;
      try{
        for(const rec of read(QUEUE)){
          if(rec.id===holdId)continue;
          let r;try{r=await call("POST","/games",rec)}catch(e){failed=true;break}
          if(r.status===200||r.status===201){sent++;this.unqueue(rec.id)}
          // The API will never take it: keep a copy aside rather than retry for ever
          else if(r.status===400){console.warn("Game not accepted:",r.data);write(REJECTED,read(REJECTED).concat([{rec,error:r.data}]).slice(-20));this.unqueue(rec.id)}
          else{failed=true;break}
        }
      }finally{flushing=false}
      return {sent,failed,left:read(QUEUE).length};
    },
    // → {item, created}, {offline:true} or {error}. An existing name comes back as that item.
    async add(kind,body){
      const one=kind.slice(0,-1);let r;
      try{r=await call("POST","/"+kind,body)}catch(e){return{offline:true}}
      if((r.status===201||r.status===409)&&r.data&&r.data[one]){
        const item=r.data[one];keep(kind,cached(kind).filter(x=>x.id!==item.id).concat([item]));
        return {item,created:r.status===201};
      }
      return {error:(r.data&&r.data.error)||`Something went wrong (${r.status})`};
    }
  };
})();
