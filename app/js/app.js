const KEY="toads31", MAX_TABLES=8;
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

const isTour=()=>S.mode==="tournament"&&!!S.tour;
// ri -1 = qualifying round, 0.. = knockout rounds
const matchAt=(ri,mi)=>ri<0?(S.tour.quali||{matches:[]}).matches[mi]||null:(S.tour.rounds[ri]||[])[mi]||null;
const M=()=>isTour()&&S.focus?matchAt(S.focus.ri,S.focus.mi):null;
const G=()=>isTour()?(M()||{}).game||null:S.g;

/* ---------- tournament (the current one, S.tour) ---------- */
const knockSize=Toads.knockSize;
const standings=()=>Toads.standings(S.tour);
const qualiDone=()=>Toads.qualiDone(S.tour);
const settle=()=>Toads.settle(S.tour);
const all=()=>Toads.allMatches(S.tour);
const assignTables=()=>Toads.assignTables(S.tour);
const roundName=ri=>Toads.roundName(S.tour,ri);
// Team wins are kept apart from player wins, in case a team shares a player's name
const winKey=(g,name)=>g&&g.members?"team:"+name:name;
function matchWins(name){
  if(!isTour())return S.wins[winKey(G(),name)]||0;
  const m=M();if(!m)return 0;
  return name===m.a?m.wa:name===m.b?m.wb:0;
}

/* ---------- rendering ---------- */
function render(){
  for(const id of["setup","orderView","bracketView","game","win"])$(id).hidden=true;
  const views={setup:["setup",renderSetup],order:["orderView",renderOrder],bracket:["bracketView",renderHub],game:["game",renderGame],win:["win",renderWin]};
  const v=views[S.stage];
  if(!v){S.stage="setup";return render()}
  $(v[0]).hidden=false;v[1]();
  save();
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
  $("tablesVal").textContent=S.tables;
  $("tablesMinus").disabled=S.tables<=1;
  $("tablesPlus").disabled=S.tables>=MAX_TABLES;
  $("playerList").innerHTML=S.players.map((p,i)=>`<li><span class="num">${i+1}</span><span class="pname">${esc(p)}</span><button class="x" data-i="${i}" aria-label="Remove ${esc(p)}">Remove</button></li>`).join("");
  $("noPlayers").hidden=n>0;
  $("noPlayers").textContent=T?"Add at least two players.":D?"Add players, then put them into teams of two below.":"Add one or more players.";
  $("shuffleBtn").hidden=!(T&&n>2);
  setupStart();
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
  return `${base} With ${n} players there's a qualifying round first: everyone plays 2 matches against the players either side of them in the list, then the top ${K} go into a seeded knockout.`;
}
function setupStart(){
  const T=S.mode==="tournament", D=S.mode==="duo", n=S.players.length;
  $("startBtn").disabled=T?n<2:D?!!teamProblem():n===0;
  $("startBtn").textContent=T?"Start tournament":D?"Start duo game":n===1?"Start solo game":"Start game";
  if(D)$("teamHint").textContent=teamProblem()||"Ready. The partner chosen as 1st throws on the team's first turn.";
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
  $("orderTitle").textContent=m?`Throwing order · Table ${m.table+1} · Game ${gameNo(m)}`:"Throwing order";
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
  const t=S.tour;
  $("endTourConfirm").hidden=true;
  $("champPanel").hidden=!t.champion;
  $("tablesPanel").hidden=!!t.champion;
  if(t.champion){$("champToad").innerHTML=TOAD;$("champName").textContent=t.champion}
  const list=all();
  let cards="";
  for(let k=0;k<t.tables;k++){
    const x=list.find(({m})=>m.table===k&&!m.winner);
    if(!x){
      const more=list.some(({m})=>!m.winner&&!m.bye);
      cards+=`<div class="tcard free"><div class="tn"><span>Table ${k+1}</span><span class="pill idle">Free</span></div><div class="ti">${more?"Waiting for earlier matches to finish.":"No more matches."}</div></div>`;
      continue;
    }
    const {m,ri,mi}=x, g=m.game&&!m.game.done?m.game:null;
    cards+=`<div class="tcard"><div class="tn"><span>Table ${k+1}</span><span class="pill${g?"":" idle"}">${g?"Playing":"Ready"}</span></div>
      <div class="tw">${esc(m.a)} v ${esc(m.b)}</div>
      <div class="ti">${roundName(ri)} · Game ${gameNo(m)}${gameNo(m)>1?` · ${m.wa}–${m.wb}`:""}</div>
      ${g?`<div class="live">${g.gp.map((p,i)=>`${esc(p)} ${g.rem[i]}`).join(" · ")} left</div>`:""}
      <button class="${g?"":"primary"}" data-ri="${ri}" data-mi="${mi}">${g?"Continue":`Start game ${gameNo(m)}`}</button></div>`;
  }
  $("tableCards").innerHTML=cards;
  // Collapsible: when closed, a one-line summary stands in for the cards
  const busy=list.filter(({m})=>m.table!=null&&!m.winner), playing=busy.filter(({m})=>m.game&&!m.game.done).length;
  const parts=[];
  if(playing)parts.push(`${playing} playing`);
  if(busy.length-playing)parts.push(`${busy.length-playing} ready`);
  if(t.tables-busy.length)parts.push(`${t.tables-busy.length} free`);
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
function qualiHTML(){
  const q=S.tour.quali, st=standings(), done=qualiDone();
  const played=q.matches.filter(m=>m.winner).length;
  const rows=st.map((r,i)=>`<tr class="${i<q.K?"in":""}${i===q.K-1?" cut":""}"><td>${i+1}</td><td class="nm">${esc(r.name)}</td><td>${r.pl}</td><td>${r.w}</td><td>${r.gw-r.gl>0?"+":""}${r.gw-r.gl}</td><td>${r.toads?r.avg.toFixed(2):"–"}</td></tr>`).join("");
  const open=!S.qualiCollapsed;
  const head=`<button type="button" class="qhead" id="qualiToggle" aria-expanded="${open}"><h3>Qualifying</h3><span>${done?`Complete · top ${q.K} go through`:`${played} of ${q.matches.length} matches played · top ${q.K} go through`}</span><i class="chev" aria-hidden="true"></i></button>`;
  if(!open)return head;
  return `${head}
    <table class="qtab"><thead><tr><th>#</th><th class="nm">Player</th><th title="Matches played">Pl</th><th title="Matches won">W</th><th title="Games won minus lost">+/−</th><th title="Average per toad">Avg</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="qnote">Ranked by matches won, then games +/−, then average per toad, then head-to-head.</p>`;
}

function bracketHTML(){
  const t=S.tour;
  let h=t.rounds.map((r,ri)=>`<div class="bround"><h3>${roundName(ri)}</h3><div class="bmatches">`+r.map(m=>{
    const live=m.table!=null&&!m.winner;
    const line=(name,w,isB)=>{
      if(isB&&m.bye)return `<div class="bp tbd"><span>bye</span></div>`;
      if(!name)return `<div class="bp tbd"><span>?</span></div>`;
      const cls=m.winner?(m.winner===name?" w":" l"):"";
      return `<div class="bp${cls}"><span>${esc(name)}</span>${m.bye?"":`<span class="s">${w}</span>`}</div>`;
    };
    return `<div class="bm${live?" now":""}">${live?`<span class="tb">Table ${m.table+1}</span>`:""}${line(m.a,m.wa,false)}${line(m.b,m.wb,true)}</div>`;
  }).join("")+`</div></div>`).join("");
  if(t.champion)h+=`<div class="bround"><h3>Champion</h3><div class="bmatches"><div class="bm champ"><div class="bp w">${TOAD}<span>${esc(t.champion)}</span></div></div></div></div>`;
  return `<div class="bracket">${h}</div>`;
}

function renderGame(){
  const g=G(), r=g.rem[g.cur], m=M();
  $("turnName").textContent=throwerOf(g,g.cur);
  const c=coinsFor(g.hist.length,r);
  $("turnNeed").textContent=`${g.members?g.gp[g.cur]+" · ":""}Needs ${r} · ${c} toad${c>1?"s":""} (max ${c*2}) · Round ${g.round}`;
  $("matchInfo").hidden=!m;
  if(m)$("matchInfo").textContent=`Table ${m.table+1} · ${roundName(S.focus.ri)} · Game ${gameNo(m)} · ${m.a} ${m.wa}–${m.wb} ${m.b}`;
  $("quitBtn").textContent=m?"Back to tables":"End game";
  $("pad").innerHTML=Toads.keypad(c,r).map(({n,bust})=>`<button data-s="${n}" class="${bust?"over":""}" aria-label="Score ${n}${bust?' (bust)':''}">${n}</button>`).join("");
  closeFinish();
  $("undoBtn").disabled=g.hist.length===0;
  $("board").innerHTML=columns(false);
}

function renderWin(){
  const g=G(), L=S.last||{name:g.gp[g.rem.indexOf(0)]||g.gp[0]}, m=M();
  $("trophy").innerHTML=TOAD;
  $("winName").textContent=L.name;
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
  if(S.tour.champion){
    $("winLabel").textContent="Tournament champion";
    $("winInfo").textContent=`Won the final ${hi}–${lo}.`;
    A.textContent="See the bracket";A.onclick=goHub;
    B.textContent="New tournament";B.onclick=startTournament;
  }else if(m.winner&&S.focus.ri<0){
    const q=S.tour.quali, left=q.matches.filter(x=>!x.winner).length;
    $("winLabel").textContent="Qualifying match won";
    $("winInfo").textContent=`Beats ${L.name===m.a?m.b:m.a} ${hi}–${lo}. `+(left?`${left} qualifying match${left===1?"":"es"} still to play. Table ${m.table+1} is free.`:`Qualifying is complete: the top ${q.K} go into the knockout.`);
    A.textContent="Back to tables";A.onclick=goHub;
    B.hidden=true;
  }else if(m.winner){
    $("winLabel").textContent="Match won";
    $("winInfo").textContent=`Beats ${L.name===m.a?m.b:m.a} ${hi}–${lo} and goes through. Table ${m.table+1} is free.`;
    A.textContent="Back to tables";A.onclick=goHub;
    B.hidden=true;
  }else{
    $("winLabel").textContent=`Game ${m.wa+m.wb} won`;
    $("winInfo").textContent=`${m.a} ${m.wa}–${m.wb} ${m.b}. First to 2 games wins the match.`;
    A.textContent=`Start game ${gameNo(m)}`;A.onclick=()=>{S.last=null;askOrder([m.a,m.b])};
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
  S.tour=buildTour(S.players.slice(),S.tables,S.tourFormat);settle();goHub();
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
  const g=newG(order);
  if(S.mode==="duo"&&!isTour())g.members=Object.fromEntries(S.teams.map(t=>[t.name.trim(),[t.a,t.b]]));
  if(isTour())M().game=g;else S.g=g;
  S.ord=null;S.last=null;S.stage="game";
  $("msg").textContent="";$("quitConfirm").hidden=true;render();
}
function openMatch(ri,mi){
  S.focus={ri,mi};const m=M();
  if(m.game&&!m.game.done){S.stage="game";$("msg").textContent="";render()}
  else askOrder([m.a,m.b]);
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
  const g=G(), t=Toads.playTurn(g,s,used);
  if(t.ask){askFinish(s,t.ask);return}
  closeFinish();
  const {who,team,before}=t, msg=$("msg");
  if(t.won){finishGame(g.gp[t.p]);return}
  if(t.bust){msg.textContent=team?`Bust! ${who} goes over, ${team} stays on ${before}.`:`Bust! ${who} stays on ${before}.`;msg.className="msg bad"}
  else{msg.textContent=(s?`${who} scores ${s}`:`${who} scores nothing`)+(team?` for ${team}.`:".");msg.className="msg good"}
  render();
}

function finishGame(name){
  const g=G();g.done=true;
  const m=M();
  if(m)Toads.recordGameWin(S.tour,m,g,name);
  else{const k=winKey(g,name);S.wins[k]=(S.wins[k]||0)+1}
  S.last={name};S.stage="win";render();
}

// Take back the throw that won the game, and the win it gave
function undoWin(){
  const L=S.last, g=G();if(!L||!g)return;
  const m=M();
  if(m)Toads.undoGameWin(S.tour,m,L.name);
  else if(S.wins[winKey(g,L.name)])S.wins[winKey(g,L.name)]--;
  g.done=false;S.last=null;undo();
}

function undo(){
  const g=G(), h=Toads.undoTurn(g);if(!h)return;
  S.stage="game";
  $("msg").textContent=`Undid ${g.gp[h.p]}'s turn.`;$("msg").className="msg";
  render();
}

/* ---------- wiring ---------- */
$("modeSingle").addEventListener("click",()=>{S.mode="single";render()});
$("modeTour").addEventListener("click",()=>{S.mode="tournament";render()});
$("fmtQuali").addEventListener("click",()=>{S.tourFormat="quali";render()});
$("fmtByes").addEventListener("click",()=>{S.tourFormat="byes";render()});
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
  e.preventDefault();const v=$("nameInput").value.trim();
  if(!v)return;
  if(S.players.includes(v)){$("nameInput").select();$("noPlayers").hidden=false;$("noPlayers").textContent=`${v} is already on the list. Use a different name.`;return}
  S.players.push(v);$("nameInput").value="";$("nameInput").focus();render();
});
$("playerList").addEventListener("click",e=>{const b=e.target.closest("button[data-i]");if(b){const [nm]=S.players.splice(+b.dataset.i,1);delete S.wins[nm];render()}});
$("shuffleBtn").addEventListener("click",()=>{const a=S.players;for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}render()});
$("startBtn").addEventListener("click",()=>S.mode==="tournament"?startTournament():(S.tour=null,askOrder(S.mode==="duo"?S.teams.map(t=>t.name.trim()):S.players.slice())));
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
$("champChange").addEventListener("click",()=>{S.tour=null;S.stage="setup";render()});
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
if(S.mode==="tournament"){
  if(!S.tour)S.stage="setup";
  else if(["game","win","order"].includes(S.stage)&&!M())S.stage="bracket";
}
if(["game","win"].includes(S.stage)&&!G())S.stage="setup";
if(S.stage==="order"&&!S.ord)S.stage=isTour()?"bracket":"setup";
render();
