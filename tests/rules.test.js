// Rule tests from REQUIREMENTS.md section 6. Run with: npm test
const test=require("node:test");
const assert=require("node:assert/strict");
const T=require("../app/js/rules.js");

// Play a list of turns; each entry is a score, or [score, toadsUsed] for an ambiguous finish
function play(g,turns){let r;for(const t of turns)r=Array.isArray(t)?T.playTurn(g,t[0],t[1]):T.playTurn(g,t);return r}
const names=n=>Array.from({length:n},(_,i)=>"P"+(i+1));
// Win a match game for name: a stub game history is enough for the rules
const winGame=(tour,m,name)=>T.recordGameWin(tour,m,{gp:[m.a,m.b],hist:[]},name);
const winMatch=(tour,m,name)=>{winGame(tour,m,name);winGame(tour,m,name)};

test("toads per turn: 2, then 3, then 4, capped by points left",()=>{
  assert.equal(T.coinsFor(0,31),2);
  assert.equal(T.coinsFor(1,31),3);
  assert.equal(T.coinsFor(2,31),4);
  assert.equal(T.coinsFor(9,31),4);
  assert.equal(T.coinsFor(5,3),3);
  assert.equal(T.coinsFor(5,1),1);
  assert.equal(T.coinsFor(0,1),1);
});

test("third player's first turn is already 4 toads",()=>{
  const g=T.newG(["A","B","C"]);
  play(g,[0,0]);
  assert.equal(T.coinsFor(g.hist.length,g.rem[g.cur]),4);
  assert.equal(g.cur,2);
});

test("keypad shows 0 to 2 × toads, with busts marked",()=>{
  assert.deepEqual(T.keypad(2,31).map(k=>k.n),[0,1,2,3,4]);
  assert.equal(T.keypad(4,31).length,9);
  assert.deepEqual(T.keypad(3,3).filter(k=>k.bust).map(k=>k.n),[4,5,6]);
  assert.deepEqual(T.keypad(1,1).map(k=>k.n),[0,1,2]);
});

test("bust leaves the score alone and passes play on",()=>{
  const g=T.newG(["A","B"]);
  g.rem=[5,20];g.hist=[{},{}];
  const r=T.playTurn(g,6);
  assert.equal(r.bust,true);
  assert.equal(g.rem[0],5);
  assert.equal(g.cur,1);
  assert.equal(g.hist.at(-1).bust,true);
});

test("rounds advance when play returns to the first player",()=>{
  const g=T.newG(["A","B"]);
  play(g,[2,2]);
  assert.equal(g.round,2);
  assert.equal(g.cur,0);
});

test("ambiguous finish asks how many toads, from ceil(n/2) to toads available",()=>{
  assert.deepEqual(T.finishChoices(5,4),[3,4]);
  assert.deepEqual(T.finishChoices(1,1),[]);
  assert.deepEqual(T.finishChoices(8,4),[]);
  assert.deepEqual(T.finishChoices(3,3),[2,3]);
  assert.deepEqual(T.finishChoices(2,2),[1,2]);
});

test("ambiguous finish records nothing until answered, then uses the answer",()=>{
  const g=T.newG(["A","B"]);
  g.rem=[5,20];g.hist=[{},{}];
  const ask=T.playTurn(g,5);
  assert.deepEqual(ask,{ask:[3,4],toads:4});
  assert.equal(g.hist.length,2);
  assert.equal(g.rem[0],5);
  const r=T.playTurn(g,5,3);
  assert.equal(r.won,true);
  assert.equal(g.rem[0],0);
  assert.equal(g.hist.at(-1).c,3);
});

test("needing 1 with 1 toad finishes straight away",()=>{
  const g=T.newG(["A","B"]);
  g.rem=[1,20];g.hist=[{},{}];
  assert.equal(T.playTurn(g,1).won,true);
});

test("average per toad counts bust points and the toads the player said they threw",()=>{
  const g=T.newG(["A","B"]);
  // A: 4 (2 toads), B: 0 (3 toads), A: 8 (4), B: 1 (4), A: 8 (4), …
  play(g,[4,0,8,1,8,1,8,1]);
  assert.equal(g.rem[0],3);
  play(g,[6]);            // A busts on 3: 3 toads, 6 points thrown
  play(g,[0]);            // B
  assert.equal(play(g,[[3,2]]).won,true);  // A finishes on 3 with 2 of 3 toads
  const s=T.sideStats(g,0);
  assert.equal(s.pts,4+8+8+8+6+3);
  assert.equal(s.toads,2+4+4+4+3+2);
  assert.equal(s.avg.toFixed(2),"1.95");
});

test("duo partners alternate on each team turn, with their own stats",()=>{
  const g=T.newG(["Reds","Blues"]);
  g.members={Reds:["Al","Bo"],Blues:["Cy","Di"]};
  assert.equal(T.throwerOf(g,0),"Al");
  play(g,[2]);
  assert.equal(T.throwerOf(g,1),"Cy");
  play(g,[3]);
  assert.equal(T.throwerOf(g,0),"Bo");
  const r=T.playTurn(g,4);
  assert.equal(r.who,"Bo");
  assert.equal(r.team,"Reds");
  play(g,[1]);
  assert.equal(T.throwerOf(g,0),"Al");
  assert.deepEqual(T.playerStats(g,"Al"),{pts:2,toads:2,avg:1});
  assert.deepEqual(T.playerStats(g,"Bo"),{pts:4,toads:4,avg:1});
  assert.equal(T.sideStats(g,0).pts,6);
});

test("undo restores score, thrower and round; undo on an empty game does nothing",()=>{
  const g=T.newG(["A","B"]);
  assert.equal(T.undoTurn(g),undefined);
  play(g,[3,4]);
  assert.equal(g.round,2);
  T.undoTurn(g);
  assert.deepEqual([g.rem[1],g.cur,g.round,g.hist.length],[31,1,1,1]);
  T.undoTurn(g);
  assert.deepEqual([g.rem[0],g.cur,g.round,g.hist.length],[31,0,1,0]);
});

test("undo of the winning throw reopens the game",()=>{
  const g=T.newG(["A","B"]);
  g.rem=[8,20];g.hist=[{},{},{},{}];
  assert.equal(T.playTurn(g,8).won,true);
  T.undoTurn(g);
  assert.equal(g.rem[0],8);
  assert.equal(g.cur,0);
});

test("knockout sizes and seeding",()=>{
  assert.deepEqual([2,3,4,5,7,8,9,15,16,17].map(T.knockSize),[2,2,4,4,4,8,8,8,16,16]);
  assert.deepEqual(T.seedOrder(4),[1,4,2,3]);
  assert.deepEqual(T.seedOrder(8),[1,8,4,5,2,7,3,6]);
});

test("power-of-two players: straight knockout in list order",()=>{
  const t=T.buildTour(names(4),2,"quali");
  assert.equal(t.format,"knockout");
  assert.equal(t.quali,null);
  assert.deepEqual(t.rounds[0].map(m=>[m.a,m.b]),[["P1","P2"],["P3","P4"]]);
  assert.equal(t.rounds.length,2);
});

test("byes format, 2 to 8 players: byes only in round 1 and each player appears once",()=>{
  for(let n=2;n<=8;n++){
    let seed=n;const rand=()=>(seed=(seed*9301+49297)%233280)/233280;
    const t=T.buildTour(names(n),1,"byes",rand);
    const K=T.knockSize(n), bracket=K===n?n:K*2;
    const r0=t.rounds[0];
    assert.equal(r0.length,bracket/2,`n=${n}`);
    const placed=r0.flatMap(m=>[m.a,m.b]).filter(Boolean).sort();
    assert.deepEqual(placed,names(n).sort(),`n=${n}`);
    assert.equal(r0.filter(m=>m.bye).length,bracket-n,`n=${n}`);
    for(const r of t.rounds.slice(1))assert.equal(r.filter(m=>m.bye).length,0,`n=${n} later byes`);
  }
});

test("qualifying round: everyone plays 2 matches, top K are seeded into the knockout",()=>{
  for(const n of [3,5,6,7]){
    const t=T.buildTour(names(n),2,"quali");
    assert.equal(t.format,"quali");
    const K=T.knockSize(n);
    assert.equal(t.quali.K,K);
    const count={};for(const m of t.quali.matches)for(const p of [m.a,m.b])count[p]=(count[p]||0)+1;
    assert.ok(Object.values(count).every(c=>c===2),`n=${n}`);
    assert.equal(t.rounds[0].length,K/2);
  }
  const t=T.buildTour(names(5),2,"quali");
  T.settle(t);
  assert.equal(t.rounds[0][0].a,null);
  // P1 wins both matches, P2 one, …: standings decide the seeds
  for(const m of t.quali.matches){
    const win=[m.a,m.b].sort()[0];
    winMatch(t,m,win);
  }
  assert.equal(T.qualiDone(t),true);
  const st=T.standings(t);
  assert.equal(st[0].name,"P1");
  assert.equal(st[0].w,2);
  assert.deepEqual(t.rounds[0].map(m=>[m.a,m.b]),[[st[0].name,st[3].name],[st[1].name,st[2].name]]);
});

test("qualifying: the organiser picks how many matches each player plays",()=>{
  assert.deepEqual(T.qualiPers(7),[2,4,6]);
  assert.deepEqual(T.qualiPers(6),[1,2,3,4,5]);
  assert.deepEqual(T.qualiPers(26),[1,2,3,4,5,6]);
  for(const [n,per] of [[7,4],[7,6],[6,1],[6,3],[6,5],[26,3],[26,6],[12,4]]){
    const t=T.buildTour(names(n),4,"quali",undefined,per), q=t.quali;
    assert.equal(q.per,per);
    assert.equal(q.matches.length,n*per/2,`${n} players, ${per} each`);
    const opp={};for(const m of q.matches){(opp[m.a]??=[]).push(m.b);(opp[m.b]??=[]).push(m.a)}
    for(const p of names(n)){assert.equal(opp[p].length,per,`${p} with ${n}/${per}`);assert.equal(new Set(opp[p]).size,per,"never the same opponent twice");assert.ok(!opp[p].includes(p))}
  }
  // an odd number with an odd count of players can't work: back to 2
  assert.equal(T.buildTour(names(7),2,"quali",undefined,3).quali.matches.length,7);
  assert.equal(T.buildTour(names(7),2,"quali").quali.per,2);
});

test("match is first to 2 games and winners move on",()=>{
  const t=T.buildTour(names(4),2,"knockout");
  T.settle(t);
  const [m1,m2]=t.rounds[0];
  winGame(t,m1,"P1");
  assert.equal(m1.winner,null);
  assert.equal(T.gameNo(m1),2);
  winGame(t,m1,"P2");
  winGame(t,m1,"P1");
  assert.equal(m1.winner,"P1");
  assert.equal(t.rounds[1][0].a,"P1");
  assert.equal(t.rounds[1][0].b,null);
  T.undoGameWin(t,m1,"P1");
  assert.equal(m1.winner,null);
  assert.equal(t.rounds[1][0].a,null);
  winGame(t,m1,"P1");
  winMatch(t,m2,"P4");
  winMatch(t,t.rounds[1][0],"P4");
  assert.equal(t.champion,"P4");
});

test("table assignment: earliest round first, one table per player, capped by tables",()=>{
  const t=T.buildTour(names(8),2,"knockout");
  assert.equal(t.tables,2);
  T.settle(t);T.assignTables(t);
  assert.deepEqual(t.rounds[0].map(m=>m.table),[0,1,null,null]);
  winMatch(t,t.rounds[0][0],"P1");
  T.assignTables(t);
  assert.equal(t.rounds[0][2].table,0);
  // a qualifying player is never on two tables at once
  const q=T.buildTour(names(5),8,"quali");
  T.settle(q);T.assignTables(q);
  const live=T.allMatches(q).filter(({m})=>m.table!=null).map(({m})=>m);
  const players=live.flatMap(m=>[m.a,m.b]);
  assert.equal(new Set(players).size,players.length);
  assert.equal(q.tables,2);
});

test("tables are capped at the number of first-round matches",()=>{
  assert.equal(T.buildTour(names(4),8,"knockout").tables,2);
  assert.equal(T.buildTour(names(3),8,"byes").tables,1);
});

test("round names",()=>{
  const t=T.buildTour(names(16),1,"knockout");
  assert.deepEqual([0,1,2,3,-1].map(ri=>T.roundName(t,ri)),["Round 1","Quarter-finals","Semi-finals","Final","Qualifying"]);
});

test("a player who withdraws gives walkovers, drops to the bottom of qualifying, and never goes through",()=>{
  const t=T.buildTour(names(6),2,"quali");T.settle(t);T.assignTables(t);
  // P1 v P2 has a game going; P1 leaves
  const m0=T.matchOf(t,-1,0);m0.game={done:false};
  assert.ok(T.withdraw(t,"P1").ok);
  assert.match(T.withdraw(t,"P1").error,/already/);
  assert.match(T.withdraw(t,"Zed").error,/isn't/);
  const p1=t.quali.matches.filter(m=>m.a==="P1"||m.b==="P1");
  assert.equal(p1.length,2);
  for(const m of p1){assert.ok(m.wo);assert.notEqual(m.winner,"P1");assert.equal(m.game,null)}
  // finish the rest: the first player of each match wins
  for(const m of t.quali.matches)if(!m.winner)winMatch(t,m,m.a);
  const st=T.standings(t);
  assert.equal(st.at(-1).name,"P1");
  assert.ok(!t.rounds[0].some(m=>m.a==="P1"||m.b==="P1"));
});

test("a knockout walkover moves the other player on",()=>{
  const t=T.buildTour(names(4),2,"knockout");T.settle(t);
  T.withdraw(t,"P2");
  assert.equal(t.rounds[0][0].winner,"P1");
  winMatch(t,t.rounds[0][1],"P4");
  assert.equal(t.rounds[1][0].a,"P1");assert.equal(t.rounds[1][0].b,"P4");
  T.withdraw(t,"P4");
  assert.equal(t.champion,"P1");
});

test("the organiser sets or corrects a result until a game is played on the back of it",()=>{
  const t=T.buildTour(names(4),2,"knockout");T.settle(t);T.assignTables(t);
  const m=t.rounds[0][0];
  assert.match(T.setResult(t,{ri:0,mi:0,winner:"P1",wa:3,wb:0}).error,/games/);
  assert.match(T.setResult(t,{ri:0,mi:0,winner:"P9",wa:2,wb:0}).error,/winner/);
  assert.ok(T.setResult(t,{ri:0,mi:0,winner:"P1",wa:2,wb:1}).ok);
  assert.equal(t.rounds[1][0].a,"P1");
  assert.ok(T.setResult(t,{ri:0,mi:0,winner:"P2",wa:0,wb:2}).ok,"corrected");
  assert.equal(t.rounds[1][0].a,"P2");assert.equal(m.wb,2);
  winMatch(t,t.rounds[0][1],"P3");T.assignTables(t);
  t.rounds[1][0].game={done:false};
  assert.match(T.setResult(t,{ri:0,mi:0,winner:"P1",wa:2,wb:0}).error,/back of this result/);
  assert.match(T.setResult(t,{ri:1,mi:0,winner:"P2",wa:2,wb:0}).error,/being played/);
});
