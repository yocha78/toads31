// Organiser login, tidying the lists, and player stats. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeHandler } from "../backend/src/api.mjs";
import { fakeDb } from "./fake-db.mjs";
const T = createRequire(import.meta.url)("../app/js/rules.js");

const PASSWORD = "toad in the hole";
const setup = (password = PASSWORD) => {
  const db = fakeDb();
  return { db, h: makeHandler(db, "T", async () => password) };
};
const call = async (h, routeKey, { body, id, token, query } = {}) => {
  const r = await h({
    routeKey, pathParameters: id ? { id } : undefined, queryStringParameters: query,
    headers: token ? { authorization: "Bearer " + token } : {}, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const loginToken = async h => (await call(h, "POST /auth/organiser", { body: { password: PASSWORD } })).body.token;
const addPlayer = async (h, name) => (await call(h, "POST /players", { body: { name } })).body.player;
const addVenue = async (h, name) => (await call(h, "POST /venues", { body: { name } })).body.venue;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
// A game in which `winner` scores as much as their toads allow and everyone else scores 0
async function playSaved(h, sides, winner, { venue, finished = Date.now() } = {}) {
  const g = T.newG(sides);
  for (;;) {
    const p = g.cur, c = T.coinsFor(g.hist.length, g.rem[p]);
    const s = g.gp[p] === winner ? Math.min(2 * c, g.rem[p]) : 0;
    let r = T.playTurn(g, s);
    if (r.ask) r = T.playTurn(g, s, r.ask.at(-1));
    if (r.won) break;
  }
  const rec = T.gameRecord(g, { id: uuid(), mode: "single", venue, finished });
  const saved = await call(h, "POST /games", { body: rec });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  return rec;
}

test("organiser login: right password gives a token, wrong one doesn't", async () => {
  const { h } = setup();
  const ok = await call(h, "POST /auth/organiser", { body: { password: PASSWORD } });
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^[\w-]+\.[\w-]+$/);
  assert.equal((await call(h, "POST /auth/organiser", { body: { password: "nope" } })).status, 401);
  assert.equal((await call(h, "POST /auth/organiser", { body: {} })).status, 401);
  const none = setup(null);
  assert.equal((await call(none.h, "POST /auth/organiser", { body: { password: "" } })).status, 503);
});

test("housekeeping needs a valid organiser token", async () => {
  const { h } = setup();
  const p = await addPlayer(h, "Dave");
  assert.equal((await call(h, "PATCH /players/{id}", { id: p.id, body: { name: "Dave B" } })).status, 401);
  assert.equal((await call(h, "DELETE /players/{id}", { id: p.id, token: "abc.def" })).status, 401);
  const token = await loginToken(h);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ role: "organiser", exp: Date.now() + 1e9 })).toString("base64url") + "." + sig;
  assert.equal((await call(h, "DELETE /players/{id}", { id: p.id, token: forged })).status, 401);
  // a token signed with an old password stops working when the password changes
  const other = makeHandler(fakeDb(), "T", async () => "new password");
  assert.equal((await call(other, "DELETE /players/{id}", { id: p.id, token })).status, 401);
  assert.ok(body);
});

test("rename a player: the list follows, and a taken name is refused", async () => {
  const { h } = setup();
  const token = await loginToken(h);
  const dave = await addPlayer(h, "Dave");
  await addPlayer(h, "Sue");
  const r = await call(h, "PATCH /players/{id}", { id: dave.id, token, body: { name: "Dave B" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.player.name, "Dave B");
  assert.deepEqual((await call(h, "GET /players")).body.players.map(p => p.name), ["Dave B", "Sue"]);
  assert.equal((await call(h, "POST /players", { body: { name: "Dave" } })).status, 201, "old name is free again");
  assert.equal((await call(h, "PATCH /players/{id}", { id: dave.id, token, body: { name: "sue" } })).status, 409);
  assert.equal((await call(h, "PATCH /players/{id}", { id: dave.id, token, body: { name: "DAVE b" } })).status, 200, "only capitals change");
  assert.equal((await call(h, "PATCH /players/{id}", { id: "missing", token, body: { name: "X" } })).status, 404);
  assert.equal((await call(h, "PATCH /players/{id}", { id: dave.id, token, body: { name: "" } })).status, 400);
});

test("rename and delete a venue", async () => {
  const { h } = setup();
  const token = await loginToken(h);
  const v = await addVenue(h, "Dover Castel");
  const r = await call(h, "PATCH /venues/{id}", { id: v.id, token, body: { name: "Dover Castle", area: "Hanover" } });
  assert.deepEqual([r.status, r.body.venue.name, r.body.venue.area], [200, "Dover Castle", "Hanover"]);
  assert.equal((await call(h, "DELETE /venues/{id}", { id: v.id, token })).status, 200);
  assert.deepEqual((await call(h, "GET /venues")).body.venues, []);
});

test("stats: totals, best game, head to head, recent games, and the pub filter", async () => {
  const { h } = setup();
  const al = await addPlayer(h, "Al"), bo = await addPlayer(h, "Bo");
  const swan = await addVenue(h, "The Swan");
  await playSaved(h, ["Al", "Bo"], "Al", { venue: "The Swan", finished: Date.parse("2026-09-10T20:00:00Z") });
  await playSaved(h, ["Al", "Bo", "Gus"], "Bo", { venue: "Dover Castle", finished: Date.parse("2026-10-20T20:00:00Z") });
  await playSaved(h, ["Al"], "Al", { venue: "The Swan", finished: Date.parse("2026-10-21T20:00:00Z") });
  const s = (await call(h, "GET /players/{id}/stats", { id: al.id })).body;
  assert.equal(s.player.name, "Al");
  assert.deepEqual([s.totals.played, s.totals.won, s.totals.pts], [3, 2, 31 + 0 + 31]);
  assert.deepEqual(s.months.map(m => [m.month, m.played]), [["2026-09", 1], ["2026-10", 2]]);
  assert.equal(s.recent[0].finished, "2026-10-21T20:00:00.000Z");
  assert.ok(s.best.won);
  const vsBo = s.headToHead.find(x => x.playerId === bo.id), vsGus = s.headToHead.find(x => x.name === "Gus");
  assert.deepEqual([vsBo.played, vsBo.won, vsBo.lost], [2, 1, 1]);
  assert.deepEqual([vsGus.played, vsGus.won, vsGus.lost, vsGus.playerId], [1, 0, 0, null]);
  assert.deepEqual(s.venues.map(v => [v.name, v.played]), [["The Swan", 2], ["Dover Castle", 1]]);
  const atSwan = (await call(h, "GET /players/{id}/stats", { id: al.id, query: { venue: swan.id } })).body;
  assert.deepEqual([atSwan.totals.played, atSwan.totals.won], [2, 2]);
  assert.equal((await call(h, "GET /players/{id}/stats", { id: "nobody" })).status, 404);
});

test("merge moves the duplicate's games across, then removes it", async () => {
  const { h } = setup();
  const token = await loginToken(h);
  const dave = await addPlayer(h, "Dave"), daveB = await addPlayer(h, "Dave B");
  await playSaved(h, ["Dave", "Sue"], "Dave");
  await playSaved(h, ["Dave B", "Sue"], "Sue");
  const r = await call(h, "POST /players/{id}/merge", { id: daveB.id, token, body: { into: dave.id } });
  assert.deepEqual([r.status, r.body.player.name, r.body.moved], [200, "Dave", 1]);
  assert.deepEqual((await call(h, "GET /players")).body.players.map(p => p.name), ["Dave"]);
  const s = (await call(h, "GET /players/{id}/stats", { id: dave.id })).body;
  assert.deepEqual([s.totals.played, s.totals.won], [2, 1]);
  assert.equal((await call(h, "POST /players/{id}/merge", { id: dave.id, token, body: { into: dave.id } })).status, 400);
  assert.equal((await call(h, "POST /players/{id}/merge", { id: daveB.id, token, body: { into: dave.id } })).status, 404);
});

test("deleting a player removes their stats and frees the name", async () => {
  const { db, h } = setup();
  const token = await loginToken(h);
  const al = await addPlayer(h, "Al");
  await playSaved(h, ["Al", "Bo"], "Al");
  assert.equal((await call(h, "DELETE /players/{id}", { id: al.id, token })).status, 200);
  assert.equal([...db.rows.values()].filter(r => r.PK === `PLAYER#${al.id}`).length, 0);
  assert.equal((await call(h, "GET /players/{id}/stats", { id: al.id })).status, 404);
  assert.equal((await call(h, "POST /players", { body: { name: "Al" } })).status, 201);
  assert.equal((await call(h, "DELETE /players/{id}", { id: al.id, token })).status, 404);
});
