// Organiser management: deleting saved games, and editing, restarting and deleting tournaments. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeHandler } from "../backend/src/api.mjs";
import { fakeDb } from "./fake-db.mjs";
const T = createRequire(import.meta.url)("../app/js/rules.js");

const PASSWORD = "toad in the hole", PIN = "4321";
const setup = () => {
  const db = fakeDb();
  return { db, h: makeHandler(db, "T", async () => PASSWORD) };
};
const call = async (h, routeKey, { body, id, n, token, query } = {}) => {
  const r = await h({
    routeKey, pathParameters: id ? { id, ...(n != null ? { n: String(n) } : {}) } : undefined, queryStringParameters: query,
    headers: token ? { authorization: "Bearer " + token } : {}, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const orgToken = async h => (await call(h, "POST /auth/organiser", { body: { password: PASSWORD } })).body.token;
let k = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`;

// The ops a scoring phone sends for one whole game on match (ri, mi), where `winner` scores as much as
// they can and the other player scores 0. Applied to the phone's own copy first, like the app does.
function gameOps(tour, table, ri, mi, winner) {
  const m = T.matchOf(tour, ri, mi), gameId = uuid(), ops = [];
  const push = op => { const r = T.applyOp(tour, table, op); assert.ok(r.ok, JSON.stringify(r)); ops.push(op); return r; };
  push({ t: "start", ri, mi, gameId, order: [m.a, m.b] });
  for (;;) {
    const g = m.game, p = g.cur, left = g.rem[p], c = T.coinsFor(g.hist.length, left);
    const s = g.gp[p] === winner ? Math.min(2 * c, left) : 0;
    const ask = s === left ? T.finishChoices(s, c) : [];
    const r = push({ t: "turn", ri, mi, gameId, expect: g.hist.length, id: uuid(), s, used: ask.length ? ask.at(-1) : undefined });
    if (r.finished) return ops;
  }
}
async function create(h, body = {}) {
  return call(h, "POST /tournaments", { token: await orgToken(h), body: { name: "Friday cup", venue: "Dover Castle", players: ["Al", "Bo", "Cy", "Di"], tables: 2, pin: PIN, ...body } });
}
const play = async (h, t, n, token, ops) => {
  for (const op of ops) assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n, body: { token, op } })).status, 200);
};
// A solo game, saved through POST /games
async function soloGame(h, name) {
  const g = T.newG([name]);
  while (!g.rem.includes(0)) { const c = T.coinsFor(g.hist.length, g.rem[0]), s = Math.min(2 * c, g.rem[0]); const r = T.playTurn(g, s); if (r.ask) T.playTurn(g, s, r.ask.at(-1)); }
  const rec = T.gameRecord(g, { id: uuid(), mode: "single", finished: Date.now() });
  assert.equal((await call(h, "POST /games", { body: rec })).status, 201);
  return rec.id;
}
const played = async (h, p) => (await call(h, "GET /players/{id}/stats", { id: p.id })).body.totals.played;

test("the organiser deletes one game, a player's games, or every game", async () => {
  const { h, db } = setup(), org = await orgToken(h);
  const al = (await call(h, "POST /players", { body: { name: "Al" } })).body.player;
  const bo = (await call(h, "POST /players", { body: { name: "Bo" } })).body.player;
  const a1 = await soloGame(h, "Al"); await soloGame(h, "Al"); await soloGame(h, "Bo");
  assert.equal(await played(h, al), 2);

  assert.equal((await call(h, "DELETE /games/{id}", { id: a1 })).status, 401);
  assert.equal((await call(h, "DELETE /games/{id}", { id: a1, token: org })).status, 200);
  assert.equal((await call(h, "DELETE /games/{id}", { id: a1, token: org })).status, 404);
  assert.equal(await played(h, al), 1);
  assert.equal((await call(h, "GET /games/{id}", { id: a1 })).status, 404);
  assert.equal([...db.rows.keys()].filter(k => k.startsWith(`GAME#${a1}`)).length, 0, "its turns go too");

  assert.deepEqual((await call(h, "DELETE /players/{id}/games", { id: al.id, token: org })).body, { deleted: 1 });
  assert.equal(await played(h, al), 0);
  assert.equal(await played(h, bo), 1);

  assert.equal((await call(h, "DELETE /games", { token: org })).status, 400, "needs ?confirm=all");
  assert.deepEqual((await call(h, "DELETE /games", { token: org, query: { confirm: "all" } })).body, { deleted: 1 });
  assert.equal(await played(h, bo), 0);
  assert.deepEqual((await call(h, "GET /games")).body.games, []);
  assert.equal((await call(h, "GET /players")).body.players.length, 2, "players stay");
});

test("edit a tournament: name, venue, PIN, a player's name, and the number of tables", async () => {
  const { h } = setup(), org = await orgToken(h);
  const t = (await create(h)).body.tournament;
  const tok0 = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN } })).body.token;
  await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 1, body: { pin: PIN } });
  const edit = body => call(h, "PATCH /tournaments/{id}", { id: t.id, token: org, body });
  assert.equal((await call(h, "PATCH /tournaments/{id}", { id: t.id, body: { name: "x" } })).status, 401);
  assert.equal((await edit({ name: "" })).status, 400);
  assert.equal((await edit({ pin: "12" })).status, 400);
  assert.equal((await edit({ name: "Saturday cup", venue: "The Bell", pin: "9999" })).status, 200);
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN, takeover: true } })).status, 403, "old PIN");
  let v = (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament;
  assert.deepEqual([v.name, v.venue], ["Saturday cup", "The Bell"]);
  assert.equal((await call(h, "GET /tournaments")).body.tournaments[0].name, "Saturday cup");

  // Al is really Alan; a game in progress keeps going under the new name
  const p = structuredClone(v.tour), m = T.matchOf(p, 0, 0), gid = uuid();
  await play(h, t, 0, tok0, [{ t: "start", ri: 0, mi: 0, gameId: gid, order: ["Al", "Bo"] }]);
  assert.equal((await edit({ rename: { from: "Al", to: "bo" } })).status, 409);
  assert.equal((await edit({ rename: { from: "Zed", to: "Zak" } })).status, 404);
  assert.equal((await edit({ rename: { from: "Al", to: "Alan" } })).status, 200);
  v = (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament;
  assert.deepEqual(T.matchOf(v.tour, 0, 0).game.gp, ["Alan", "Bo"]);
  assert.equal(T.matchOf(v.tour, 0, 0).a, "Alan");
  assert.ok(m);

  // Down to one table: refused while table 2 has a game going, fine once it is free
  const t1 = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 1, body: { pin: "9999", takeover: true } })).body.token;
  await play(h, t, 1, t1, [{ t: "start", ri: 0, mi: 1, gameId: uuid(), order: ["Cy", "Di"] }]);
  assert.equal((await edit({ tables: 1 })).status, 409);
});

test("restart a tournament: back to the draw, claims gone, its games leave the stats", async () => {
  const { h } = setup(), org = await orgToken(h);
  const al = (await call(h, "POST /players", { body: { name: "Al" } })).body.player;
  const t = (await create(h)).body.tournament;
  const tok = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN } })).body.token;
  await play(h, t, 0, tok, gameOps(structuredClone(t.tour), 0, 0, 0, "Al"));
  await soloGame(h, "Al");
  assert.equal(await played(h, al), 2);
  assert.equal((await call(h, "POST /tournaments/{id}/end", { id: t.id, token: org })).status, 200);

  assert.equal((await call(h, "POST /tournaments/{id}/restart", { id: t.id })).status, 401);
  const r = await call(h, "POST /tournaments/{id}/restart", { id: t.id, token: org, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.gamesDeleted, 1);
  assert.equal(await played(h, al), 1, "the solo game stays");
  const v = (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament;
  assert.equal(v.status, "live");
  assert.deepEqual(v.claims, {});
  assert.deepEqual([T.matchOf(v.tour, 0, 0).a, T.matchOf(v.tour, 0, 0).wa, T.matchOf(v.tour, 0, 0).game], ["Al", 0, null]);
  // the old claim no longer scores
  const stale = await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n: 0, body: { token: tok, op: { t: "start", ri: 0, mi: 0, gameId: uuid(), order: ["Al", "Bo"] } } });
  assert.equal(stale.status, 403);
});

test("the management list shows every tournament; delete can take its games too", async () => {
  const { h } = setup(), org = await orgToken(h);
  const al = (await call(h, "POST /players", { body: { name: "Al" } })).body.player;
  const a = (await create(h, { name: "Cup A" })).body.tournament, b = (await create(h, { name: "Cup B", players: ["Al", "Bo", "Cy"] })).body.tournament;
  const list = (await call(h, "GET /tournaments", { query: { all: "1" } })).body.tournaments;
  assert.deepEqual(list.map(x => [x.name, x.status, x.players, x.played]).sort(), [["Cup A", "live", 4, 0], ["Cup B", "live", 3, 0]]);
  const tok = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: a.id, n: 0, body: { pin: PIN } })).body.token;
  await play(h, a, 0, tok, gameOps(structuredClone(a.tour), 0, 0, 0, "Al"));
  assert.equal(await played(h, al), 1);
  assert.deepEqual((await call(h, "DELETE /tournaments/{id}", { id: a.id, token: org, query: { games: "delete" } })).body, { deleted: true, gamesDeleted: 1 });
  assert.equal(await played(h, al), 0);
  assert.deepEqual((await call(h, "DELETE /tournaments/{id}", { id: b.id, token: org })).body, { deleted: true, gamesDeleted: 0 });
  assert.deepEqual((await call(h, "GET /tournaments", { query: { all: "1" } })).body.tournaments, []);
});

test("tables: the organiser names them, takes one out before its match starts, and puts it back", async () => {
  const { h } = setup(), org = await orgToken(h);
  const t = (await create(h, { players: ["Al", "Bo", "Cy", "Di", "Ed", "Fi"], tables: 3 })).body.tournament;
  const edit = body => call(h, "PATCH /tournaments/{id}", { id: t.id, token: org, body });
  const tour = async () => (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament.tour;

  assert.equal((await call(h, "PATCH /tournaments/{id}", { id: t.id, body: { tableNames: { 0: "x" } } })).status, 401);
  assert.equal((await edit({ tableNames: { 0: "<b>" } })).status, 400);
  assert.equal((await edit({ tableNames: { 0: "y".repeat(21) } })).status, 400);
  assert.equal((await edit({ tableNames: { 0: "By the bar", 2: "Garden" } })).status, 200);
  let v = await tour();
  assert.deepEqual([0, 1, 2].map(k => T.tableName(v, k)), ["By the bar", "Table 2", "Garden"]);
  assert.equal((await edit({ tableNames: { 2: "" } })).status, 200, "empty goes back to the default");
  assert.equal(T.tableName(await tour(), 2), "Table 3");

  // Table 1 has a game going, so it stays; table 2's match hasn't started, so it can go
  const tok0 = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN } })).body.token;
  const m0 = T.allMatches(v).find(({ m }) => m.table === 0);
  await play(h, t, 0, tok0, [{ t: "start", ri: m0.ri, mi: m0.mi, gameId: uuid(), order: [m0.m.a, m0.m.b] }]);
  assert.equal((await edit({ removeTable: 0 })).status, 409);
  assert.equal((await edit({ removeTable: 7 })).status, 404);
  await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 1, body: { pin: PIN } });
  assert.equal((await edit({ removeTable: 1 })).status, 200);
  v = await tour();
  assert.deepEqual(v.off, [1]);
  assert.ok(!T.allMatches(v).some(({ m }) => m.table === 1), "nothing is sent to a table that was taken out");
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 1, body: { pin: PIN } })).status, 404);
  assert.equal((await edit({ removeTable: 1 })).status, 404, "already out");
  assert.equal((await edit({ removeTable: 2 })).status, 200);
  assert.equal((await edit({ removeTable: 0 })).status, 409, "the last table stays");

  assert.equal((await edit({ restoreTable: 0 })).status, 404);
  assert.equal((await edit({ restoreTable: 1 })).status, 200);
  v = await tour();
  assert.deepEqual(v.off, [2]);
  assert.ok(T.allMatches(v).some(({ m }) => m.table === 1 && !m.winner), "a match goes back on it");
  assert.equal((await call(h, "GET /tournaments", { token: org, query: { all: "1" } })).body.tournaments[0].tables, 2);
});
