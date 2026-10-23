// Saved games: games played with the real rules, sent to the real handler. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeHandler } from "../backend/src/api.mjs";
import { fakeDb } from "./fake-db.mjs";
const T = createRequire(import.meta.url)("../app/js/rules.js");

const call = async (h, routeKey, body, pathParameters) => {
  const r = await h({ routeKey, pathParameters, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
// Play scores in turn until someone finishes; [score, toads] answers an ambiguous finish
function played(sides, scores, members) {
  const g = T.newG(sides);
  if (members) g.members = members;
  for (const x of scores) {
    const r = Array.isArray(x) ? T.playTurn(g, x[0], x[1]) : T.playTurn(g, x);
    assert.ok(!r.ask, "scores need an answer for the finish");
    if (r.won) break;
  }
  return g;
}
// Al wins: 4, 8, 8, 8, then 3 from 3 with 2 toads in round 5; Bo scores 0 each time
const AL_WINS = [4, 0, 8, 0, 8, 0, 8, 0, [3, 2]];
const singleGame = () => played(["Al", "Bo"], AL_WINS);
const record = (g, extra = {}) => T.gameRecord(g, { id: uuid(), mode: g.members ? "duo" : "single", finished: Date.now(), ...extra });

test("a finished single game is saved with its turns, and sending it again saves it once", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const rec = record(singleGame(), { venue: "The Basketmakers" });
  const r = await call(h, "POST /games", rec);
  assert.equal(r.status, 201);
  assert.equal(r.body.game.winner, "Al");
  assert.equal(r.body.game.turns, 9);
  assert.equal(r.body.game.rounds, 5);
  const again = await call(h, "POST /games", rec);
  assert.equal(again.status, 200);
  assert.equal(again.body.game.id, rec.id);
  const g = await call(h, "GET /games/{id}", undefined, { id: rec.id });
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.game.turns.map(t => t.s), [4, 0, 8, 0, 8, 0, 8, 0, 3]);
  assert.equal(g.body.game.turns[8].c, 2);
  assert.equal(g.body.game.venue, "The Basketmakers");
  assert.equal(g.body.game.venueId, null);
});

test("registered players and venues are linked, and each registered player gets a summary", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const al = (await call(h, "POST /players", { name: "Al" })).body.player;
  const v = (await call(h, "POST /venues", { name: "The Lewes Arms" })).body.venue;
  const rec = record(singleGame(), { venue: "the lewes arms" });
  const r = await call(h, "POST /games", rec);
  assert.equal(r.body.game.venue, "The Lewes Arms");
  assert.equal(r.body.game.venueId, v.id);
  const [pa, pb] = r.body.game.players;
  assert.deepEqual([pa.name, pa.playerId, pa.won, pa.pts, pa.toads], ["Al", al.id, true, 31, 2 + 4 + 4 + 4 + 2]);
  assert.deepEqual([pb.name, pb.playerId, pb.won, pb.pts, pb.toads], ["Bo", null, false, 0, 3 + 4 + 4 + 4]);
  const mine = [...db.rows.values()].filter(x => x.PK === `PLAYER#${al.id}` && x.SK.startsWith("GAME#"));
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].won, mine[0].pts, mine[0].venueId], [true, 31, v.id]);
  assert.equal([...db.rows.values()].filter(x => x.SK.startsWith("GAME#")).length, 1, "guests get no summary");
});

test("duo games credit each partner with their own throws", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  await call(h, "POST /players", { name: "Bo" });
  const g = played(["Reds", "Blues"], AL_WINS, { Reds: ["Al", "Bo"], Blues: ["Cy", "Di"] });
  const r = await call(h, "POST /games", record(g));
  assert.equal(r.status, 201);
  assert.equal(r.body.game.winner, "Reds");
  const by = Object.fromEntries(r.body.game.players.map(p => [p.name, p]));
  assert.deepEqual([by.Al.pts, by.Bo.pts, by.Al.side, by.Al.won, by.Cy.won], [4 + 8 + 3, 8 + 8, "Reds", true, false]);
  assert.ok(by.Bo.playerId);
});

test("long games are written in batches of 25 turns", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const g = played(["A", "B", "C"], [...Array(60).fill(0), 8, 0, 0, 8, 0, 0, 8, 0, 0, [7, 4]]);
  assert.equal(g.hist.length, 70);
  const r = await call(h, "POST /games", record(g));
  assert.equal(r.status, 201);
  assert.equal(db.calls.filter(c => c === "BatchWriteCommand").length, 3);
  assert.equal((await call(h, "GET /games/{id}", undefined, { id: r.body.game.id })).body.game.turns.length, 70);
});

test("games that don't add up are refused and nothing is saved", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const bad = [
    r => { r.id = "nope"; },
    r => { r.mode = "tournament"; },
    r => { r.turns.pop(); },                       // not finished
    r => { r.turns[0].s = 5; },                    // 2 toads score at most 4
    r => { r.turns[0].c = 3; },                    // first turn is 2 toads
    r => { r.turns[2].before = 30; },              // doesn't follow on
    r => { r.turns[0].bust = true; },
    r => { r.turns[1].who = "Al"; },               // wrong thrower
    r => { r.turns.push({ ...r.turns[1] }); },     // after the win
    r => { r.sides = ["Al", "Al"]; },
    r => { r.venue = "<b>pub</b>"; },
    r => { r.turns = []; },
  ];
  for (const [i, f] of bad.entries()) {
    const rec = record(singleGame());
    f(rec);
    assert.equal((await call(h, "POST /games", rec)).status, 400, `case ${i}`);
  }
  const duo = record(played(["Reds", "Blues"], AL_WINS, { Reds: ["Al", "Bo"], Blues: ["Bo", "Di"] }));
  assert.equal((await call(h, "POST /games", duo)).status, 400, "player in two teams");
  assert.equal(db.rows.size, 0);
});

test("the latest games are listed newest first", async () => {
  const h = makeHandler(fakeDb(), "T");
  const a = record(singleGame(), { finished: Date.now() - 60000 }), b = record(singleGame(), { venue: "The Swan" });
  await call(h, "POST /games", a);
  await call(h, "POST /games", b);
  const r = await call(h, "GET /games");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.games.map(g => g.id), [b.id, a.id]);
  assert.equal(r.body.games[0].venue, "The Swan");
});

test("unknown game ids are 404", async () => {
  const h = makeHandler(fakeDb(), "T");
  assert.equal((await call(h, "GET /games/{id}", undefined, { id: uuid() })).status, 404);
  assert.equal((await call(h, "GET /games/{id}", undefined, { id: "x" })).status, 404);
});
