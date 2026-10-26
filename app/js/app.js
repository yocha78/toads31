// The test copy sits on the same website as the live one, so it keeps its own saved state
const KEY=(window.TOADS_CONFIG||{}).stage==="test"?"toads31-test":"toads31", MAX_TABLES=8;
// Game rules live in rules.js (window.Toads); this file is the page: state, screens and buttons.
const {TARGET,coinsFor,newG,throwerOf,buildTour,gameNo,ready}=Toads;
const TOAD=`<svg class="toad" viewBox="0 0 16 14" aria-hidden="true"><circle cx="4.5" cy="3.5" r="2.6"/><circle cx="11.5" cy="3.5" r="2.6"/><ellipse cx="8" cy="9" rx="7" ry="4.6"/><circle cx="4.5" cy="3.2" r="1" fill="var(--surface)"/><circle cx="11.5" cy="3.2" r="1" fill="var(--surface)"/></svg>`;
/* State
   players: registered list · g: the single-mode game · tour: knockout bracket, each match holds its own game and table
   focus: which tournament match is on screen · ord: throwing-order picker · last: the win just recorded (for undo) */
let S={players:[],teams:[],tourFormat:"quali",mode:"single",tables:1,stage:"setup",g:null,wins:{},tour:null,focus:null,last:null,ord:null};
const $=id=>document.getElementById(id);

function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
function load(){try{const v=JSON.parse(localStorage.getItem(KEY));if(v&&Array.isArray(v.players))S=Object.assign(S,v)}catch(e){}}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}

// The tournament on screen: the TV screen's, a live one this phone follows (S.live, online only), or the local one (S.tour)
let TV=null; // {id, name, venue, status, ver, tour, seen, offline, error} while the page is a TV screen (#tv-<code>)
const TOUR=()=>TV&&TV.tour?TV.tour:S.live&&S.live.tour?S.live.tour:S.tour;
const isTour=()=>!!(S.live&&S.live.tour)||(S.mode==="tournament"&&!!S.tour);
// ri -1 = qualifying round, 0.. = knockout rounds
const matchAt=(ri,mi)=>ri<0?(TOUR().quali||{matches:[]}).matches[mi]||null:(TOUR().rounds[ri]||[])[mi]||null;
const M=()=>isTour()&&S.focus?matchAt(S.focus.ri,S.focus.mi):null;
const G=()=>isTour()?(M()||{}).game||null:S.g;

/* ---------- tournament (the current one, TOUR()) ---------- */
const knockSize=Toads.knockSize;
const standings=()=>Toads.standings(TOUR());
const qualiDone=()=>Toads.qualiDone(TOUR());
const settle=()=>Toads.settle(TOUR());
const all=()=>Toads.allMatches(TOUR());
const assignTables=()=>Toads.assignTables(TOUR());
const roundName=ri=>Toads.roundName(TOUR(),ri);
const tname=k=>Toads.tableName(TOUR(),k), TN=k=>esc(tname(k));
// Team wins are kept apart from player wins, in case a team shares a player's name
const winKey=(g,name)=>g&&g.members?"team:"+name:name;
function matchWins(name){
  if(!isTour())return S.wins[winKey(G(),name)]||0;
  const m=M();if(!m)return 0;
  return name===m.a?m.wa:name===m.b?m.wb:0;
}

/* ---------- rendering ---------- */
function render(){
  // A TV screen shows nothing else, and leaves this phone's own state alone
  $("tvView").hidden=!TV;$("app").hidden=!!TV;
  document.body.classList.toggle("tvmode",!!TV);
  if(TV){renderTV();return}
  for(const id of["setup","orderView","bracketView","game","win","playersView","statsView","menuView","toursView"])$(id).hidden=true;
  const views={setup:["setup",renderSetup],menu:["menuView",renderMenu],tours:["toursView",renderTours],players:["playersView",renderPlayers],stats:["statsView",renderStats],order:["orderView",renderOrder],bracket:["bracketView",renderHub],game:["game",renderGame],win:["win",renderWin]};
  $("menuBtn").hidden=!NET.on||["menu","players","stats","tours"].includes(S.stage);
  if(S.live&&["game","win","order"].includes(S.stage)&&(!M()||!scoring()&&(S.stage!=="game"||!G()||G().done))){S.focus=null;S.ord=null;S.stage="bracket"}
  const v=views[S.stage];
  if(!v){S.stage="setup";return render()}
  $(v[0]).hidden=false;v[1]();
  gameAwake();
  save();
  if(NET.on)syncGames();
}

function renderSetup(){
  const T=S.mode==="tournament", D=S.mode==="duo", n=S.players.length;
  $("modeSingle").setAttribute("aria-pressed",S.mode==="single");
  $("modeDuo").setAttribute("aria-pressed",D);
  $("modeTour").setAttribute("aria-pressed",T);
  $("modeHint").textContent=T
    ?tourHint(n)
    :D?"Teams of two share one score from 31. Team-mates take it in turns: each time it's the team's go, the other partner throws."
    :"Everyone plays in one game. One player on their own works too.";
  $("teamsBox").hidden=!D;
  if(D)renderTeams();
  $("tablesRow").hidden=!T;
  const odd=T&&n>=3&&knockSize(n)!==n;
  $("formatRow").hidden=!odd;
  $("fmtQuali").setAttribute("aria-pressed",S.tourFormat!=="byes");
  $("fmtByes").setAttribute("aria-pressed",S.tourFormat==="byes");
  renderPer(T&&odd&&S.tourFormat!=="byes");
  $("tablesVal").textContent=S.tables;
  $("tablesMinus").disabled=S.tables<=1;
  $("tablesPlus").disabled=S.tables>=MAX_TABLES;
  $("playerList").innerHTML=S.players.map((p,i)=>`<li><span class="num">${i+1}</span><span class="pname">${esc(p)}${guestTag(p)}</span>${regBtn(p,i)}<button class="x" data-i="${i}" aria-label="Remove ${esc(p)}">Remove</button></li>`).join("");
  $("noPlayers").hidden=n>0;
  $("noPlayers").textContent=T?"Add at least two players.":D?"Add players, then put them into teams of two below.":"Add one or more players.";
  $("shuffleBtn").hidden=!(T&&n>2);
  if(NET.on)renderOnline();
  if(NET.on)renderLiveSetup();
  setupStart();
}
// Tournament mode, online: tournaments to follow, and (organiser) the option to run this one live
function renderLiveSetup(){
  const T=S.mode==="tournament", org=!!ToadsApi.organiser(), list=NET.liveList||[];
  $("liveBox").hidden=!T&&!list.length&&!NET.liveMsg;
  $("liveList").innerHTML=list.map(t=>`<li><span class="pname">${esc(t.name)}${t.venue?` <span class="hint">· ${esc(t.venue)}</span>`:""}</span><button class="x" data-follow="${esc(t.id)}">Follow</button></li>`).join("");
  $("liveListHead").hidden=!list.length;
  $("liveCreate").hidden=!T||!org;
  $("liveOn").checked=!!S.liveOn;
  $("liveFields").hidden=!S.liveOn;
  $("liveHint").textContent=!T?"":!org?"To run a live tournament that everyone follows and scores from their own phones, log in as organiser in the Menu (top right)."
    :S.liveOn?"Each table is scored from a phone at the table, after entering the PIN. Share the PIN only with the scorers.":"";
  $("liveHint").hidden=!$("liveHint").textContent;
  $("liveMsg").textContent=NET.liveMsg||"";
}
// Qualifying: how many matches each player plays, each choice with the matches per table it makes
const qualiPer=n=>Toads.qualiPers(n).includes(S.qualiPer)?S.qualiPer:2;
function tourMatches(n,per){const K=knockSize(n);return {quali:K<n?n*per/2:0,total:(K<n?n*per/2:0)+K-1}}
const perTable=(total,tables)=>{const x=total/tables;return Number.isInteger(x)?`${x}`:`${Math.floor(x)}–${Math.ceil(x)}`};
function renderPer(on){
  $("perRow").hidden=!on;if(!on)return;
  const n=S.players.length, per=qualiPer(n), tables=Math.max(1,Math.min(S.tables,Math.floor(n/2)));
  $("perSel").innerHTML=Toads.qualiPers(n).map(m=>`<option value="${m}"${m===per?" selected":""}>${m} (${perTable(tourMatches(n,m).total,tables)} per table)</option>`).join("");
  const c=tourMatches(n,per);
  $("perHint").textContent=`${c.quali} qualifying matches, ${c.total} in all with the knockout, on ${tables} table${tables===1?"":"s"}.`+(n%2?" Odd numbers need an even number of players.":"");
}
function tourHint(n){
  const base="Knockout, one against one. First to win 2 games takes the match, and winners meet in the next round.";
  if(n<2)return base;
  const K=knockSize(n);
  if(K===n)return `${base} With ${n} players the draw follows the list: 1 v 2, 3 v 4…`;
  if(S.tourFormat==="byes"){
    const b=K*2-n;
    return `${base} With ${n} players, ${b} player${b===1?"":"s"} picked at random get${b===1?"s":""} a bye and skip round 1. Byes only happen in round 1, so after that everyone plays every round.`+(n===3?" With 3 players that means the bye goes straight to the final.":"");
  }
  const per=qualiPer(n);
  return `${base} With ${n} players there's a qualifying round first: everyone plays ${per} match${per===1?"":"es"} against the players nearest them in the list${per%2?" (and the one straight across)":""}, then the top ${K} go into a seeded knockout.`;
}
function setupStart(){
  const T=S.mode==="tournament", D=S.mode==="duo", n=S.players.length;
  $("startBtn").disabled=T?n<2:D?!!teamProblem():n===0;
  $("startBtn").textContent=T?(liveCreating()?"Start live tournament":"Start tournament"):D?"Start duo game":n===1?"Start solo game":"Start game";
  if(D)$("teamHint").textContent=teamProblem()||"Ready. The partner chosen as 1st throws on the team's first turn.";
}

const liveCreating=()=>NET.on&&S.mode==="tournament"&&!!S.liveOn&&!!ToadsApi.organiser();
/* ---------- online: shared players and venues, only when config.js gives an API ---------- */
// Without an API none of this shows and the app works exactly as before.
const NET={on:ToadsApi.enabled,players:ToadsApi.cached("players"),venues:ToadsApi.cached("venues"),fresh:false,saving:{},note:""};
const newId=()=>crypto.randomUUID?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
const nameKey=n=>String(n).normalize("NFC").toLocaleLowerCase("en-GB");
const findIn=(list,n)=>list.find(x=>nameKey(x.name)===nameKey(n));
const byName=(a,b)=>a.name.localeCompare(b.name,"en-GB",{sensitivity:"base"});
const guestTag=p=>NET.on&&!findIn(NET.players,p)?`<span class="tag">guest</span>`:"";
const regBtn=(p,i)=>NET.on&&!findIn(NET.players,p)?`<button class="x reg" data-reg="${i}"${NET.saving[p]?" disabled":""} aria-label="Register ${esc(p)} as a player">${NET.saving[p]?"Saving…":"Register"}</button>`:"";
async function loadDirectory(){
  const [pl,vn]=await Promise.all([ToadsApi.list("players"),ToadsApi.list("venues")]);
  NET.players=pl.items;NET.venues=vn.items;NET.fresh=pl.fresh&&vn.fresh;
  if(["setup","players","stats"].includes(S.stage))render();
}
function renderOnline(){
  $("venueBox").hidden=false;
  // A venue the organiser has since deleted drops out once the list is fresh
  if(S.venue&&NET.fresh&&!findIn(NET.venues,S.venue)){S.venue="";save()}
  if(document.activeElement!==$("venueSelect"))$("venueSelect").innerHTML=venueOptions(S.venue);
  $("nameInput").setAttribute("list","playerOptions");
  const free=NET.players.filter(p=>!S.players.some(x=>nameKey(x)===nameKey(p.name))).sort(byName);
  $("playerOptions").innerHTML=free.map(p=>`<option value="${esc(p.name)}"></option>`).join("");
  // Tap to add: registered players matching what is typed, at most 12
  const q=nameKey($("nameInput").value.trim()), shown=free.filter(p=>!q||nameKey(p.name).includes(q)).slice(0,12);
  $("regBox").hidden=false;
  $("regChips").innerHTML=shown.map(p=>`<button type="button" data-add="${esc(p.name)}">${esc(p.name)}</button>`).join("");
  $("regHint").textContent=NET.note||(!NET.players.length?(NET.fresh?"No registered players yet. Add a name, then tap Register to keep it for next time.":"Can't reach the players list. Names you add are guests for now."):
    (shown.length?"Tap a registered player to add them.":q?"No registered player matches. Add them as a guest.":"Every registered player is in.")+(NET.fresh?"":" (Offline: last saved list.)"));
}
async function registerPlayer(p){
  NET.saving[p]=true;NET.note="";render();
  const r=await ToadsApi.add("players",{name:p});
  delete NET.saving[p];
  if(r.item){
    NET.players=NET.players.filter(x=>x.id!==r.item.id).concat([r.item]);
    // Already registered with other capitals: use that spelling everywhere
    if(r.item.name!==p&&!S.players.includes(r.item.name)){
      S.players=S.players.map(x=>x===p?r.item.name:x);
      S.teams.forEach(t=>{if(t.a===p)t.a=r.item.name;if(t.b===p)t.b=r.item.name});
      if(S.wins[p]!=null){S.wins[r.item.name]=S.wins[p];delete S.wins[p]}
    }
    NET.note=r.created?`${r.item.name} is registered.`:`${r.item.name} was already registered.`;
  }else NET.note=r.offline?`No signal, so ${p} stays a guest. Try Register again later.`:`Couldn't register ${p}: ${r.error}.`;
  if(S.stage==="setup")render();
}
// Saved games: a finished Single or Duo game is queued, then sent once it can no longer be undone
const heldGame=()=>S.stage==="win"&&S.last&&!M()&&G()&&G().id||null;
async function syncGames(){
  const r=await ToadsApi.flush(heldGame());
  if(r){NET.sync=r;if(r.sent)NET.saved=Date.now()}
  syncNote();
}
function syncNote(){
  const q=ToadsApi.queued(), held=heldGame(), waiting=q.filter(x=>x.id!==held).length, r=NET.sync||{};
  const plural=n=>`${n} game${n===1?"":"s"}`;
  $("syncNote").textContent=waiting&&r.failed?`Offline: ${plural(waiting)} waiting to send.`
    :waiting?`Sending ${plural(waiting)}…`
    :held&&q.some(x=>x.id===held)?"This game is saved to the shared scores when you play again or change players."
    :NET.saved&&Date.now()-NET.saved<8000?"Game saved.":"";
  $("syncNote").hidden=!$("syncNote").textContent;
}
/* ---------- players & stats, and the organiser's tidy-up (online only) ---------- */
const fmtDate=iso=>new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const fmtMonth=m=>new Date(m+"-01T12:00:00Z").toLocaleDateString("en-GB",{month:"short",year:"numeric"});
const fmtAvg=a=>a==null?"–":a.toFixed(2);
function renderPlayers(){
  const list=NET.players.slice().sort(byName);
  $("dirList").innerHTML=list.map(p=>`<button type="button" data-stats="${esc(p.id)}">${esc(p.name)}</button>`).join("");
  $("playersHint").textContent=list.length?"Tap a player to see their stats."+(NET.fresh?"":" (Offline: last saved list.)")
    :NET.fresh?"No registered players yet. Register players from the setup screen.":"Can't reach the players list right now.";
}
// The menu (top right): players & stats, tournaments, and the organiser's login and tidy-up
function renderMenu(){
  const org=ToadsApi.organiser();
  $("orgLogin").hidden=!!org;$("orgOn").hidden=!org;
  if(org)$("venueAdmin").innerHTML=NET.venues.slice().sort(byName).map(v=>`<li data-venue="${esc(v.id)}">
    <input type="text" value="${esc(v.name)}" maxlength="60" aria-label="Venue name"><button class="x" data-vsave>Save</button><button class="x" data-vdel>${NET.armed==="venue:"+v.id?"Tap again to delete":"Delete"}</button></li>`).join("")||`<li class="hint">No venues yet.</li>`;
  $("wipeYes").disabled=$("wipeInput").value.trim()!=="DELETE";
  $("soundOn").checked=soundOn();
}
function openMenu(){
  if(!["menu","players","stats","tours"].includes(S.stage))S.menuFrom=S.stage;
  S.stage="menu";$("wipeConfirm").hidden=true;render();loadDirectory();window.scrollTo(0,0);
}
// Back from the menu to whatever was on screen, if it still makes sense
function closeMenu(){
  let st=S.menuFrom||"setup";
  if(["game","win"].includes(st)&&!G())st=isTour()?"bracket":"setup";
  if(st==="order"&&!S.ord)st=isTour()?"bracket":"setup";
  if(st==="bracket"&&!isTour())st="setup";
  S.stage=st;render();window.scrollTo(0,0);
}

/* ---------- tournament management (online; editing needs the organiser) ---------- */
async function loadTours(){
  NET.toursMsg=NET.toursMsg||"";
  const r=await ToadsApi.tour("GET","?all=1");
  NET.tours=r.status===200&&r.data?r.data.tournaments:null;
  NET.toursOffline=!!r.offline;
  if(S.stage==="tours")render();
}
function openTours(){S.stage="tours";NET.tours=NET.tours||null;NET.tourAct=null;NET.toursMsg="";render();loadTours();window.scrollTo(0,0)}
const tvUrl=id=>location.origin+location.pathname+"#tv-"+id;
const statusText=t=>t.status==="ended"?"Ended":t.champion?`Won by ${t.champion}`:"Live";
function renderTours(){
  const org=!!ToadsApi.organiser(), list=NET.tours, a=NET.tourAct||{};
  $("toursHint").textContent=!list?(NET.toursOffline?"No signal, so the tournaments can't be listed. Try again in a moment.":"Loading…")
    :!list.length?"No live tournaments yet. Start one from the Tournament tab on the setup screen (organiser).":
    org?"Open one to follow it, put it on a TV screen, or edit, restart or delete it.":"Open one to follow it, or put it on a TV screen. Log in as organiser in the Menu to edit, restart or delete one.";
  $("toursMsg").textContent=NET.toursMsg||"";
  $("toursMsg").className="msg"+(/^(Can't|No signal|That)/.test(NET.toursMsg||"")?" bad":NET.toursMsg?" good":"");
  $("toursList").innerHTML=(list||[]).map(t=>{
    const on=a.id===t.id, id=esc(t.id);
    let extra="";
    if(on&&a.kind==="edit"){
      const d=a.data, names=d?drawNames(d.tour):[], maxT=Math.max(1,Math.min(MAX_TABLES,Math.floor(t.players/2)));
      extra=d?`<form class="touredit" data-edit="${id}">
        <label>Name<input type="text" name="name" value="${esc(d.name)}" maxlength="40" autocomplete="off"></label>
        <label>Venue<select name="venue">${venueOptions(d.venue)}</select></label>
        <div class="tedit"><span>Tables</span>${tableRows(d.tour)}
          ${d.tour.tables<maxT?`<button type="button" class="link" data-tbl="add">Add a table</button>`:""}</div>
        <label>New scoring PIN<input type="text" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Leave empty to keep it" autocomplete="off"></label>
        <label>Correct a player's name<span class="row"><select name="from"><option value="">Player…</option>${names.map(n=>`<option>${esc(n)}</option>`).join("")}</select><input type="text" name="to" maxlength="24" placeholder="New name" autocomplete="off"></span></label>
        <div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Save</button></div></form>`
        :`<p class="hint">Loading…</p>`;
    }
    if(on&&(a.kind==="restart"||a.kind==="delete"))extra=`<div class="confirm">
      <span>${a.kind==="restart"?`Start ${esc(t.name)} again from the draw? Every result goes, and phones scoring a table give it up.`:`Delete ${esc(t.name)} for everyone? Phones following it lose it. This can't be undone.`}</span>
      <label class="check"><input type="checkbox" data-games${a.kind==="restart"?" checked":""}> Also take its saved games out of the players' stats</label>
      <div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="button" data-yes="${a.kind}">${a.kind==="restart"?"Restart":"Delete"}</button></div></div>`;
    if(on&&a.kind==="end")extra=`<div class="confirm"><span>End ${esc(t.name)} for everyone? Scoring stops, and the results stay visible.</span>
      <div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="button" data-yes="end">End tournament</button></div></div>`;
    return `<div class="tourcard" data-tour="${id}">
      <div class="tn"><b>${esc(t.name)}</b><span class="pill${t.status==="live"&&!t.champion?"":" idle"}">${esc(statusText(t))}</span></div>
      <div class="ti">${t.venue?esc(t.venue)+" · ":""}${fmtDate(t.created)} · ${t.players} players · ${t.tables} table${t.tables===1?"":"s"} · code ${id}</div>
      ${matchPlan(t)}
      <div class="actions"><button type="button" class="primary" data-open>Open</button><a class="btn" href="${esc(tvUrl(t.id))}" target="_blank" rel="noopener">TV screen</a></div>
      ${org?`<div class="tclaim"><button type="button" class="link" data-act="edit">Edit</button><button type="button" class="link" data-act="restart">Restart</button>${t.status==="live"?`<button type="button" class="link" data-act="end">End</button>`:""}<button type="button" class="link" data-act="delete">Delete</button></div>`:""}
      ${extra}</div>`;
  }).join("");
}
// How many matches a tournament has: per round, in total, and per table (each match is 2 or 3 games)
function matchPlan(t){
  const tour=Toads.buildTour(Array.from({length:t.players},(_,i)=>"p"+i),t.tables,t.format==="byes"?"byes":"quali",()=>0,t.per||2);
  const rounds=[...(tour.quali?[["Qualifying",tour.quali.matches.length]]:[]),...tour.rounds.map((r,ri)=>[Toads.roundName(tour,ri),r.filter(m=>!m.bye).length])];
  const total=rounds.reduce((a,r)=>a+r[1],0), per=total/t.tables;
  return `<div class="plan"><span>${rounds.map(([n,k])=>`${esc(n)} <b>${k}</b>`).join(" · ")}</span>
    <span><b>${total}</b> matches in total (${total*2} to ${total*3} games) · about <b>${Number.isInteger(per)?per:`${Math.floor(per)}–${Math.ceil(per)}`}</b> per table with ${t.tables} table${t.tables===1?"":"s"}${t.played!=null?` · <b>${t.played}</b> played, ${total-t.played} to go`:""}</span></div>`;
}
// Every player in a tournament, in draw order
const drawNames=t=>t.quali?t.quali.draw.slice():t.rounds[0].flatMap(m=>[m.a,m.b]).filter(Boolean);
function tourDone(msg,ok){NET.toursMsg=msg;NET.tourAct=ok?null:NET.tourAct;loadTours();render()}
const failMsg=(r,what)=>r.offline?"No signal. Try again in a moment.":r.expired?"Your organiser login has run out. Log in again in the Menu.":`Can't ${what}: ${(r.data&&r.data.error)||r.error||r.status}.`;
async function tourAction(id,kind,el){
  const t=(NET.tours||[]).find(x=>x.id===id);if(!t)return;
  if(kind==="restart"||kind==="delete"){
    const withGames=!!(el.closest(".confirm").querySelector("[data-games]")||{}).checked;
    const r=kind==="restart"?await ToadsApi.tour("POST",`/${id}/restart`,{keepGames:!withGames},"required")
      :await ToadsApi.tour("DELETE",`/${id}`+(withGames?"?games=delete":""),undefined,"required");
    const n=r.data&&r.data.gamesDeleted, games=n?` ${n} saved game${n===1?"":"s"} taken out of the stats.`:"";
    if(r.status===200){
      if(S.live&&S.live.id===id){if(kind==="delete"){S.live=null;setHash(null)}else liveFetch(true)}
      tourDone(kind==="restart"?`${t.name} starts again from the draw.${games}`:`Deleted ${t.name}.${games}`,true);
    }else tourDone(failMsg(r,kind==="restart"?"restart it":"delete it"),false);
  }
  if(kind==="end"){
    const r=await ToadsApi.tour("POST",`/${id}/end`,{},"required");
    if(r.status===200&&S.live&&S.live.id===id)liveFetch(true);
    tourDone(r.status===200?`${t.name} has ended. Everyone can still see the results.`:failMsg(r,"end it"),r.status===200);
  }
}
async function startEdit(id){
  NET.tourAct={id,kind:"edit",data:null};render();
  const r=await ToadsApi.tour("GET","/"+id);
  if(!NET.tourAct||NET.tourAct.id!==id)return;
  if(r.status===200&&r.data&&r.data.tournament)NET.tourAct.data=r.data.tournament;
  else{NET.tourAct=null;NET.toursMsg=failMsg(r,"open it")}
  render();
}
async function saveEdit(form){
  const id=form.dataset.edit, d=NET.tourAct&&NET.tourAct.data;if(!d)return;
  const f=k=>form.elements[k].value.replace(/\s+/g," ").trim(), body={};
  if(f("name")!==d.name)body.name=f("name");
  if(f("venue")!==(d.venue||""))body.venue=f("venue")||null;
  const names={};
  for(let k=0;k<d.tour.tables;k++){const el=form.elements["tname"+k];if(!el)continue;const v=el.value.replace(/\s+/g," ").trim();if(v!==((d.tour.names||{})[k]||""))names[k]=v}
  if(Object.keys(names).length)body.tableNames=names;
  if(f("pin"))body.pin=f("pin");
  if(f("from")&&f("to"))body.rename={from:f("from"),to:f("to")};
  if(!Object.keys(body).length){NET.tourAct=null;render();return}
  const r=await ToadsApi.tour("PATCH","/"+id,body,"required");
  if(r.status===200){
    if(S.live&&S.live.id===id){if(body.pin)S.live.pin=body.pin;liveFetch(true)}
    tourDone(`Saved ${body.name||d.name}.`,true);
  }else{NET.toursMsg=failMsg(r,"save it");render()}
}

/* ---------- TV screen (#tv-<code>): tables and what's next on the left, the bracket on the right ---------- */
let tvTimer=null, wake=null;
async function openTV(id){
  TV={id,tour:null};render();
  await tvFetch(true);
  if(!tvTimer)tvTimer=setInterval(()=>{if(TV&&document.visibilityState==="visible")tvFetch(false)},LIVE_POLL);
  keepAwake();
}
function closeTV(){TV=null;clearInterval(tvTimer);tvTimer=null;try{wake&&wake.release()}catch(e){}wake=null;render()}
// Ask the screen not to go to sleep (where the browser allows it)
async function keepAwake(){try{if(TV&&navigator.wakeLock&&document.visibilityState==="visible")wake=await navigator.wakeLock.request("screen")}catch(e){}}
// The scoring phone stays on during a game (screens otherwise dim and lock between turns)
async function gameAwake(){
  const want=!TV&&["game","order"].includes(S.stage)&&document.visibilityState==="visible";
  try{
    if(want&&!wake&&navigator.wakeLock){wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null})}
    else if(!want&&!TV&&wake){const w=wake;wake=null;await w.release()}
  }catch(e){}
}
async function tvFetch(full){
  const T=TV;if(!T)return;
  const r=await ToadsApi.tour("GET",`/${T.id}`+(full||!T.tour?"":`?since=${T.ver}`));
  if(TV!==T)return;
  T.offline=!!r.offline;
  if(r.status===404){T.tour=null;T.error="This tournament doesn't exist (or was deleted)."}
  else if(r.status===200&&r.data&&r.data.tournament){Object.assign(T,r.data.tournament,{error:null,seen:Date.now()})}
  else if(r.status===200&&r.data&&r.data.same)T.seen=Date.now();
  else if(!T.tour)T.error=r.offline?"No signal. Trying again…":"Can't open the tournament right now. Trying again…";
  render();
}
function renderTV(){
  const T=TV, t=T.tour;
  $("tvMsg").hidden=!(T.error||!t);
  $("tvMsg").textContent=T.error||"Opening the tournament…";
  $("tvMain").hidden=!t;
  $("tvTitle").textContent=t?T.name:"Toads 31";
  $("tvInfo").textContent=t?[T.venue,T.status==="ended"?"Ended":t.champion?"Finished":"Live",T.offline?"no signal, last scores shown":null].filter(Boolean).join(" · "):"";
  const url=location.origin+location.pathname+"#t-"+T.id;
  $("tvLink").textContent=url.replace(/^https?:\/\//,"");
  drawQr(url,"tvQr");
  if(!t)return;
  Toads.settle(t);
  const list=all(), on=list.filter(({m})=>m.table!=null&&!m.winner).sort((x,y)=>x.m.table-y.m.table);
  $("tvNow").innerHTML=on.map(({m,ri})=>{
    const g=m.game&&!m.game.done?m.game:null, k=m.table, claimed=T.claims&&T.claims[k];
    const side=(name,w)=>{const i=g?g.gp.indexOf(name):-1;return `<div class="tvp${g&&g.cur===i?" up":""}"><span>${esc(name)}</span><i>${w}</i><b>${g?ringIf(g.rem[i]):""}</b></div>`};
    return `<div class="tvtable${g?" playing":""}"><div class="tvtn"><span>${TN(k)}</span><span>${roundName(ri)} · game ${gameNo(m)}</span></div>
      ${side(m.a,m.wa)}${side(m.b,m.wb)}
      <div class="tvst">${g?`${esc(throwerOf(g,g.cur))} to throw · round ${g.round}`:claimed?"Ready to start":"Ready: scan the code to score this table"}</div></div>`;
  }).join("")||`<p class="tvnone">${t.champion?"All games played.":"No games on the tables right now."}</p>`;
  // Coming up: matches still to be played that have no table yet, earliest round first
  const waiting=list.filter(({m})=>!m.winner&&!m.bye&&m.table==null&&m.a&&m.b), next=waiting.slice(0,6);
  $("tvNextHead").hidden=!next.length;
  $("tvNext").innerHTML=next.map(({m,ri})=>`<li><span>${esc(m.a)} v ${esc(m.b)}</span><i>${roundName(ri)}</i></li>`).join("")+(waiting.length>6?`<li><i>and ${waiting.length-6} more</i></li>`:"");
  $("tvChamp").innerHTML=t.champion?`<div class="tvchamp">${TOAD}<div><span>Champion</span><b>${esc(t.champion)}</b></div></div>`:"";
  // While qualifying is on, its table fills the board; the knockout appears once it is complete,
  // and a small button switches back to the final qualifying table (T.showQuali)
  const done=!!t.quali&&qualiDone(), quali=t.quali&&(!done||T.showQuali);
  $("tvSwitch").hidden=!done;
  $("tvSwitch").textContent=quali?"Show the knockout":"Show qualifying";
  $("tvQuali").innerHTML=quali?qualiHTML(true):"";
  $("tvBracket").innerHTML=quali?`<p class="tvlater">${done?`Qualifying is complete: the top ${t.quali.K} play the knockout,`:`Then the top ${t.quali.K} play a knockout:`} ${t.rounds.map((_,ri)=>roundName(ri).toLowerCase()).join(", ")}.</p>`:bracketHTML();
  fitTV();
}
// Everything stays on one screen: shrink the text of a side until it fits (no scrolling on a TV)
function fitTV(){
  for(const el of document.querySelectorAll(".tvgames,.tvboard")){
    let px=parseFloat(getComputedStyle($("tvView")).fontSize);
    el.style.fontSize=px+"px";
    while(px>7&&(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)){px*=.94;el.style.fontSize=px+"px"}
  }
}

function renderStats(){
  const org=ToadsApi.organiser(), key=S.statsId+"|"+(S.statsVenue||""), d=NET.statsKey===key?NET.stats:null, known=NET.players.find(p=>p.id===S.statsId);
  if(NET.statsKey!==key)loadStats(key);
  $("statsName").textContent=d&&d.player?d.player.name:known?known.name:"";
  const bad=d&&(d.offline||d.error);
  $("statsMsg").textContent=!d?"Loading…":d.offline?"Can't reach the stats right now. Try again when there's signal.":d.error?(d.status===404?"This player is no longer on the list.":d.error):NET.statsNote||"";
  $("statsMsg").className="msg"+(bad?" bad":NET.statsNote&&d?" good":"");
  const ok=d&&d.totals;
  const pubs=ok?d.venues.filter(v=>v.venueId):[];
  $("statsVenue").innerHTML=`<option value="">All pubs</option>`+pubs.map(v=>`<option value="${esc(v.venueId)}"${v.venueId===S.statsVenue?" selected":""}>${esc(v.name)} (${v.played})</option>`).join("");
  $("statsVenue").hidden=$("statsVenue").previousElementSibling.hidden=!ok||!pubs.length;
  if(!ok){$("statsBody").innerHTML="";}
  else if(!d.totals.played)$("statsBody").innerHTML=`<p class="empty">No saved games ${S.statsVenue?"at this pub ":""}yet.</p>`;
  else{
    const t=d.totals, rate=Math.round(100*t.won/t.played), b=d.best;
    const where=g=>g.venue?` at ${esc(g.venue)}`:"";
    $("statsBody").innerHTML=`<div class="tiles">
      <div class="tile"><b>${t.played}</b><span>games played</span></div><div class="tile"><b>${t.won}</b><span>games won</span></div>
      <div class="tile"><b>${rate}%</b><span>win rate</span></div><div class="tile"><b>${fmtAvg(t.avg)}</b><span>average per toad</span></div></div>
      ${b?`<p><b>Best game:</b> ${fmtAvg(b.avg)} per toad, ${b.won?"won":"lost"}${where(b)} on ${fmtDate(b.finished)}${b.sides>1?` (${b.sides} ${b.mode==="duo"?"teams":"players"})`:" (solo)"}.</p>`:""}
      <h2>By month</h2><table class="st"><tr><th>Month</th><th class="n">Played</th><th class="n">Won</th><th class="n">Avg</th></tr>
      ${d.months.slice().reverse().map(m=>`<tr><td>${fmtMonth(m.month)}</td><td class="n">${m.played}</td><td class="n">${m.won}</td><td class="n">${fmtAvg(m.avg)}</td></tr>`).join("")}</table>
      ${(d.tournaments||[]).length?`<h2>Tournaments</h2><table class="st"><tr><th>Tournament</th><th class="n">Games</th><th class="n">Won</th></tr>
      ${d.tournaments.map(t=>`<tr><td>${esc(t.name)} <span class="hint">${fmtDate(t.last)}</span></td><td class="n">${t.played}</td><td class="n">${t.won}</td></tr>`).join("")}</table>`:""}
      ${d.headToHead.length?`<h2>Head to head</h2><table class="st"><tr><th>Against</th><th class="n">Played</th><th class="n">Won</th><th class="n">Lost</th></tr>
      ${d.headToHead.map(o=>`<tr><td>${esc(o.name)}${o.playerId?"":' <span class="tag">guest</span>'}</td><td class="n">${o.played}</td><td class="n">${o.won}</td><td class="n">${o.lost}</td></tr>`).join("")}</table>`:""}
      <h2>${NET.allGames?"All games":"Latest games"}</h2><table class="st"><tr><th>Date</th><th>Pub</th><th>Result</th><th class="n">Avg</th>${org?"<th></th>":""}</tr>
      ${d.recent.slice(0,NET.allGames?undefined:10).map(g=>`<tr><td>${fmtDate(g.finished)}</td><td>${esc(g.venue||"–")}${g.tournament?` <span class="hint">· ${esc(g.tournament)}</span>`:""}</td><td class="${g.won?"res-w":"res-l"}">${g.won?"Won":g.winner?esc(g.winner)+" won":"Lost"}${g.sides>1?"":" (solo)"}</td><td class="n">${fmtAvg(g.avg)}</td>${org?`<td class="n"><button type="button" class="x" data-delgame="${esc(g.gameId)}">${NET.armed==="game:"+g.gameId?"Tap again":"Delete"}</button></td>`:""}</tr>`).join("")}</table>
      ${(d.count||d.recent.length)>10?`<button type="button" class="ghost" id="allGamesBtn">${NET.allGames?"Show the latest 10":`Show all ${d.count||d.recent.length} games`}</button>`:""}
      ${org?`<p class="hint">Deleting a game takes it out of the stats of everyone who played in it.</p>`:""}`;
  }
  const p=d&&d.player;
  $("statsOrg").hidden=!(org&&p);
  if(org&&p){
    if(document.activeElement!==$("renameInput")&&NET.renameFor!==p.id){$("renameInput").value=p.name;NET.renameFor=p.id}
    $("mergeInto").innerHTML=`<option value="">Merge into…</option>`+NET.players.filter(x=>x.id!==p.id).sort(byName).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
  }
}
async function loadStats(key){
  NET.statsKey=key;NET.stats=null;
  const r=await ToadsApi.stats(S.statsId,S.statsVenue||null);
  if(NET.statsKey!==key)return;
  NET.stats=r;
  if(S.stage==="stats")render();
}
const reloadStats=()=>{NET.statsKey=null;render()};
function showPlayer(id){NET.statsNote=null;NET.allGames=false;NET.armed=null;S.statsId=id;S.statsVenue="";NET.statsKey=null;NET.renameFor=null;$("statsConfirm").hidden=true;S.stage="stats";render();window.scrollTo(0,0)}
// Ask before a merge or delete; the answer runs fn
function confirmStats(text,fn){$("statsConfirmText").textContent=text;$("statsConfirm").hidden=false;NET.onConfirm=fn}
function tidyResult(r,okMsg,el){
  const msg=$(el);
  if(r.item||r.moved!=null){msg.textContent=okMsg;msg.className="msg good";return true}
  msg.textContent=r.offline?"No signal. Try again in a moment.":r.expired?"Your organiser login has run out. Log in again in the Menu.":`That didn't work: ${r.error}.`;
  msg.className="msg bad";return false;
}
// A renamed or merged player: use the new name in the game being set up
function renamePlayer(from,to){
  if(from===to||!S.players.includes(from)||S.players.includes(to))return;
  S.players=S.players.map(x=>x===from?to:x);
  S.teams.forEach(t=>{if(t.a===from)t.a=to;if(t.b===from)t.b=to});
}

// The venue is picked from the organiser's list, and can be left blank. A name that isn't on the
// list (kept from before) stays selectable so it isn't lost quietly.
function venueOptions(cur){
  const list=NET.venues.slice().sort(byName), keep=cur&&!findIn(list,cur);
  return `<option value="">No venue</option>`+(keep?`<option selected>${esc(cur)}</option>`:"")
    +list.map(v=>`<option value="${esc(v.name)}"${cur&&nameKey(v.name)===nameKey(cur)?" selected":""}>${esc(v.name)}${v.area?` (${esc(v.area)})`:""}</option>`).join("");
}
// Edit form: every table, with its name, and Remove (only before its match starts) or Put back
function tableRows(tour){
  const off=tour.off||[], active=tour.tables-off.length;
  return `<ul class="tlist">${Array.from({length:tour.tables},(_,k)=>{
    const out=off.includes(k), m=Toads.allMatches(tour).find(({m})=>m.table===k&&!m.winner), busy=m&&m.m.game;
    const act=out?`<button type="button" class="x" data-tbl="restore" data-k="${k}">Put back</button>`
      :busy?`<span class="hint">Match under way</span>`
      :active>1?`<button type="button" class="x" data-tbl="remove" data-k="${k}">Remove</button>`:"";
    return `<li${out?` class="out"`:""}><input type="text" name="tname${k}" value="${esc((tour.names||{})[k]||"")}" placeholder="Table ${k+1}" maxlength="20" aria-label="Name of table ${k+1}"${out?" disabled":""}>${act}</li>`;
  }).join("")}</ul>`;
}
// Remove, put back or add a table straight away, then show the form again with the new state
async function tableAction(id,kind,k){
  const d=NET.tourAct&&NET.tourAct.data;if(!d)return;
  const nm=Toads.tableName(d.tour,k);
  const body=kind==="add"?{tables:d.tour.tables+1}:kind==="remove"?{removeTable:k}:{restoreTable:k};
  const r=await ToadsApi.tour("PATCH","/"+id,body,"required");
  NET.toursMsg=r.status===200?(kind==="add"?`Added Table ${d.tour.tables+1}.`:kind==="remove"?`Took ${nm} out. Its match waits for the next free table.`:`${nm} is back.`)
    :failMsg(r,kind==="add"?"add a table":kind==="remove"?"remove it":"put it back");
  if(r.status===200&&S.live&&S.live.id===id)liveFetch(true);
  loadTours();await startEdit(id);
}

/* ---------- live tournaments (online only) ---------- */
// The organiser creates one; anyone follows it with its link (#t-<code>) and the phone that claims a table
// with the PIN scores it. Changes are applied here straight away with the same rules as the server
// (Toads.applyOp), queued, and sent in order, so scoring carries on with no signal.
// S.live = {id, name, venue, status, ver, tour, claims, mine:{table:{token,tag}}, pin, queue:[{n, op}], seen}
const LIVE_POLL=4000;
const liveOn=()=>!!(NET.on&&S.live&&S.live.tour);
const myTable=k=>!!(S.live&&S.live.mine[k]);
const scoring=()=>{const m=M();return !S.live||(m&&myTable(m.table))};
const liveHash=()=>{const h=/^#t-([A-Z0-9]{6})$/i.exec(location.hash);return h?h[1].toUpperCase():null};
function setHash(id){try{history.replaceState(null,"",location.pathname+location.search+(id?"#t-"+id:""))}catch(e){}}
const ago=ms=>{const s=Math.round(ms/1000);return s<60?`${s} s ago`:s<3600?`${Math.round(s/60)} min ago`:`${Math.round(s/3600)} h ago`};
function liveTake(t){
  const L=S.live;
  Object.assign(L,{name:t.name,venue:t.venue,status:t.status,ver:t.ver,tour:t.tour,claims:t.claims||{},seen:Date.now()});
  // A phone that lost its table (taken over, released by the organiser) stops scoring it
  for(const k of Object.keys(L.mine))if(!L.claims[k]||L.claims[k].tag!==L.mine[k].tag){
    delete L.mine[k];L.queue=L.queue.filter(x=>x.n!=+k);
    NET.liveNote=`${tname(+k)} is now scored on another phone.`;
  }
}
async function follow(id){
  NET.liveMsg="Opening the tournament…";render();
  const r=await ToadsApi.tour("GET","/"+id);
  if(r.status===200&&r.data&&r.data.tournament){
    S.live={id,mine:{},queue:[],pin:null};liveTake(r.data.tournament);NET.liveMsg="";NET.liveNote="";
    setHash(id);goHub();window.scrollTo(0,0);return;
  }
  NET.liveMsg=r.offline?"No signal, so the tournament can't be opened. Try again in a moment.":r.status===404?"That tournament doesn't exist (or was deleted).":`Can't open the tournament: ${(r.data&&r.data.error)||r.status}.`;
  if(liveHash()===id)setHash(null);
  render();
}
function leaveLive(){S.live=null;NET.liveNote="";NET.pinFor=null;setHash(null);S.focus=null;S.ord=null;S.last=null;S.stage="setup";render()}
async function loadLiveList(){
  const r=await ToadsApi.tour("GET","");
  NET.liveList=r.status===200&&r.data?r.data.tournaments:null;
  if(S.stage==="setup")render();
}
async function createLive(){
  const name=$("liveName").value.replace(/\s+/g," ").trim(), pin=$("livePin").value.trim();
  if(!name||!/^\d{4,8}$/.test(pin)){NET.liveMsg=!name?"Give the tournament a name.":"The scoring PIN must be 4 to 8 digits.";render();return}
  NET.liveMsg="Creating the tournament…";render();
  const r=await ToadsApi.tour("POST","",{name,venue:S.venue||null,players:S.players.slice(),tables:S.tables,format:S.tourFormat,per:qualiPer(S.players.length),pin},"required");
  if(r.status===201&&r.data){
    S.live={id:r.data.tournament.id,mine:{},queue:[],pin};liveTake(r.data.tournament);
    NET.liveMsg="";NET.liveNote="Share the link or QR code so others can follow. Tap a table to score it.";NET.shareOpen=true;
    S.liveOn=false;$("liveName").value="";$("livePin").value="";
    setHash(S.live.id);goHub();window.scrollTo(0,0);return;
  }
  NET.liveMsg=r.offline?"No signal, so the live tournament can't be created. Untick “Run it live” to play it on this phone only.":r.expired?"Your organiser login has run out. Log in again in the Menu.":`Can't create it: ${(r.data&&r.data.error)||r.status}.`;
  render();
}
// Apply a change to this phone's copy, then queue it for the server. → the applyOp result
function livePlay(op){
  const m=M(), r=Toads.applyOp(S.live.tour,m.table,op);
  if(r.ok&&!r.dup){S.live.queue.push({n:m.table,op});save();liveFlush()}
  return r;
}
let flushingLive=false;
async function liveFlush(){
  if(!liveOn()||flushingLive)return;
  flushingLive=true;let reload=false;
  try{
    while(S.live&&S.live.queue.length){
      const L=S.live,{n,op}=L.queue[0],c=L.mine[n];
      if(!c){L.queue.shift();continue}
      const r=await ToadsApi.tour("POST",`/${L.id}/tables/${n}/play`,{token:c.token,op});
      if(r.offline||r.status>=500){L.offline=true;break}
      L.offline=false;
      if(r.status===200){L.queue.shift();save();continue}
      // Refused: another phone changed the table, the claim went, or the tournament ended. Show what the server has.
      L.queue=L.queue.filter(x=>x.n!==n);
      if(r.status===403){delete L.mine[n];NET.liveNote=`${tname(n)} is now scored on another phone.`}
      else NET.liveNote=`${tname(n)} had moved on, so this phone now shows the latest scores.`;
      if(M()&&M().table===n&&["game","win","order"].includes(S.stage)){S.focus=null;S.ord=null;S.last=null;S.stage="bracket"}
      reload=true;
    }
  }finally{flushingLive=false}
  save();
  if(reload)await liveFetch(true);else if(S.live&&!S.live.queue.length)await liveFetch(false);
  else liveStatus();
}
// Fetch the tournament (only when it changed, unless full). Skipped while this phone has changes to send.
async function liveFetch(full){
  if(!liveOn())return;
  if(S.live.queue.length){liveStatus();return}
  const L=S.live, r=await ToadsApi.tour("GET",`/${L.id}`+(full?"":`?since=${L.ver}`));
  if(S.live!==L||L.queue.length)return;
  if(r.offline){L.offline=true;liveStatus();return}
  L.offline=false;
  if(r.status===404){NET.liveMsg="That tournament was deleted.";leaveLive();return}
  if(r.status!==200||!r.data){liveStatus();return}
  if(r.data.same){L.seen=Date.now();liveStatus();return}
  liveTake(r.data.tournament);save();
  // Redraw unless this phone is in the middle of scoring a game (its copy is already up to date)
  const m=M();
  if(S.stage==="bracket"||(S.stage==="game"&&!scoring()))render();
  else if(S.stage==="order"&&(!m||!myTable(m.table)))goHub();
  else liveStatus();
}
function liveStatus(){
  const L=S.live;if(!L||!$("liveInfo"))return;
  const q=L.queue.length;
  $("liveInfo").textContent=(L.venue?L.venue+" · ":"")+(L.status==="ended"?"Ended":L.tour.champion?"Finished":"Live")+` · code ${L.id}`;
  $("liveSync").textContent=q?(L.offline?`Offline: ${q} change${q===1?"":"s"} waiting to send.`:"Sending…")
    :L.offline?`Offline: showing the scores from ${ago(Date.now()-(L.seen||0))}.`:L.seen?`Updated ${ago(Date.now()-L.seen)}.`:"";
  $("liveSync").className="hint"+(L.offline?" bad":"");
  if(S.stage==="game")gameSync();
}
async function claimTable(k,takeover){
  const L=S.live;
  if(!L.pin){NET.pinFor={k,takeover};render();$("pinInput").focus();return}
  NET.liveNote=`Claiming ${tname(k)}…`;render();
  const r=await ToadsApi.tour("POST",`/${L.id}/tables/${k}/claim`,{pin:L.pin,takeover:!!takeover});
  if(S.live!==L)return;
  if(r.status===200&&r.data){
    L.mine[k]={token:r.data.token,tag:r.data.tag};NET.pinFor=null;
    NET.liveNote=`This phone now scores ${tname(k)}.`;await liveFetch(true);render();return;
  }
  if(r.status===403){L.pin=null;NET.pinFor={k,takeover};NET.liveNote="Wrong PIN.";}
  else if(r.status===409&&r.data&&r.data.claimed){NET.liveNote=`Another phone is already scoring ${tname(k)}. Tap “Take over” if it has stopped.`;await liveFetch(true)}
  else NET.liveNote=r.offline?"No signal. Try again in a moment.":`Can't claim the table: ${(r.data&&r.data.error)||r.status}.`;
  render();
}
async function releaseTable(k){
  const L=S.live, c=L.mine[k];
  if(c&&L.queue.some(x=>x.n===k)){NET.liveNote=`Wait until ${tname(k)}'s scores are sent before giving it up.`;render();return}
  const r=await ToadsApi.tour("POST",`/${L.id}/tables/${k}/release`,{token:c&&c.token},!c);
  if(S.live!==L)return;
  if(r.status===200){delete L.mine[k];NET.liveNote=`${tname(k)} is free for another phone to score.`;await liveFetch(true)}
  else NET.liveNote=r.offline?"No signal. Try again in a moment.":`Can't release the table: ${(r.data&&r.data.error)||r.status}.`;
  render();
}
async function endLive(){
  const L=S.live, r=await ToadsApi.tour("POST",`/${L.id}/end`,{},"required");
  NET.liveNote=r.status===200?"The tournament has ended. Everyone can still see the results.":r.offline?"No signal. Try again in a moment.":r.expired?"Your organiser login has run out. Log in again in the Menu.":`Can't end it: ${(r.data&&r.data.error)||r.status}.`;
  if(r.status===200)await liveFetch(true);
  render();
}
// QR code for the link, drawn by js/vendor/qrcode.js, loaded the first time it is needed
function drawQr(url,boxId="liveQr"){
  const box=$(boxId);
  if(box.dataset.url===url)return;
  if(!window.qrcode){
    if(!document.getElementById("qrLib")){const sc=document.createElement("script");sc.id="qrLib";sc.src=document.querySelector('meta[name="toads-qr"]').content;sc.onload=()=>render();document.head.appendChild(sc)}
    return;
  }
  const q=qrcode(0,"M");q.addData(url);q.make();
  box.innerHTML=q.createSvgTag({cellSize:5,margin:3,scalable:true,alt:"QR code for "+url});box.dataset.url=url;
}
function renderLivePanel(){
  const L=S.live, on=!!L&&liveOn();
  $("livePanel").hidden=!on;
  if(!on)return;
  $("liveTitle").textContent=L.name;
  const org=!!ToadsApi.organiser(), url=location.origin+location.pathname+"#t-"+L.id;
  $("liveNote").textContent=NET.liveNote||"";
  $("liveNote").className="msg"+(/^(Wrong|Can't|No signal|Another)| is now scored on another phone| had moved on/.test(NET.liveNote||"")?" bad":"");
  $("shareBox").hidden=!NET.shareOpen;
  $("liveShareBtn").setAttribute("aria-expanded",!!NET.shareOpen);
  if(NET.shareOpen){$("liveLink").value=url;drawQr(url)}
  $("liveTv").href=tvUrl(L.id);
  const p=NET.pinFor;
  $("pinForm").hidden=!p;
  if(p)$("pinLabel").textContent=`Enter the scoring PIN to ${p.takeover?"take over":"score"} ${tname(p.k)}.`;
  $("liveEnd").hidden=!(org&&L.status!=="ended");
  liveStatus();
}
// Live extras on a table card: who is scoring it, and the buttons that go with that
function liveCard(k,x){
  const L=S.live, mine=myTable(k), other=!mine&&!!L.claims[k], ended=L.status==="ended", g=x&&x.m.game&&!x.m.game.done?x.m.game:null;
  let main="", extra="";
  if(mine){
    if(x)main=`<button class="${g?"":"primary"}" data-ri="${x.ri}" data-mi="${x.mi}">${g?"Continue":`Start game ${gameNo(x.m)}`}</button>`;
    extra=`<span>Scored on this phone</span><button type="button" class="link" data-release="${k}">Give up table</button>`;
  }else{
    if(x&&g)main=`<button data-ri="${x.ri}" data-mi="${x.mi}">Watch</button>`;
    else if(!other&&!ended)main=`<button class="primary" data-claim="${k}">Score this table</button>`;
    if(other)extra=`<span>Scored on another phone</span>${ended?"":`<button type="button" class="link" data-takeover="${k}">Take over</button>`}${ToadsApi.organiser()?`<button type="button" class="link" data-release="${k}">Release</button>`:""}`;
    else if(x&&g&&!ended)extra=`<span>Nobody is scoring it</span><button type="button" class="link" data-claim="${k}">Score this table</button>`;
  }
  return {main,extra:extra?`<div class="tclaim">${extra}</div>`:""};
}

/* ---------- duo teams ---------- */
// Each team: {name, a: throws 1st, b: throws 2nd}
function teamProblem(){
  const t=S.teams;
  if(!t.length)return "Add at least one team.";
  if(t.some(x=>!x.a||!x.b))return "Each team needs two players.";
  if(t.some(x=>x.a===x.b))return "A team needs two different players.";
  const used=t.flatMap(x=>[x.a,x.b]);
  if(new Set(used).size!==used.length)return "A player can only be in one team.";
  if(t.some(x=>!x.name.trim()))return "Give every team a name.";
  if(new Set(t.map(x=>x.name.trim().toLowerCase())).size!==t.length)return "Two teams have the same name.";
  return "";
}
function renderTeams(){
  // drop anyone no longer on the player list
  S.teams.forEach(t=>{if(!S.players.includes(t.a))t.a=null;if(!S.players.includes(t.b))t.b=null});
  const taken=(ti,slot)=>new Set(S.teams.flatMap((t,j)=>[j===ti&&slot==="a"?null:t.a,j===ti&&slot==="b"?null:t.b]).filter(Boolean));
  const opts=(ti,slot)=>{const cur=S.teams[ti][slot],tk=taken(ti,slot);
    return `<option value="">Choose…</option>`+S.players.filter(p=>p===cur||!tk.has(p)).map(p=>`<option value="${esc(p)}"${p===cur?" selected":""}>${esc(p)}</option>`).join("")};
  $("teamList").innerHTML=S.teams.map((t,i)=>`<div class="team">
    <div class="trow"><input type="text" id="tname${i}" class="tname" data-t="${i}" value="${esc(t.name)}" maxlength="20" aria-label="Team name"><button class="x" data-rmt="${i}">Remove</button></div>
    <div class="tslots">
      <label for="ta${i}"><span>Throws 1st</span><select id="ta${i}" data-t="${i}" data-slot="a">${opts(i,"a")}</select></label>
      <button type="button" class="swap" data-swap="${i}" aria-label="Swap who throws first in ${esc(t.name)}">Swap</button>
      <label for="tb${i}"><span>Throws 2nd</span><select id="tb${i}" data-t="${i}" data-slot="b">${opts(i,"b")}</select></label>
    </div></div>`).join("")||`<p class="empty">No teams yet.</p>`;
  const free=S.players.filter(p=>!S.teams.some(t=>t.a===p||t.b===p));
  $("addTeamBtn").disabled=S.teams.length>=Math.max(1,Math.floor(S.players.length/2))&&free.length<2;
}
function addTeam(){
  const free=S.players.filter(p=>!S.teams.some(t=>t.a===p||t.b===p));
  let k=S.teams.length+1;while(S.teams.some(t=>t.name===`Team ${k}`))k++;
  S.teams.push({name:`Team ${k}`,a:free[0]||null,b:free[1]||null});
  render();
}

function renderOrder(){
  const o=S.ord, left=o.pending.filter(p=>!o.order.includes(p)), m=M();
  $("orderTitle").textContent=m?`Throwing order · ${tname(m.table)} · Game ${gameNo(m)}`:"Throwing order";
  $("orderHint").textContent=S.mode==="duo"&&!m
    ?"One player from each team throws a toad. Tap the teams from closest to the hole to furthest away."
    :"Each player throws one toad. Tap the players from closest to the hole to furthest away.";
  $("pickedList").innerHTML=o.pending.map((_,i)=>o.order[i]
    ?`<li><span class="num">${i+1}</span>${esc(o.order[i])}${i===0?' <span class="hint">throws first</span>':""}</li>`
    :`<li class="slot"><span class="num">${i+1}</span>${i===o.order.length?"Tap the next closest":"&nbsp;"}</li>`).join("");
  $("pickGrid").innerHTML=left.map(p=>`<button data-p="${esc(p)}">${esc(p)}</button>`).join("");
  $("pickGrid").hidden=!left.length;
  $("orderReset").disabled=!o.order.length;
  $("orderGo").disabled=left.length>0;
  $("orderBack").textContent=m?"Back to tables":"Back";
}

function renderHub(){
  settle();assignTables();
  const t=TOUR();
  $("endTourConfirm").hidden=true;
  renderLivePanel();
  $("endTourBtn").parentElement.hidden=!!S.live;
  $("champPanel").hidden=!t.champion;
  $("tablesPanel").hidden=!!t.champion;
  if(t.champion){$("champToad").innerHTML=TOAD;$("champName").textContent=t.champion}
  $("champNew").hidden=!!S.live;$("champChange").textContent=S.live?"Leave":"Change players";
  const list=all();
  let cards="";
  for(let k=0;k<t.tables;k++){
    if(!Toads.tableOn(t,k))continue;
    const x=list.find(({m})=>m.table===k&&!m.winner);
    const lc=S.live?liveCard(k,x):null;
    if(!x){
      const more=list.some(({m})=>!m.winner&&!m.bye);
      cards+=`<div class="tcard free"><div class="tn"><span>${TN(k)}</span><span class="pill idle">Free</span></div><div class="ti">${more?"Waiting for earlier matches to finish.":"No more matches."}</div>${lc&&more?lc.main+lc.extra:lc&&myTable(k)?lc.extra:""}</div>`;
      continue;
    }
    const {m,ri,mi}=x, g=m.game&&!m.game.done?m.game:null;
    cards+=`<div class="tcard"><div class="tn"><span>${TN(k)}</span><span class="pill${g?"":" idle"}">${g?"Playing":"Ready"}</span></div>
      <div class="tw">${esc(m.a)} v ${esc(m.b)}</div>
      <div class="ti">${roundName(ri)} · Game ${gameNo(m)}${gameNo(m)>1?` · ${m.wa}–${m.wb}`:""}</div>
      ${g?`<div class="live">${g.gp.map((p,i)=>`${esc(p)} ${g.rem[i]}`).join(" · ")} left</div>`:""}
      ${lc?lc.main+lc.extra:`<button class="${g?"":"primary"}" data-ri="${ri}" data-mi="${mi}">${g?"Continue":`Start game ${gameNo(m)}`}</button>`}</div>`;
  }
  $("tableCards").innerHTML=cards;
  // Collapsible: when closed, a one-line summary stands in for the cards
  const busy=list.filter(({m})=>m.table!=null&&!m.winner), playing=busy.filter(({m})=>m.game&&!m.game.done).length;
  const parts=[];
  if(playing)parts.push(`${playing} playing`);
  if(busy.length-playing)parts.push(`${busy.length-playing} ready`);
  const active=t.tables-(t.off||[]).length;
  if(active-busy.length)parts.push(`${active-busy.length} free`);
  $("tablesSummary").textContent=S.tablesCollapsed?parts.join(" · "):"";
  $("tablesToggle").setAttribute("aria-expanded",!S.tablesCollapsed);
  $("tablesBody").hidden=!!S.tablesCollapsed;
  // Next to come: matches whose players are known but have no table yet. Collapsed by default.
  const wait=list.filter(({m})=>ready(m)&&m.table==null);
  const playingNow=new Set(busy.flatMap(({m})=>[m.a,m.b]));
  $("nextBox").hidden=!wait.length;
  $("nextToggle").setAttribute("aria-expanded",!!S.nextOpen);
  $("nextList").hidden=!S.nextOpen;
  $("nextSummary").textContent=`${wait.length} match${wait.length===1?"":"es"} · table pending`;
  $("nextList").innerHTML=wait.map(({m,ri})=>{
    const still=[m.a,m.b].filter(x=>playingNow.has(x));
    return `<li><span class="nm">${esc(m.a)} v ${esc(m.b)}</span><span class="nr">${roundName(ri)}</span><span class="pill idle">${still.length?`Waiting for ${still.map(esc).join(" & ")}`:"Table pending"}</span></li>`;
  }).join("");
  $("bracket").innerHTML=bracketHTML();
  $("qualiWrap").hidden=!t.quali;
  if(t.quali)$("quali").innerHTML=qualiHTML();
}

// Qualifying standings on the chalkboard; the top K are above the dashed cut line
function qualiHTML(tv){
  const q=TOUR().quali, st=standings(), done=qualiDone();
  const played=q.matches.filter(m=>m.winner).length;
  const row=(r,i)=>`<tr class="${i<q.K?"in":""}${i===q.K-1?" cut":""}"><td>${i+1}</td><td class="nm">${esc(r.name)}</td><td>${r.pl}</td><td>${r.w}</td><td>${r.gw-r.gl>0?"+":""}${r.gw-r.gl}</td><td>${r.toads?r.avg.toFixed(2):"–"}</td></tr>`;
  const rows=st.map(row).join(""), thead=`<thead><tr><th>#</th><th class="nm">Player</th><th title="Matches played">Pl</th><th title="Matches won">W</th><th title="Games won minus lost">+/−</th><th title="Average per toad">Avg</th></tr></thead>`;
  // The TV screen shows the table in two halves side by side
  if(tv){const h=Math.ceil(st.length/2);return `<div class="qhead"><h3>Qualifying</h3><span>${played} of ${q.matches.length} played · top ${q.K} go through</span></div>
    <div class="qsplit"><table class="qtab">${thead}<tbody>${st.slice(0,h).map(row).join("")}</tbody></table><table class="qtab">${thead}<tbody>${st.slice(h).map((r,i)=>row(r,i+h)).join("")}</tbody></table></div>`}
  const open=!S.qualiCollapsed;
  const head=`<button type="button" class="qhead" id="qualiToggle" aria-expanded="${open}"><h3>Qualifying</h3><span>${done?`Complete · top ${q.K} go through`:`${played} of ${q.matches.length} matches played · top ${q.K} go through`}</span><i class="chev" aria-hidden="true"></i></button>`;
  if(!open)return head;
  return `${head}
    <table class="qtab">${thead}<tbody>${rows}</tbody></table>
    <p class="qnote">Ranked by matches won, then games +/−, then average per toad, then head-to-head.</p>`;
}

function bracketHTML(){
  const t=TOUR();
  let h=t.rounds.map((r,ri)=>`<div class="bround"><h3>${roundName(ri)}</h3><div class="bmatches">`+r.map(m=>{
    const live=m.table!=null&&!m.winner;
    const line=(name,w,isB)=>{
      if(isB&&m.bye)return `<div class="bp tbd"><span>bye</span></div>`;
      if(!name)return `<div class="bp tbd"><span>?</span></div>`;
      const cls=m.winner?(m.winner===name?" w":" l"):"";
      return `<div class="bp${cls}"><span>${esc(name)}</span>${m.bye?"":`<span class="s">${w}</span>`}</div>`;
    };
    return `<div class="bm${live?" now":""}">${live?`<span class="tb">${TN(m.table)}</span>`:""}${line(m.a,m.wa,false)}${line(m.b,m.wb,true)}</div>`;
  }).join("")+`</div></div>`).join("");
  if(t.champion)h+=`<div class="bround"><h3>Champion</h3><div class="bmatches"><div class="bm champ"><div class="bp w">${TOAD}<span>${esc(t.champion)}</span></div></div></div></div>`;
  return `<div class="bracket">${h}</div>`;
}

function renderGame(){
  const g=G(), r=g.rem[g.cur], m=M();
  $("turnName").textContent=throwerOf(g,g.cur);
  const c=coinsFor(g.hist.length,r);
  const fin=r<=c*2;
  $("turnNeed").innerHTML=esc(`${g.members?g.gp[g.cur]+" · ":""}Needs ${r} · ${c} toad${c>1?"s":""} (max ${c*2}) · Round ${g.round}`)+(fin?` · <span class="canfin">can finish now</span>`:"");
  $("matchInfo").hidden=!m;
  if(m)$("matchInfo").textContent=`${tname(m.table)} · ${roundName(S.focus.ri)} · Game ${gameNo(m)} · ${m.a} ${m.wa}–${m.wb} ${m.b}`;
  $("quitBtn").textContent=m?"Back to tables":"End game";
  $("pad").innerHTML=Toads.keypad(c,r).map(({n,bust})=>`<button data-s="${n}" class="${bust?"over":n===r?"fin":""}" aria-label="Score ${n}${bust?' (bust)':n===r?' (finishes)':''}">${n}</button>`).join("");
  closeFinish();
  // Undo names the turn it takes back
  const last=g.hist[g.hist.length-1];
  $("undoBtn").disabled=!last;
  $("undoBtn").textContent=last?`Undo ${last.who}'s ${last.bust?"bust":last.s}`:"Undo last turn";
  gameSync();
  // Watching a live table scored on another phone: the board only
  const watch=!scoring();
  $("pad").hidden=watch;$("undoBtn").hidden=watch;
  if(watch){$("msg").textContent=S.live.status==="ended"?"The tournament has ended.":"Watching: the scores come from the phone at the table.";$("msg").className="msg"}
  $("board").innerHTML=columns(false);
  const bw=$("board").parentElement;bw.scrollTop=bw.scrollHeight;
}
// On the game screen of a live table: say when scores are waiting for a signal
function gameSync(){
  const L=S.live, el=$("gameSync");
  const q=L&&scoring()?L.queue.length:0;
  el.textContent=!L||!scoring()?"":q?(L.offline?`No signal: ${q} score${q===1?"":"s"} kept on this phone, sent when it's back.`:"Sending…"):L.offline?"No signal right now. Keep scoring: nothing is lost.":"";
  el.className="hint gamesync"+(L&&L.offline?" bad":"");
  el.hidden=!el.textContent;
}

// Toads hop up once per win (not on every redraw), with an optional croak
let cheered=null;
function celebrate(key){
  if(cheered===key)return;cheered=key;
  $("hops").innerHTML=Array.from({length:9},(_,i)=>TOAD.replace('class="toad"',`class="toad" style="left:${6+i*10.5}%;animation-delay:${(i%3)*.15+i*.04}s"`)).join("");
  if(soundOn())croak();
}
const soundOn=()=>{try{return localStorage.getItem("toads31.sound")==="on"}catch(e){return false}};
// A short two-note croak, made on the phone (no sound file)
function croak(){
  try{
    const A=window.AudioContext||window.webkitAudioContext;if(!A)return;
    const ctx=croak.ctx||(croak.ctx=new A()), t=ctx.currentTime;
    for(const [at,f] of [[0,150],[.22,120]]){
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type="sawtooth";o.frequency.setValueAtTime(f*1.4,t+at);o.frequency.exponentialRampToValueAtTime(f,t+at+.16);
      g.gain.setValueAtTime(.0001,t+at);g.gain.exponentialRampToValueAtTime(.25,t+at+.02);g.gain.exponentialRampToValueAtTime(.0001,t+at+.18);
      o.connect(g).connect(ctx.destination);o.start(t+at);o.stop(t+at+.2);
    }
  }catch(e){}
}
function renderWin(){
  const g=G(), L=S.last||{name:g.gp[g.rem.indexOf(0)]||g.gp[0]}, m=M();
  $("trophy").innerHTML=TOAD;
  $("winName").textContent=L.name;
  celebrate(L.name+"|"+g.hist.length);
  $("results").innerHTML=columns(true,g.gp.indexOf(L.name));
  $("undoWinBtn").hidden=!(S.last&&g.hist.length);
  const A=$("againBtn"), B=$("changeBtn");
  B.hidden=false;
  if(!m&&g.members){
    const [a,b]=g.members[L.name]||[];
    $("winLabel").textContent="Winning team";
    $("winInfo").textContent=`${a} & ${b} hit exactly 31 in round ${g.round}.`;
    A.textContent="Play again";A.onclick=()=>askOrder(S.teams.map(t=>t.name.trim()));
    B.textContent="Change teams";B.onclick=()=>{S.stage="setup";render()};
    return;
  }
  if(!m){
    $("winLabel").textContent="Winner";
    $("winInfo").textContent=`Hit exactly 31 in round ${g.round}.`;
    A.textContent="Play again";A.onclick=()=>askOrder(S.players.slice());
    B.textContent="Change players";B.onclick=()=>{S.stage="setup";render()};
    return;
  }
  const hi=Math.max(m.wa,m.wb), lo=Math.min(m.wa,m.wb);
  if(TOUR().champion){
    $("winLabel").textContent="Tournament champion";
    $("winInfo").textContent=`Won the final ${hi}–${lo}.`;
    A.textContent="See the bracket";A.onclick=goHub;
    B.textContent="New tournament";B.onclick=startTournament;
    if(S.live)B.hidden=true;
  }else if(m.winner&&S.focus.ri<0){
    const q=TOUR().quali, left=q.matches.filter(x=>!x.winner).length;
    $("winLabel").textContent="Qualifying match won";
    $("winInfo").textContent=`Beats ${L.name===m.a?m.b:m.a} ${hi}–${lo}. `+(left?`${left} qualifying match${left===1?"":"es"} still to play. ${tname(m.table)} is free.`:`Qualifying is complete: the top ${q.K} go into the knockout.`);
    A.textContent="Back to tables";A.onclick=goHub;
    B.hidden=true;
  }else if(m.winner){
    $("winLabel").textContent="Match won";
    $("winInfo").textContent=`Beats ${L.name===m.a?m.b:m.a} ${hi}–${lo} and goes through. ${tname(m.table)} is free.`;
    A.textContent="Back to tables";A.onclick=goHub;
    B.hidden=true;
  }else{
    $("winLabel").textContent=`Game ${m.wa+m.wb} won`;
    $("winInfo").textContent=`${m.a} ${m.wa}–${m.wb} ${m.b}. First to 2 games wins the match.`;
    A.textContent=`Start game ${gameNo(m)}`;A.onclick=()=>{S.last=null;nextMatchGame(m)};
    B.textContent="Back to tables";B.onclick=goHub;
  }
}

// Chalk tally: one bar per win, every fifth bar strikes through the four before it
function tally(n){
  if(!n)return"";
  let out="";
  for(let k=0;k<Math.floor(n/5);k++)out+=`<span class="gate">||||</span>`;
  if(n%5)out+=`<span>${"|".repeat(n%5)}</span>`;
  return `<span class="tally" aria-label="${n} win${n>1?"s":""}">${out}</span>`;
}

// 8 or fewer left: one good turn can finish it, so ring the number in chalk
const ringIf=n=>n>0&&n<=8?`<span class="ring" title="Can win this turn">${n}</span>`:n;

// Chalkboard grid: round numbers once on the left, one column per player
function columns(final,winner){
  const g=G(), P=g.gp, idx=P.map((_,i)=>i);
  const on=i=>final?i===winner:i===g.cur;
  const cell=(i,cls,html)=>`<div class="c ${cls}${on(i)?" on":""}">${html}</div>`;
  const byRound=idx.map(i=>{const m={};g.hist.forEach(h=>{if(h.p===i)m[h.round]=h});return m});
  const maxR=g.hist.reduce((a,h)=>Math.max(a,h.round),0);
  const head=i=>{
    let h=esc(P[i])+tally(matchWins(P[i]));
    if(g.members){const nx=throwerOf(g,i);h+=`<div class="mem">${g.members[P[i]].map(m=>`<span class="${!final&&m===nx?"next":""}">${esc(m)}</span>`).join(" · ")}</div>`}
    return h;
  };
  let s=`<div class="k"></div>`+idx.map(i=>cell(i,"n",head(i))).join("");
  s+=`<div class="k"></div>`+idx.map(i=>cell(i,"rem",ringIf(g.rem[i]))).join("");
  s+=`<div class="k"></div>`+idx.map(i=>cell(i,"lbl","left")).join("");
  s+=`<div class="k"></div>`+idx.map(i=>cell(i,"barc",`<div class="bar"><i style="width:${(TARGET-g.rem[i])/TARGET*100}%"></i></div>`)).join("");
  for(let r=1;r<=maxR;r++){
    const f=r===1?" first":"";
    s+=`<div class="k${f}">R${r}</div>`+idx.map(i=>{
      const h=byRound[i][r];
      return cell(i,"cell"+f,h?`<div class="row"><span class="sc"><span class="${h.bust?"bust":""}">${h.s}</span>${TOAD}</span><b>${ringIf(h.bust?h.before:h.before-h.s)}</b></div>`:"&nbsp;");
    }).join("");
  }
  if(final){
    s+=`<div class="k" style="border-top:2px solid rgba(236,236,228,.35);padding-top:6px;line-height:1.1">Avg<br>/toad</div>`+idx.map(i=>{
      const {avg}=Toads.sideStats(g,i);
      return cell(i,"avgc",avg!=null?avg.toFixed(2):"–");
    }).join("");
    // Duo: each partner's own points per toad
    if(g.members){
      s+=`<div class="k" style="line-height:1.1;border-top:2px solid rgba(236,236,228,.35);padding-top:6px;align-self:stretch">Each<br>player</div>`+idx.map(i=>cell(i,"pstats",g.members[P[i]].map(name=>{
        const {pts,toads,avg}=Toads.playerStats(g,name);
        return `<div class="pst"><span>${esc(name)}</span><b>${avg!=null?avg.toFixed(2):"–"}</b><small>${pts} pts · ${toads} toad${toads===1?"":"s"}</small></div>`;
      }).join(""))).join("");
    }
  }
  return `<div class="sheet" style="grid-template-columns:auto repeat(${P.length},minmax(68px,1fr))">${s}</div>`;
}

/* ---------- actions ---------- */
function goHub(){S.last=null;S.focus=null;S.ord=null;S.stage="bracket";render()}
function startTournament(){
  S.tour=buildTour(S.players.slice(),S.tables,S.tourFormat,undefined,qualiPer(S.players.length));settle();goHub();
}
// Before every game: one toad each, closest to the hole throws first
function askOrder(players){
  if(players.length<2){beginGame(players);return}
  S.ord={pending:players,order:[]};S.stage="order";render();
}
function pick(name){
  const o=S.ord;o.order.push(name);
  const left=o.pending.filter(p=>!o.order.includes(p));
  if(left.length===1)o.order.push(left[0]);
  render();
}
function beginGame(order){
  if(S.live){
    const m=M(), r=livePlay({t:"start",ri:S.focus.ri,mi:S.focus.mi,gameId:newId(),order:order.slice(),at:Date.now()});
    if(!r.ok){NET.liveNote=`Can't start the game: ${r.error}.`;goHub();return}
    S.ord=null;S.last=null;S.stage="game";$("msg").textContent="";$("quitConfirm").hidden=true;render();return;
  }
  const g=newG(order);
  if(S.mode==="duo"&&!isTour())g.members=Object.fromEntries(S.teams.map(t=>[t.name.trim(),[t.a,t.b]]));
  // Online, Single and Duo games are saved: they get an id, a start time and the venue
  if(NET.on&&!isTour()){g.id=newId();g.started=Date.now();g.venue=S.venue||null}
  if(isTour())M().game=g;else S.g=g;
  S.ord=null;S.last=null;S.stage="game";
  $("msg").textContent="";$("quitConfirm").hidden=true;render();
}
function openMatch(ri,mi){
  S.focus={ri,mi};const m=M();
  if(m.game&&!m.game.done){S.stage="game";$("msg").textContent="";render()}
  else if(S.live&&(!myTable(m.table)||S.live.status==="ended"))goHub();
  else nextMatchGame(m);
}
// A match's next game: game 2 swaps game 1's throwing order (no picking); game 1 and game 3 ask for it
function nextMatchGame(m){
  const prev=m.game;
  if(gameNo(m)===2&&prev&&prev.done&&prev.gp.length===2){
    const order=prev.gp.slice().reverse();
    beginGame(order);
    if(S.stage==="game"){$("msg").textContent=`Game 2: order swapped, ${order[0]} throws first.`;$("msg").className="msg good"}
    return;
  }
  askOrder([m.a,m.b]);
}

// Finishing can need fewer toads than the player had (e.g. 5 with 4 toads: 3 or 4 used).
// Only then ask how many were thrown, so the per-toad average stays right.
function askFinish(s,choices){
  const g=G();
  $("finishQ").textContent=`${throwerOf(g,g.cur)} finishes on ${s}! How many toads did they throw?`;
  $("finishBtns").innerHTML=choices.map(u=>`<button class="primary" data-u="${u}">${u} toad${u===1?"":"s"}</button>`).join("");
  $("finishBtns").dataset.s=s;
  $("pad").hidden=true;$("finishAsk").hidden=false;
}
function closeFinish(){$("pad").hidden=false;$("finishAsk").hidden=true}

function score(s,used){
  if(S.live)return scoreLive(s,used);
  const g=G(), t=Toads.playTurn(g,s,used);
  if(t.ask){askFinish(s,t.ask);return}
  if(g.id)g.hist[g.hist.length-1].at=Date.now();
  closeFinish();
  const {who,team,before}=t, msg=$("msg");
  if(t.won){finishGame(g.gp[t.p]);return}
  if(t.bust){msg.textContent=team?`Bust! ${who} goes over, ${team} stays on ${before}.`:`Bust! ${who} stays on ${before}.`;msg.className="msg bad"}
  else{msg.textContent=(s?`${who} scores ${s}`:`${who} scores nothing`)+(team?` for ${team}.`:".");msg.className="msg good"}
  render();
}

// A live table: the same messages, but the change goes through Toads.applyOp and the queue
function scoreLive(s,used){
  const g=G(), last=g.hist.length, r=livePlay({t:"turn",ri:S.focus.ri,mi:S.focus.mi,gameId:g.id,expect:last,id:newId(),s,used,at:Date.now()});
  if(r.ask){askFinish(s,r.ask);return}
  closeFinish();
  const msg=$("msg");
  if(!r.ok){msg.textContent=`That score wasn't taken: ${r.error}.`;msg.className="msg bad";return}
  const {who,before,bust}=r.turn;
  if(r.finished){S.last={name:r.finished.winner};S.stage="win";render();return}
  msg.textContent=bust?`Bust! ${who} stays on ${before}.`:s?`${who} scores ${s}.`:`${who} scores nothing.`;
  msg.className="msg "+(bust?"bad":"good");
  render();
}

function finishGame(name){
  const g=G();g.done=true;
  const m=M();
  if(m)Toads.recordGameWin(S.tour,m,g,name);
  else{const k=winKey(g,name);S.wins[k]=(S.wins[k]||0)+1}
  if(g.id&&!m)ToadsApi.enqueue(Toads.gameRecord(g,{id:g.id,mode:g.members?"duo":"single",venue:g.venue,started:g.started,finished:Date.now()}));
  S.last={name};S.stage="win";render();
}

// Take back the throw that won the game, and the win it gave
function undoWin(){
  const L=S.last, g=G();if(!L||!g)return;
  if(S.live){
    const h=g.hist[g.hist.length-1], r=livePlay({t:"undoWin",ri:S.focus.ri,mi:S.focus.mi,gameId:g.id,expect:g.hist.length,id:h.id});
    if(!r.ok){$("winInfo").textContent=`Can't undo: ${r.error}.`;return}
    S.last=null;S.stage="game";$("msg").textContent=`Undid ${g.gp[h.p]}'s turn.`;$("msg").className="msg";render();return;
  }
  const m=M();
  if(m)Toads.undoGameWin(S.tour,m,L.name);
  else if(S.wins[winKey(g,L.name)])S.wins[winKey(g,L.name)]--;
  if(g.id)ToadsApi.unqueue(g.id);
  g.done=false;S.last=null;undo();
}

function undo(){
  if(S.live){
    const g=G(), h=g.hist[g.hist.length-1];if(!h)return;
    const r=livePlay({t:"undo",ri:S.focus.ri,mi:S.focus.mi,gameId:g.id,expect:g.hist.length,id:h.id});
    $("msg").textContent=r.ok?`Undid ${g.gp[h.p]}'s turn.`:`Can't undo: ${r.error}.`;$("msg").className="msg"+(r.ok?"":" bad");
    render();return;
  }
  const g=G(), h=Toads.undoTurn(g);if(!h)return;
  S.stage="game";
  $("msg").textContent=`Undid ${g.gp[h.p]}'s turn.`;$("msg").className="msg";
  render();
}

/* ---------- wiring ---------- */
$("modeSingle").addEventListener("click",()=>{S.mode="single";render()});
$("modeTour").addEventListener("click",()=>{S.mode="tournament";render();if(NET.on)loadLiveList()});
$("fmtQuali").addEventListener("click",()=>{S.tourFormat="quali";render()});
$("fmtByes").addEventListener("click",()=>{S.tourFormat="byes";render()});
$("soundOn").addEventListener("change",()=>{try{localStorage.setItem("toads31.sound",$("soundOn").checked?"on":"off")}catch(e){}if($("soundOn").checked)croak()});
$("perSel").addEventListener("change",()=>{S.qualiPer=+$("perSel").value;save();render()});
$("modeDuo").addEventListener("click",()=>{S.mode="duo";if(!S.teams.length&&S.players.length>=2)addTeam();else render()});
$("addTeamBtn").addEventListener("click",addTeam);
$("teamList").addEventListener("input",e=>{const t=e.target.closest("input.tname");if(t){S.teams[+t.dataset.t].name=t.value;save();setupStart()}});
$("teamList").addEventListener("change",e=>{const sel=e.target.closest("select[data-slot]");if(sel){S.teams[+sel.dataset.t][sel.dataset.slot]=sel.value||null;render()}});
$("teamList").addEventListener("click",e=>{
  const rm=e.target.closest("button[data-rmt]"), sw=e.target.closest("button[data-swap]");
  if(rm){S.teams.splice(+rm.dataset.rmt,1);render()}
  if(sw){const t=S.teams[+sw.dataset.swap];[t.a,t.b]=[t.b,t.a];render()}
});
$("tablesMinus").addEventListener("click",()=>{S.tables=Math.max(1,S.tables-1);render()});
$("tablesPlus").addEventListener("click",()=>{S.tables=Math.min(MAX_TABLES,S.tables+1);render()});
$("addForm").addEventListener("submit",e=>{
  e.preventDefault();let v=$("nameInput").value.trim();
  if(!v)return;
  if(NET.on){const r=findIn(NET.players,v);if(r)v=r.name}
  if(S.players.includes(v)){$("nameInput").select();$("noPlayers").hidden=false;$("noPlayers").textContent=`${v} is already on the list. Use a different name.`;return}
  S.players.push(v);$("nameInput").value="";$("nameInput").focus();render();
});
$("playerList").addEventListener("click",e=>{
  const r=e.target.closest("button[data-reg]");if(r){registerPlayer(S.players[+r.dataset.reg]);return}
  const b=e.target.closest("button[data-i]");if(b){const [nm]=S.players.splice(+b.dataset.i,1);delete S.wins[nm];render()}});
if(NET.on){
  $("regChips").addEventListener("click",e=>{const b=e.target.closest("button[data-add]");if(b&&!S.players.includes(b.dataset.add)){S.players.push(b.dataset.add);$("nameInput").value="";NET.note="";render()}});
  $("nameInput").addEventListener("input",()=>renderOnline());
  $("venueSelect").addEventListener("change",()=>{S.venue=$("venueSelect").value;save()});
  $("menuBtn").addEventListener("click",openMenu);
  $("menuBack").addEventListener("click",closeMenu);
  $("menuPlayers").addEventListener("click",()=>{S.stage="players";render();loadDirectory();window.scrollTo(0,0)});
  $("menuTours").addEventListener("click",openTours);
  $("playersBack").addEventListener("click",()=>{S.stage="menu";render()});
  $("toursBack").addEventListener("click",()=>{S.stage="menu";render()});
  $("toursList").addEventListener("click",e=>{
    const card=e.target.closest("[data-tour]");if(!card)return;
    const id=card.dataset.tour, act=e.target.closest("[data-act]"), yes=e.target.closest("[data-yes]");
    if(e.target.closest("[data-open]")){follow(id);return}
    if(e.target.closest("[data-cancel]")){NET.tourAct=null;render();return}
    const tb=e.target.closest("[data-tbl]");if(tb){tb.disabled=true;tableAction(id,tb.dataset.tbl,+tb.dataset.k);return}
    if(yes){tourAction(id,yes.dataset.yes,yes);return}
    if(act){NET.toursMsg="";if(act.dataset.act==="edit")startEdit(id);else{NET.tourAct={id,kind:act.dataset.act};render()}}
  });
  $("toursList").addEventListener("submit",e=>{const f=e.target.closest("form[data-edit]");if(f){e.preventDefault();saveEdit(f)}});
  $("wipeBtn").addEventListener("click",()=>{$("wipeConfirm").hidden=false;$("wipeInput").value="";render();$("wipeInput").focus()});
  $("wipeInput").addEventListener("input",()=>{$("wipeYes").disabled=$("wipeInput").value.trim()!=="DELETE"});
  $("wipeNo").addEventListener("click",()=>{$("wipeConfirm").hidden=true});
  $("wipeYes").addEventListener("click",async()=>{
    $("wipeYes").disabled=true;$("orgMsg").textContent="Deleting…";$("orgMsg").className="msg";
    const r=await ToadsApi.gamesDelete("/games?confirm=all");
    $("wipeConfirm").hidden=true;$("wipeInput").value="";
    $("orgMsg").textContent=r.deleted!=null?`Deleted ${r.deleted} saved game${r.deleted===1?"":"s"}.`:failMsg(r,"delete the games");
    $("orgMsg").className="msg "+(r.deleted!=null?"good":"bad");NET.statsKey=null;render();
  });
  $("statsBody").addEventListener("click",async e=>{
    if(e.target.closest("#allGamesBtn")){NET.allGames=!NET.allGames;render();return}
    const b=e.target.closest("[data-delgame]");if(!b)return;
    const id=b.dataset.delgame;
    if(NET.armed!=="game:"+id){NET.armed="game:"+id;render();return}
    NET.armed=null;
    const r=await ToadsApi.gamesDelete("/games/"+encodeURIComponent(id));
    NET.statsNote=r.deleted!=null?"Game deleted.":null;
    if(r.deleted!=null)reloadStats();else{$("statsMsg").textContent=failMsg(r,"delete the game");$("statsMsg").className="msg bad"}
  });
  $("deleteGamesBtn").addEventListener("click",()=>{
    const d=NET.stats,p=d&&d.player;if(!p)return;
    confirmStats(`Delete all of ${p.name}'s saved games? They also leave the stats of everyone who played in them. ${p.name} stays on the list. This can't be undone.`,async()=>{
      const r=await ToadsApi.gamesDelete(`/players/${encodeURIComponent(p.id)}/games`);
      if(r.deleted!=null){NET.statsNote=`Deleted ${r.deleted} game${r.deleted===1?"":"s"}.`;reloadStats()}
      else{$("statsMsg").textContent=failMsg(r,"delete the games");$("statsMsg").className="msg bad"}
    });
  });
  $("statsBack").addEventListener("click",()=>{S.stage="players";NET.armed=null;render()});
  $("dirList").addEventListener("click",e=>{const b=e.target.closest("button[data-stats]");if(b)showPlayer(b.dataset.stats)});
  $("statsVenue").addEventListener("change",()=>{S.statsVenue=$("statsVenue").value;reloadStats()});
  $("orgLogin").addEventListener("submit",async e=>{
    e.preventDefault();const pw=$("orgPassword").value;if(!pw)return;
    const r=await ToadsApi.login(pw);
    $("orgMsg").textContent=r.ok?"Logged in.":r.offline?"No signal. Try again in a moment.":r.error==="wrong password"?"Wrong password.":`Can't log in: ${r.error}.`;
    $("orgMsg").className="msg "+(r.ok?"good":"bad");
    if(r.ok)$("orgPassword").value="";
    render();
  });
  $("orgLogout").addEventListener("click",()=>{ToadsApi.logout();$("orgMsg").textContent="Logged out.";$("orgMsg").className="msg";render()});
  $("venueAddForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const name=$("venueAddName").value.replace(/\s+/g," ").trim();if(!name)return;
    const r=await ToadsApi.add("venues",{name});
    if(r.item&&r.created){$("venueAddName").value="";$("orgMsg").textContent=`Added ${r.item.name}.`;$("orgMsg").className="msg good";await loadDirectory()}
    else{$("orgMsg").textContent=r.item?`${r.item.name} is already on the list.`:failMsg(r,"add it");$("orgMsg").className="msg bad";render()}
  });
  $("venueAdmin").addEventListener("click",async e=>{
    const li=e.target.closest("li[data-venue]");if(!li)return;
    const id=li.dataset.venue, v=NET.venues.find(x=>x.id===id);if(!v)return;
    if(e.target.closest("[data-vsave]")){
      const r=await ToadsApi.tidy("PATCH","venues",id,{name:li.querySelector("input").value});
      if(tidyResult(r,`Saved ${r.item&&r.item.name}.`,"orgMsg")){if(S.venue===v.name)S.venue=r.item.name;await loadDirectory()}
    }
    if(e.target.closest("[data-vdel]")){
      if(NET.armed!=="venue:"+id){NET.armed="venue:"+id;render();return}
      NET.armed=null;
      const r=await ToadsApi.tidy("DELETE","venues",id);
      if(tidyResult(r,`Deleted ${v.name}.`,"orgMsg"))await loadDirectory();else render();
    }
  });
  $("renameForm").addEventListener("submit",async e=>{
    e.preventDefault();const d=NET.stats,p=d&&d.player;if(!p)return;
    const r=await ToadsApi.tidy("PATCH","players",p.id,{name:$("renameInput").value});
    if(tidyResult(r,`Renamed to ${r.item&&r.item.name}.`,"statsMsg")){renamePlayer(p.name,r.item.name);NET.renameFor=null;NET.statsNote=`Renamed to ${r.item.name}.`;await loadDirectory();reloadStats()}
  });
  $("mergeBtn").addEventListener("click",()=>{
    const d=NET.stats,p=d&&d.player,into=NET.players.find(x=>x.id===$("mergeInto").value);if(!p||!into)return;
    confirmStats(`Merge ${p.name} into ${into.name}? ${p.name}'s games move to ${into.name} and ${p.name} is removed from the list.`,async()=>{
      const r=await ToadsApi.tidy("POST","players",p.id,{into:into.id},"/merge");
      if(tidyResult(r,"",  "statsMsg")){renamePlayer(p.name,into.name);await loadDirectory();showPlayer(into.id);NET.statsNote=`Merged ${p.name} into ${into.name} (${r.moved} game${r.moved===1?"":"s"} moved).`;render()}
    });
  });
  $("deletePlayerBtn").addEventListener("click",()=>{
    const d=NET.stats,p=d&&d.player;if(!p)return;
    confirmStats(`Delete ${p.name} and their stats? Saved games keep the name, like a guest's. This can't be undone.`,async()=>{
      const r=await ToadsApi.tidy("DELETE","players",p.id);
      if(tidyResult(r,"","statsMsg")){await loadDirectory();S.stage="players";$("orgMsg").textContent=`Deleted ${p.name}.`;$("orgMsg").className="msg good";render()}
    });
  });
  $("liveList").addEventListener("click",e=>{const b=e.target.closest("button[data-follow]");if(b)follow(b.dataset.follow)});
  $("liveOn").addEventListener("change",()=>{S.liveOn=$("liveOn").checked;NET.liveMsg="";render()});
  $("liveLeave").addEventListener("click",leaveLive);
  $("liveShareBtn").addEventListener("click",()=>{NET.shareOpen=!NET.shareOpen;render()});
  $("liveCopy").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("liveLink").value);NET.liveNote="Link copied."}catch(e){$("liveLink").select();NET.liveNote="Select the link and copy it."}render()});
  $("liveEnd").addEventListener("click",()=>{$("liveEndConfirm").hidden=false});
  $("liveEndNo").addEventListener("click",()=>{$("liveEndConfirm").hidden=true});
  $("liveEndYes").addEventListener("click",()=>{$("liveEndConfirm").hidden=true;endLive()});
  $("pinForm").addEventListener("submit",e=>{e.preventDefault();const v=$("pinInput").value.trim(),p=NET.pinFor;if(!v||!p)return;S.live.pin=v;$("pinInput").value="";claimTable(p.k,p.takeover)});
  $("pinCancel").addEventListener("click",()=>{NET.pinFor=null;NET.liveNote="";render()});
  $("tableCards").addEventListener("click",e=>{
    if(!S.live)return;
    const c=e.target.closest("[data-claim]"),t=e.target.closest("[data-takeover]"),r=e.target.closest("[data-release]");
    if(c)claimTable(+c.dataset.claim,false);
    if(t)claimTable(+t.dataset.takeover,true);
    if(r)releaseTable(+r.dataset.release);
  });
  $("statsConfirmNo").addEventListener("click",()=>{$("statsConfirm").hidden=true;NET.onConfirm=null});
  $("statsConfirmYes").addEventListener("click",()=>{$("statsConfirm").hidden=true;const f=NET.onConfirm;NET.onConfirm=null;if(f)f()});
}
$("shuffleBtn").addEventListener("click",()=>{const a=S.players;for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}render()});
$("startBtn").addEventListener("click",()=>S.mode==="tournament"?(liveCreating()?createLive():startTournament()):(S.tour=null,askOrder(S.mode==="duo"?S.teams.map(t=>t.name.trim()):S.players.slice())));
$("pickGrid").addEventListener("click",e=>{const b=e.target.closest("button[data-p]");if(b)pick(b.dataset.p)});
$("orderReset").addEventListener("click",()=>{S.ord.order=[];render()});
$("orderGo").addEventListener("click",()=>beginGame(S.ord.order.slice()));
$("orderBack").addEventListener("click",()=>isTour()?goHub():(S.stage="setup",render()));
$("tableCards").addEventListener("click",e=>{const b=e.target.closest("button[data-ri]");if(b)openMatch(+b.dataset.ri,+b.dataset.mi)});
$("quali").addEventListener("click",e=>{if(e.target.closest("#qualiToggle")){S.qualiCollapsed=!S.qualiCollapsed;render()}});
$("nextToggle").addEventListener("click",()=>{S.nextOpen=!S.nextOpen;render()});
$("tablesToggle").addEventListener("click",()=>{S.tablesCollapsed=!S.tablesCollapsed;render()});
$("endTourBtn").addEventListener("click",()=>{$("endTourConfirm").hidden=false});
$("endTourNo").addEventListener("click",()=>{$("endTourConfirm").hidden=true});
$("endTourYes").addEventListener("click",()=>{S.tour=null;S.stage="setup";render()});
$("champNew").addEventListener("click",startTournament);
$("champChange").addEventListener("click",()=>{if(S.live){leaveLive();return}S.tour=null;S.stage="setup";render()});
$("pad").addEventListener("click",e=>{const b=e.target.closest("button[data-s]");if(b)score(+b.dataset.s)});
$("finishBtns").addEventListener("click",e=>{const b=e.target.closest("button[data-u]");if(b)score(+$("finishBtns").dataset.s,+b.dataset.u)});
$("finishCancel").addEventListener("click",closeFinish);
$("undoBtn").addEventListener("click",()=>{closeFinish();undo()});
$("undoWinBtn").addEventListener("click",undoWin);
// In a tournament, leaving a game keeps it on its table to carry on later
$("quitBtn").addEventListener("click",()=>{if(M())goHub();else $("quitConfirm").hidden=false});
$("quitNo").addEventListener("click",()=>{$("quitConfirm").hidden=true});
$("quitYes").addEventListener("click",()=>{$("quitConfirm").hidden=true;S.stage="setup";render()});

/* ---------- start, upgrading anything saved by older versions ---------- */
load();
if(!S.wins||typeof S.wins!=="object")S.wins={};
if(!S.g&&Array.isArray(S.gp)&&S.gp.length)S.g={gp:S.gp,rem:S.rem,cur:S.cur||0,hist:S.hist||[],round:S.round||1,done:S.stage==="win"};
for(const k of["gp","rem","cur","hist","round","pending","order"])delete S[k];
if(!Array.isArray(S.teams))S.teams=[];
if(!["tournament","duo"].includes(S.mode))S.mode="single";
if(!(S.tables>=1))S.tables=1;
if(S.tour&&S.tour.v!==2)S.tour=null;
if(S.live&&(!NET.on||!S.live.tour||!S.live.mine))S.live=null;
if(S.live&&S.stage==="setup")S.stage="bracket";
if(S.mode==="tournament"||S.live){
  if(!isTour())S.stage="setup";
  else if(["game","win","order"].includes(S.stage)&&!M())S.stage="bracket";
}
if(["game","win"].includes(S.stage)&&!G())S.stage="setup";
if(S.stage==="order"&&!S.ord)S.stage=isTour()?"bracket":"setup";
if(["players","stats","menu","tours"].includes(S.stage)&&(!NET.on||(S.stage==="stats"&&!S.statsId)))S.stage="setup";
if(S.stage==="tours")loadTours();
render();
if(NET.on){
  loadDirectory();
  loadLiveList();
  // A tournament link (#t-<code>) opens that tournament; #tv-<code> turns this page into its TV screen
  const openHash=()=>{
    const tv=/^#tv-([A-Z0-9]{6})$/i.exec(location.hash);
    if(tv){if(!TV||TV.id!==tv[1].toUpperCase())openTV(tv[1].toUpperCase());return}
    if(TV)closeTV();
    const id=liveHash();if(id&&(!S.live||S.live.id!==id))follow(id);
  };
  openHash();window.addEventListener("hashchange",openHash);
  if(S.live&&!liveHash()&&!TV)setHash(S.live.id);
  $("tvSwitch").addEventListener("click",()=>{if(TV){TV.showQuali=!TV.showQuali;render()}});
  $("tvExit").addEventListener("click",()=>{try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}closeTV()});
  document.addEventListener("visibilitychange",()=>{if(TV&&document.visibilityState==="visible"){keepAwake();tvFetch(false)}else gameAwake()});
  setInterval(()=>{if(S.live&&document.visibilityState==="visible"){if(S.live.queue.length)liveFlush();else liveFetch(false)}},LIVE_POLL);
  document.addEventListener("visibilitychange",()=>{if(S.live&&document.visibilityState==="visible")liveFlush()});
  window.addEventListener("online",()=>{if(S.live)liveFlush()});
  window.addEventListener("resize",()=>{if(TV)fitTV()});
  if(S.live)liveFlush();
  window.addEventListener("online",syncGames);
  setInterval(()=>{if(ToadsApi.queued().length)syncGames();else syncNote()},30000);
}
