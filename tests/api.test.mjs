// API tests: the real handlers against an in-memory stand-in for DynamoDB. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { QueryCommand, TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { makeHandler } from "../backend/src/api.mjs";

// Just enough DynamoDB for these handlers: Query on PK, Get, and all-or-nothing
// TransactWrite with attribute_not_exists conditions
function fakeDb() {
  const rows = new Map(), k = (pk, sk) => pk + "\u0000" + sk;
  return {
    rows,
    async send(cmd) {
      const i = cmd.input;
      if (cmd instanceof QueryCommand) {
        const pk = i.ExpressionAttributeValues[":pk"];
        return { Items: [...rows.values()].filter(r => r.PK === pk).sort((a, b) => a.SK.localeCompare(b.SK)) };
      }
      if (cmd instanceof GetCommand) return { Item: rows.get(k(i.Key.PK, i.Key.SK)) };
      if (cmd instanceof TransactWriteCommand) {
        for (const { Put } of i.TransactItems) {
          if (Put.ConditionExpression === "attribute_not_exists(PK)" && rows.has(k(Put.Item.PK, Put.Item.SK))) {
            const e = new Error("Transaction cancelled"); e.name = "TransactionCanceledException"; throw e;
          }
        }
        for (const { Put } of i.TransactItems) rows.set(k(Put.Item.PK, Put.Item.SK), { ...Put.Item });
        return {};
      }
      throw new Error("fake db: unsupported " + cmd.constructor.name);
    },
  };
}

const call = async (h, routeKey, body) => {
  const r = await h({ routeKey, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

test("players: add, then list sorted by name", async () => {
  const h = makeHandler(fakeDb(), "T");
  assert.deepEqual((await call(h, "GET /players")).body, { players: [] });
  const a = await call(h, "POST /players", { name: "  Zoe   Smith " });
  assert.equal(a.status, 201);
  assert.equal(a.body.player.name, "Zoe Smith");
  assert.match(a.body.player.id, /^[0-9a-f-]{36}$/);
  await call(h, "POST /players", { name: "al" });
  const l = await call(h, "GET /players");
  assert.deepEqual(l.body.players.map(p => p.name), ["al", "Zoe Smith"]);
});

test("players: names are unique ignoring case, and the existing player comes back", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const first = await call(h, "POST /players", { name: "Dave" });
  const again = await call(h, "POST /players", { name: "DAVE" });
  assert.equal(again.status, 409);
  assert.equal(again.body.player.id, first.body.player.id);
  assert.equal(again.body.player.name, "Dave");
  assert.equal([...db.rows.values()].filter(r => r.PK === "PLAYERS").length, 1);
  // a failed add writes nothing at all
  assert.equal([...db.rows.values()].filter(r => r.SK === "PROFILE").length, 1);
});

test("players: each one also gets its own record", async () => {
  const db = fakeDb(), h = makeHandler(db, "T");
  const { body } = await call(h, "POST /players", { name: "Bo" });
  const rec = db.rows.get(`PLAYER#${body.player.id}\u0000PROFILE`);
  assert.equal(rec.name, "Bo");
});

test("players: bad input is refused", async () => {
  const h = makeHandler(fakeDb(), "T");
  for (const body of [{}, { name: "" }, { name: "   " }, { name: 42 }, { name: "x".repeat(25) }, { name: "<b>Al</b>" }, { name: "A\u0007l" }]) {
    assert.equal((await call(h, "POST /players", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call(h, "POST /players", "not json")).status, 400);
  assert.equal((await call(h, "POST /players", "[1]")).status, 400);
  assert.equal((await call(h, "POST /players", { name: "x".repeat(24) })).status, 201);
});

test("venues: add with an optional area, unique by name", async () => {
  const h = makeHandler(fakeDb(), "T");
  const v = await call(h, "POST /venues", { name: "The Lewes Arms", area: "Lewes" });
  assert.equal(v.status, 201);
  assert.equal(v.body.venue.area, "Lewes");
  assert.equal((await call(h, "POST /venues", { name: "the lewes arms" })).status, 409);
  const b = await call(h, "POST /venues", { name: "The Basketmakers", area: "" });
  assert.equal(b.body.venue.area, undefined);
  assert.equal((await call(h, "POST /venues", { name: "X", area: "y".repeat(41) })).status, 400);
  assert.deepEqual((await call(h, "GET /venues")).body.venues.map(x => x.name), ["The Basketmakers", "The Lewes Arms"]);
});

test("players and venues are separate lists", async () => {
  const h = makeHandler(fakeDb(), "T");
  await call(h, "POST /players", { name: "Swan" });
  assert.equal((await call(h, "POST /venues", { name: "Swan" })).status, 201);
  assert.equal((await call(h, "GET /players")).body.players.length, 1);
});

test("unknown routes are 404 and database failures are 500 without details", async () => {
  const h = makeHandler({ send: async () => { throw new Error("boom: secret detail"); } }, "T");
  assert.equal((await call(h, "DELETE /players")).status, 404);
  const orig = console.error; console.error = () => {};
  const r = await call(h, "GET /players");
  console.error = orig;
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /secret/);
});
