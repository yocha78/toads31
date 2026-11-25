// Big screen for a practice game: post by the phone that owns the screen, read by anyone
import test from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../backend/src/api.mjs";
import { fakeDb } from "./fake-db.mjs";

const PW = async () => "pw";
const call = async (h, routeKey, id, body, query) => {
  const r = await h({ routeKey, pathParameters: { id }, queryStringParameters: query, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const KEY = "k".repeat(20);
const game = (over = {}) => ({
  gp: ["Al", "Bo"], rem: [26, 31], cur: 1, round: 1, done: false, winner: null, wins: { Al: 2 },
  hist: [{ p: 0, s: 5, before: 31, round: 1, bust: false, who: "Al", id: "x", at: 1 }], ...over,
});

test("screens: the phone posts the game, a TV reads it, and ?since says when nothing changed", async () => {
  const h = makeHandler(fakeDb(), "T", PW);
  assert.equal((await call(h, "GET /screens/{id}", "ABC123")).status, 404);
  const p = await call(h, "POST /screens/{id}", "ABC123", { key: KEY, game: game() });
  assert.equal(p.status, 200);
  assert.equal(p.body.ver, 1);
  const g = await call(h, "GET /screens/{id}", "ABC123");
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.screen.game.rem, [26, 31]);
  assert.deepEqual(g.body.screen.game.wins, { Al: 2 });
  assert.equal(g.body.screen.game.hist[0].id, undefined, "only what the screen shows is kept");
  assert.equal(g.body.screen.key, undefined, "the key is never shown");
  assert.deepEqual((await call(h, "GET /screens/{id}", "ABC123", undefined, { since: "1" })).body, { same: true, ver: 1 });
  assert.equal((await call(h, "POST /screens/{id}", "ABC123", { key: KEY, game: game({ rem: [26, 20], cur: 0 }) })).body.ver, 2);
  assert.deepEqual((await call(h, "GET /screens/{id}", "ABC123", undefined, { since: "1" })).body.screen.game.rem, [26, 20]);
});

test("screens: another phone can't take over a screen", async () => {
  const h = makeHandler(fakeDb(), "T", PW);
  await call(h, "POST /screens/{id}", "ABC123", { key: KEY, game: game() });
  assert.equal((await call(h, "POST /screens/{id}", "ABC123", { key: "z".repeat(20), game: game() })).status, 403);
});

test("screens: duo teams and a winner come through", async () => {
  const h = makeHandler(fakeDb(), "T", PW);
  const duo = game({ gp: ["Reds", "Blues"], members: { Reds: ["Al", "Bo"], Blues: ["Cy", "Di"] }, done: true, winner: "Reds", rem: [0, 12] });
  assert.equal((await call(h, "POST /screens/{id}", "DUO111", { key: KEY, game: duo })).status, 200);
  const s = (await call(h, "GET /screens/{id}", "DUO111")).body.screen.game;
  assert.deepEqual(s.members.Blues, ["Cy", "Di"]);
  assert.equal(s.winner, "Reds");
});

test("screens: bad input is refused", async () => {
  const h = makeHandler(fakeDb(), "T", PW);
  assert.equal((await call(h, "POST /screens/{id}", "abc", { key: KEY, game: game() })).status, 404);
  assert.equal((await call(h, "POST /screens/{id}", "ABC123", { key: "short", game: game() })).status, 400);
  for (const bad of [{ gp: [] }, { gp: ["<b>"] , rem: [1] }, { rem: [40, 1] }, { cur: 5 }, { winner: "Zed" }, { hist: [{ p: 9 }] }, { members: { Al: ["x"] } }]) {
    assert.equal((await call(h, "POST /screens/{id}", "ABC123", { key: KEY, game: game(bad) })).status, 400, JSON.stringify(bad));
  }
});

test("screens: forgotten a day after the last change", async () => {
  const db = fakeDb(), h = makeHandler(db, "T", PW);
  await call(h, "POST /screens/{id}", "OLD999", { key: KEY, game: game() });
  const row = db.rows.get("SCREEN#OLD999\u0000META");
  row.ttl = Math.floor(Date.now() / 1000) - 1;
  assert.equal((await call(h, "GET /screens/{id}", "OLD999")).status, 404);
  // and the code can be used again by anyone
  assert.equal((await call(h, "POST /screens/{id}", "OLD999", { key: "z".repeat(20), game: game() })).body.ver, 1);
});
