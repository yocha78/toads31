/* Toads 31 game rules: pure functions, no page or storage access.
   Loaded in the browser as window.Toads, and in Node (tests, later the API) through require(). */
(function(root){
const TARGET=31, TO_WIN=2;

// Toads per turn: the game's 1st turn throws 2, the 2nd throws 3, every later turn 4.
// Near the end a player throws no more toads than the points they have left.
const coinsFor=(turnIdx,left)=>Math.min(turnIdx===0?2:turnIdx===1?3:4,left);
// The keypad offers 0 … 2 × toads; anything above the points left is a bust
const keypad=(toads,left)=>Array.from({length:toads*2+1},(_,n)=>({n,bust:n>left}));
// A finish could have used fewer toads than the player had (e.g. 5 with 4 toads: 3 or 4 used).
// Returns the toad counts to ask about, or [] when the finish is not ambiguous.
function finishChoices(s,toads){
  const min=Math.ceil(s/2);
  if(min>=toads)return[];
  return Array.from({length:toads-min+1},(_,i)=>min+i);
}

const newG=players=>({gp:players,rem:players.map(()=>TARGET),cur:0,hist:[],round:1,done:false});

// Whose throw it is: the player, or in Duo the partner whose go it is (partners alternate each team turn)
function throwerOf(g,i){
  if(!g.members)return g.gp[i];
  const k=g.hist.filter(h=>h.p===i).length;
  return g.members[g.gp[i]][k%2];
}

// Record a turn scoring s. used = toads the player says they threw on an ambiguous finish.
// Returns {ask:[…]} without recording anything when that question must be asked first.
function playTurn(g,s,used){
  const p=g.cur, before=g.rem[p], bust=s>before, c=coinsFor(g.hist.length,before);
  if(!bust&&s===before&&used==null){const ask=finishChoices(s,c);if(ask.length)return {ask,toads:c}}
  const who=throwerOf(g,p), team=g.members?g.gp[p]:null;
  g.hist.push({p,s,before,bust,round:g.round,c:used||c,who});
  if(!bust){
    g.rem[p]=before-s;
    if(g.rem[p]===0)return {p,s,before,bust,who,team,won:true};
  }
  g.cur=(p+1)%g.gp.length;
  if(g.cur===0)g.round++;
  return {p,s,before,bust,who,team,won:false};
}
// Take back the last turn; returns it, or undefined when there is none
function undoTurn(g){
  const h=g.hist.pop();if(!h)return;
  g.rem[h.p]=h.before;g.cur=h.p;g.round=h.round;
  return h;
}

// Points per toad thrown (0–2). Busts count the points actually thrown.
// Team column: turns saved before toads were tracked count as 4 toads (or the points left, if fewer).
function sideStats(g,i){
  const t=g.hist.filter(h=>h.p===i);
  const pts=t.reduce((a,h)=>a+h.s,0), toads=t.reduce((a,h)=>a+(h.c||Math.min(4,h.before)),0);
  return {pts,toads,avg:toads?pts/toads:null};
}
// Duo: one partner's own points per toad
function playerStats(g,name){
  const t=g.hist.filter(h=>h.who===name), pts=t.reduce((a,h)=>a+h.s,0), toads=t.reduce((a,h)=>a+h.c,0);
  return {pts,toads,avg:toads?pts/toads:null};
}

/* ---------- tournament ---------- */
const mk=(a,b,bye)=>({a,b,wa:0,wb:0,winner:bye?a:null,bye:!!bye,table:null,game:null});
// Largest knockout size (2, 4, 8, 16, 32…) that fits the number of players
const knockSize=n=>{let k=1;while(k*2<=n)k*=2;return k};
// Standard seeding: 1 v K, 2 v K-1… placed so seeds 1 and 2 can only meet in the final
function seedOrder(K){let a=[1];while(a.length<K){const m=a.length*2+1;a=a.flatMap(x=>[x,m-x])}return a}

// With 2, 4, 8, 16… players: straight knockout, pairing the list in order (1 v 2, 3 v 4…).
// Otherwise, format "byes": the bracket is rounded up to the next 2/4/8/16… and the spare slots are
// round-1 byes given to players picked at random. Byes only ever happen in round 1, spread across the
// bracket (seed positions) so bye players meet round-1 winners where possible.
// Otherwise, format "quali" (default): a qualifying round first. Players sit in a circle in draw order and each plays
// the two either side, so everyone plays exactly 2 matches. The top K go into a seeded knockout.
// Each later match takes the winners of two matches above it, so the whole bracket exists from the start.
// rand is Math.random unless a test passes its own.
function buildTour(names,tables,format,rand=Math.random){
  const n=names.length, K=knockSize(n), byes=K<n&&format==="byes", quali=K<n&&!byes;
  const r0=[];
  if(quali)for(let j=0;j<K/2;j++)r0.push(mk(null,null));
  else if(byes){
    const K2=K*2, b=K2-n, slots=K2/2, seeds=seedOrder(K2);
    const byeSlots=new Set(Array.from({length:b},(_,s)=>Math.floor(seeds.indexOf(s+1)/2)));
    const pool=names.slice();for(let i=pool.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
    const lucky=new Set(pool.slice(0,b));
    const byeP=names.filter(p=>lucky.has(p)), rest=names.filter(p=>!lucky.has(p));
    for(let j=0;j<slots;j++)r0.push(byeSlots.has(j)?mk(byeP.shift(),null,true):mk(rest.shift(),rest.shift()));
  }
  else for(let i=0;i<n;i+=2)r0.push(i+1<n?mk(names[i],names[i+1]):mk(names[i],null,true));
  const rounds=[r0];
  while(rounds[rounds.length-1].length>1){
    const prev=rounds[rounds.length-1];
    rounds.push(Array.from({length:Math.ceil(prev.length/2)},(_,j)=>mk(null,null,2*j+1>=prev.length)));
  }
  let q=null;
  if(quali){
    // circle edges, every other one first so several tables can play at once
    const edges=names.map((p,i)=>[p,names[(i+1)%n],i]);
    const ordered=[...edges.filter(e=>e[2]%2===0),...edges.filter(e=>e[2]%2===1)];
    q={matches:ordered.map(([a,b])=>({...mk(a,b),games:[]})),K,draw:names.slice()};
  }
  return {v:2,n,tables:Math.max(1,Math.min(tables,Math.floor(n/2))),rounds,champion:null,quali:q,format:byes?"byes":quali?"quali":"knockout"};
}

// Qualifying table, best first: matches won, then games won minus lost, then average per toad,
// then the result between the two if they played each other, then draw order.
function standings(tour){
  const q=tour.quali;if(!q)return[];
  const row=Object.fromEntries(q.draw.map((p,i)=>[p,{name:p,idx:i,pl:0,w:0,gw:0,gl:0,pts:0,toads:0}]));
  for(const m of q.matches){
    for(const g of m.games||[])for(const [p,v] of Object.entries(g)){if(row[p]){row[p].pts+=v.pts;row[p].toads+=v.toads}}
    if(!m.winner)continue;
    const A=row[m.a],B=row[m.b];
    A.pl++;B.pl++;A.gw+=m.wa;A.gl+=m.wb;B.gw+=m.wb;B.gl+=m.wa;
    row[m.winner].w++;
  }
  const avg=r=>r.toads?r.pts/r.toads:0;
  const h2h=(x,y)=>{const m=q.matches.find(m=>m.winner&&((m.a===x.name&&m.b===y.name)||(m.a===y.name&&m.b===x.name)));return m?(m.winner===x.name?-1:1):0};
  return Object.values(row).sort((x,y)=>y.w-x.w||(y.gw-y.gl)-(x.gw-x.gl)||avg(y)-avg(x)||h2h(x,y)||x.idx-y.idx)
    .map(r=>({...r,avg:avg(r)}));
}
const qualiDone=tour=>{const q=tour.quali;return !q||q.matches.every(m=>m.winner)};

// Fill the knockout with qualifiers (once qualifying is complete) and with winners as they come in
function settle(tour){
  const R=tour.rounds, q=tour.quali;
  if(q){
    const done=qualiDone(tour), st=done?standings(tour):null, seeds=seedOrder(q.K);
    R[0].forEach((m,j)=>{m.a=done?st[seeds[2*j]-1].name:null;m.b=done?st[seeds[2*j+1]-1].name:null});
  }
  for(let r=1;r<R.length;r++)R[r].forEach((m,j)=>{
    m.a=R[r-1][2*j].winner||null;
    if(m.bye){m.b=null;m.winner=m.a}else m.b=R[r-1][2*j+1].winner||null;
  });
  tour.champion=R[R.length-1][0].winner||null;
}
// ri -1 = qualifying round, 0.. = knockout rounds
const allMatches=tour=>[...(tour.quali?tour.quali.matches.map((m,mi)=>({m,ri:-1,mi})):[]),...tour.rounds.flatMap((r,ri)=>r.map((m,mi)=>({m,ri,mi})))];
const ready=m=>m.a&&m.b&&!m.winner;
// Give free tables to matches whose two players are known, earliest round first.
// A player can only be at one table at a time (matters in the qualifying round).
function assignTables(tour){
  const used=new Set(), busy=new Set();
  allMatches(tour).forEach(({m})=>{if(m.table!=null&&!m.winner){used.add(m.table);busy.add(m.a);busy.add(m.b)}});
  for(const {m} of allMatches(tour)){
    if(!ready(m)||m.table!=null)continue;
    if(busy.has(m.a)||busy.has(m.b))continue;
    let k=0;while(k<tour.tables&&used.has(k))k++;
    if(k>=tour.tables)break;
    m.table=k;used.add(k);busy.add(m.a);busy.add(m.b);
  }
}
function roundName(tour,ri){
  if(ri<0)return "Qualifying";
  const fromEnd=tour.rounds.length-1-ri;
  return fromEnd===0?"Final":fromEnd===1?"Semi-finals":fromEnd===2?"Quarter-finals":`Round ${ri+1}`;
}
const gameNo=m=>m.wa+m.wb+1;

// A match game has been won by name: keep each player's points and toads (for the qualifying table),
// add the game to the match score, decide the match at TO_WIN, and move winners on.
function recordGameWin(tour,m,g,name){
  if(m.games){const per={};for(const h of g.hist){const k=h.who||g.gp[h.p];per[k]=per[k]||{pts:0,toads:0};per[k].pts+=h.s;per[k].toads+=h.c||0}m.games.push(per)}
  if(name===m.a)m.wa++;else m.wb++;
  if(m.wa>=TO_WIN)m.winner=m.a;else if(m.wb>=TO_WIN)m.winner=m.b;
  settle(tour);
}
function undoGameWin(tour,m,name){
  m.winner=null;if(name===m.a)m.wa--;else m.wb--;if(m.games)m.games.pop();settle(tour);
}

/* ---------- saving (Phase 2) ---------- */
// A finished Single or Duo game as the API's POST /games takes it. info: {id, mode, venue, started, finished}
function gameRecord(g,info){
  return {id:info.id,mode:info.mode,venue:info.venue||null,started:info.started||null,finished:info.finished||null,
    sides:g.gp.slice(),members:g.members?JSON.parse(JSON.stringify(g.members)):null,
    turns:g.hist.map(h=>({p:h.p,who:h.who||g.gp[h.p],s:h.s,c:h.c,bust:!!h.bust,before:h.before,round:h.round,at:h.at||null}))};
}

const Toads={TARGET,TO_WIN,coinsFor,keypad,finishChoices,newG,throwerOf,playTurn,undoTurn,sideStats,playerStats,
  mk,knockSize,seedOrder,buildTour,standings,qualiDone,settle,allMatches,ready,assignTables,roundName,gameNo,recordGameWin,undoGameWin,gameRecord};
if(typeof module!=="undefined"&&module.exports)module.exports=Toads;else root.Toads=Toads;
})(this);
