// Live tournaments: the shared rules (applyOp) and the API around them. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the server's copy of the rules is the app's", () => {
  assert.equal(readFileSync(new URL("../backend/src/lib/rules.cjs", import.meta.url), "utf8"),
    readFileSync(new URL("../app/js/rules.js", import.meta.url), "utf8"), "run: npm run sync-rules");
});

test("applyOp: a match played game by game, resends are harmless, stale changes are refused", () => {
  const tour = T.buildTour(["Al", "Bo", "Cy", "Di"], 2, "quali");
  T.settle(tour); T.assignTables(tour);
  assert.equal(T.matchOf(tour, 0, 0).table, 0);
  assert.equal(T.matchOf(tour, 0, 1).table, 1);
  assert.match(T.applyOp(tour, 1, { t: "start", ri: 0, mi: 0, gameId: uuid(), order: ["Al", "Bo"] }).error, /not on this table/);
  assert.match(T.applyOp(tour, 0, { t: "start", ri: 0, mi: 0, gameId: uuid(), order: ["Al", "Cy"] }).error, /two players/);

  const ops = gameOps(tour, 0, 0, 0, "Al");
  const m = T.matchOf(tour, 0, 0);
  assert.equal(m.wa, 1);
  for (const op of ops) assert.ok(T.applyOp(tour, 0, op).dup, "a resend changes nothing");
  assert.equal(m.wa, 1);

  // A score sent for a turn that has already been played by someone else
  const g2 = uuid();
  T.applyOp(tour, 0, { t: "start", ri: 0, mi: 0, gameId: g2, order: ["Bo", "Al"] });
  assert.ok(T.applyOp(tour, 0, { t: "turn", ri: 0, mi: 0, gameId: g2, expect: 0, id: "a", s: 4 }).ok);
  const stale = T.applyOp(tour, 0, { t: "turn", ri: 0, mi: 0, gameId: g2, expect: 0, id: "b", s: 2 });
  assert.ok(stale.conflict);
  assert.ok(T.applyOp(tour, 0, { t: "turn", ri: 0, mi: 0, gameId: g2, expect: 1, id: "c", s: 9 }).error, "9 is off the keypad");
  // Undo the last turn, twice sent
  const undo = { t: "undo", ri: 0, mi: 0, gameId: g2, expect: 2, id: "c" };
  assert.ok(T.applyOp(tour, 0, { ...undo, expect: 1, id: "zz" }).conflict, "zz is not the last turn");
  assert.ok(T.applyOp(tour, 0, { t: "turn", ri: 0, mi: 0, gameId: g2, expect: 1, id: "c", s: 3 }).ok);
  assert.ok(T.applyOp(tour, 0, undo).undone);
  assert.ok(T.applyOp(tour, 0, undo).dup);
  assert.equal(m.game.hist.length, 1);
});

test("applyOp: an ambiguous finish needs the toads, and a match win moves the winner on", () => {
  const tour = T.buildTour(["Al", "Bo"], 1, "quali");
  T.settle(tour); T.assignTables(tour);
  gameOps(tour, 0, 0, 0, "Al");
  const ops = gameOps(tour, 0, 0, 0, "Al");
  assert.equal(tour.champion, "Al");
  const last = ops.at(-1), m = T.matchOf(tour, 0, 0);
  // undo the winning throw: the title goes, then comes back when the same throw is sent again
  const uw = { t: "undoWin", ri: 0, mi: 0, gameId: last.gameId, expect: last.expect + 1, id: last.id };
  assert.ok(T.applyOp(tour, 0, uw).undone);
  assert.equal(tour.champion, null);
  assert.equal(m.wa, 1);
  assert.ok(T.applyOp(tour, 0, uw).dup);
  // without saying how many toads, a finish that could have used fewer is asked about
  const g = m.game, left = g.rem[g.cur];
  if (T.finishChoices(left, T.coinsFor(g.hist.length, left)).length) {
    const r = T.applyOp(tour, 0, { ...last, used: undefined });
    assert.ok(r.ask);
  }
  assert.ok(T.applyOp(tour, 0, last).finished);
  assert.equal(tour.champion, "Al");
});

test("applyOp: a win can't be undone once the next round has started on it", () => {
  const tour = T.buildTour(["Al", "Bo", "Cy", "Di"], 2, "quali");
  T.settle(tour); T.assignTables(tour);
  gameOps(tour, 0, 0, 0, "Al");
  const win = gameOps(tour, 0, 0, 0, "Al").at(-1);
  gameOps(tour, 1, 0, 1, "Cy");
  gameOps(tour, 1, 0, 1, "Cy");
  const f = T.matchOf(tour, 1, 0);
  assert.deepEqual([f.a, f.b, f.table], ["Al", "Cy", 0]);
  gameOps(tour, 0, 1, 0, "Al");
  const r = T.applyOp(tour, 0, { t: "undoWin", ri: 0, mi: 0, gameId: win.gameId, expect: win.expect + 1, id: win.id });
  assert.match(r.error, /already started/);
});

test("applyOp: undoing a match win before the next match starts gives the table back", () => {
  const tour = T.buildTour(["Al", "Bo", "Cy", "Di"], 1, "quali");
  T.settle(tour); T.assignTables(tour);
  gameOps(tour, 0, 0, 0, "Al");
  const win = gameOps(tour, 0, 0, 0, "Al").at(-1);
  assert.equal(T.matchOf(tour, 0, 1).table, 0, "the next match got table 1");
  assert.ok(T.applyOp(tour, 0, { t: "undoWin", ri: 0, mi: 0, gameId: win.gameId, expect: win.expect + 1, id: win.id }).undone);
  assert.equal(T.matchOf(tour, 0, 1).table, null);
  assert.equal(T.matchOf(tour, 0, 0).table, 0);
  assert.equal(T.matchOf(tour, 1, 0).a, null);
});

async function create(h, body = {}) {
  const token = await orgToken(h);
  return call(h, "POST /tournaments", { token, body: { name: "Friday cup", venue: "Dover Castle", players: ["Al", "Bo", "Cy", "Di"], tables: 2, pin: PIN, ...body } });
}

test("tournaments: only the organiser creates one, and bad details are refused", async () => {
  const { h } = setup();
  assert.equal((await call(h, "POST /tournaments", { body: { name: "x", players: ["a", "b"], tables: 1, pin: PIN } })).status, 401);
  for (const bad of [{ name: "" }, { players: ["Al"] }, { players: ["Al", "al"] }, { tables: 0 }, { tables: 9 }, { pin: "12" }, { pin: 1234 }, { players: ["<b>"] }])
    assert.equal((await create(h, bad)).status, 400, JSON.stringify(bad));
  const r = await create(h);
  assert.equal(r.status, 201);
  const t = r.body.tournament;
  assert.match(t.id, /^[A-Z0-9]{6}$/);
  assert.equal(t.status, "live");
  assert.equal(t.tour.tables, 2);
  assert.equal(JSON.stringify(t).includes(PIN), false);
  assert.equal(JSON.stringify(t).includes("hash"), false);
  // anyone can follow it, cheaply when nothing changed
  const got = await call(h, "GET /tournaments/{id}", { id: t.id });
  assert.equal(got.body.tournament.name, "Friday cup");
  assert.deepEqual((await call(h, "GET /tournaments/{id}", { id: t.id, query: { since: String(t.ver) } })).body, { same: true, ver: t.ver });
  assert.equal((await call(h, "GET /tournaments/{id}", { id: "NOPE00" })).status, 404);
  assert.deepEqual((await call(h, "GET /tournaments")).body.tournaments.map(x => [x.name, x.champion]), [["Friday cup", null]]);
});

test("tournaments: a table is claimed with the PIN, and only that phone scores it", async () => {
  const { h } = setup();
  const t = (await create(h)).body.tournament;
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: "0000" } })).status, 403);
  const a = await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN } });
  assert.equal(a.status, 200);
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 5, body: { pin: PIN } })).status, 404);
  const b = await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN } });
  assert.equal(b.status, 409);
  assert.ok(b.body.claimed);

  const tour = structuredClone(t.tour), ops = gameOps(tour, 0, 0, 0, "Al");
  const play = (token, op) => call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n: 0, body: { token, op } });
  assert.equal((await play("not-the-token", ops[0])).status, 403);
  for (const op of ops) assert.equal((await play(a.body.token, op)).status, 200);
  // a second phone takes over (the first one's battery died); the first can no longer score
  const c = await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n: 0, body: { pin: PIN, takeover: true } });
  assert.equal(c.status, 200);
  const next = { t: "start", ri: 0, mi: 0, gameId: uuid(), order: ["Bo", "Al"] };
  const lost = await play(a.body.token, next);
  assert.equal(lost.status, 403);
  assert.ok(lost.body.lost);
  assert.equal((await play(c.body.token, next)).status, 200);
  const view = (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament;
  assert.equal(view.claims[0].tag, c.body.tag);
  assert.equal(T.matchOf(view.tour, 0, 0).wa, 1);
  // released by the phone, or by the organiser
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/release", { id: t.id, n: 0, body: { token: a.body.token } })).status, 403);
  assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/release", { id: t.id, n: 0, token: await orgToken(h) })).status, 200);
  assert.deepEqual((await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament.claims, {});
});

test("tournaments: two tables score at once, games reach the players' stats, an undone win leaves them", async () => {
  const { h, db } = setup();
  const al = (await call(h, "POST /players", { body: { name: "Al" } })).body.player;
  await call(h, "POST /venues", { body: { name: "Dover Castle" }, token: await orgToken(h) });
  const t = (await create(h)).body.tournament;
  const tok = [];
  for (const n of [0, 1]) tok[n] = (await call(h, "POST /tournaments/{id}/tables/{n}/claim", { id: t.id, n, body: { pin: PIN } })).body.token;
  // each phone has its own copy, as fetched
  const p0 = structuredClone(t.tour), p1 = structuredClone(t.tour);
  const send = (n, ops) => (async () => { for (const op of ops) { const r = await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n, body: { token: tok[n], op } }); assert.equal(r.status, 200, JSON.stringify(r.body)); } })();
  const ops0 = [...gameOps(p0, 0, 0, 0, "Al"), ...gameOps(p0, 0, 0, 0, "Al")], ops1 = [...gameOps(p1, 1, 0, 1, "Di"), ...gameOps(p1, 1, 0, 1, "Di")];
  await Promise.all([send(0, ops0), send(1, ops1)]);
  const view = (await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament;
  const f = T.matchOf(view.tour, 1, 0);
  assert.deepEqual([f.a, f.b], ["Al", "Di"]);
  assert.equal(view.ver, 1 + 2 + ops0.length + ops1.length, "the claims and every change, none lost in the race");

  const stats = (await call(h, "GET /players/{id}/stats", { id: al.id })).body;
  assert.equal(stats.totals.played, 2);
  assert.equal(stats.totals.won, 2);
  assert.equal(stats.venues[0].name, "Dover Castle");
  assert.deepEqual(stats.tournaments.map(x => [x.name, x.played, x.won]), [["Friday cup", 2, 2]]);
  const games = (await call(h, "GET /games")).body.games;
  assert.equal(games.length, 4);
  assert.ok(games.every(g => g.tournament && g.tournament.name === "Friday cup"));

  // the final: Al wins game 1, then the winning throw is undone, then the tournament is ended
  const pf = structuredClone(view.tour), fin = gameOps(pf, 0, 1, 0, "Al");
  for (const op of fin) assert.equal((await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n: 0, body: { token: tok[0], op } })).status, 200);
  assert.equal((await call(h, "GET /players/{id}/stats", { id: al.id })).body.totals.played, 3);
  const w = fin.at(-1);
  const uw = await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n: 0, body: { token: tok[0], op: { t: "undoWin", ri: 1, mi: 0, gameId: w.gameId, expect: w.expect + 1, id: w.id } } });
  assert.equal(uw.status, 200);
  assert.equal((await call(h, "GET /players/{id}/stats", { id: al.id })).body.totals.played, 2);
  assert.equal([...db.rows.keys()].filter(x => x.startsWith(`GAME#${w.gameId}`)).length, 0);

  assert.equal((await call(h, "POST /tournaments/{id}/end", { id: t.id })).status, 401);
  assert.equal((await call(h, "POST /tournaments/{id}/end", { id: t.id, token: await orgToken(h) })).status, 200);
  const shut = await call(h, "POST /tournaments/{id}/tables/{n}/play", { id: t.id, n: 0, body: { token: tok[0], op: { ...w } } });
  assert.equal(shut.status, 409);
  assert.equal((await call(h, "GET /tournaments/{id}", { id: t.id })).body.tournament.status, "ended");
  assert.deepEqual((await call(h, "GET /tournaments")).body.tournaments, [], "an ended tournament leaves the Live now list");
  assert.equal((await call(h, "DELETE /tournaments/{id}", { id: t.id, token: await orgToken(h) })).status, 200);
  assert.equal((await call(h, "GET /tournaments/{id}", { id: t.id })).status, 404);
  assert.deepEqual((await call(h, "GET /tournaments")).body.tournaments, []);
});

test("saved games can't claim to be from a tournament", async () => {
  const { h } = setup();
  const g = T.newG(["Al"]);
  while (!g.rem.includes(0)) { const c = T.coinsFor(g.hist.length, g.rem[0]), s = Math.min(2 * c, g.rem[0]); const r = T.playTurn(g, s); if (r.ask) T.playTurn(g, s, r.ask.at(-1)); }
  const rec = { ...T.gameRecord(g, { id: uuid(), mode: "single" }), tournament: { id: "ABCDEF", name: "Fake cup" } };
  assert.equal((await call(h, "POST /games", { body: rec })).status, 201);
  assert.equal((await call(h, "GET /games")).body.games[0].tournament, undefined);
});
