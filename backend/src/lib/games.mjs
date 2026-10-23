// Saved games (REQUIREMENTS 4.4). A Single or Duo game is sent once it is finished, with all its turns.
// The phone picks the game id, so sending the same game twice (a retry after a lost reply) saves it once.
//   PK=GAME#<id>      SK=META                     → mode, venue, sides, teams, winner, players found in the list
//   PK=GAME#<id>      SK=TURN#0001…               → one turn each
//   PK=PLAYER#<pid>   SK=GAME#<finished>#<id>     → that registered player's summary, for stats later
// META is written last, in the same transaction as the summaries, so a game with META is complete.
import { QueryCommand, TransactWriteCommand, GetCommand, BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { cleanName, nameKey } from "./http.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SIDES = 16, MAX_TURNS = 2000, TARGET = 31;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const time = v => (typeof v === "number" && v > 1.6e12 && v < Date.now() + 864e5 ? new Date(v).toISOString() : null);

// Checks the game and works out each side's result. Returns {game} or {error}.
export function checkGame(input) {
  const g = input || {};
  if (typeof g.id !== "string" || !UUID.test(g.id)) return { error: "id must be a UUID" };
  if (!["single", "duo"].includes(g.mode)) return { error: "mode must be single or duo" };
  if (!Array.isArray(g.sides) || !g.sides.length || g.sides.length > MAX_SIDES) return { error: `sides must list 1 to ${MAX_SIDES} names` };
  const sides = g.sides.map(n => cleanName(n, 24));
  if (sides.some(n => !n)) return { error: "a side name is not valid" };
  if (new Set(sides).size !== sides.length) return { error: "side names must be different" };
  let members = null;
  if (g.mode === "duo") {
    if (!g.members || typeof g.members !== "object") return { error: "a duo game needs its teams' members" };
    members = {};
    for (const s of sides) {
      const m = g.members[s];
      if (!Array.isArray(m) || m.length !== 2) return { error: `team ${s} needs two players` };
      members[s] = m.map(n => cleanName(n, 24));
      if (members[s].some(n => !n) || members[s][0] === members[s][1]) return { error: `team ${s} needs two different players` };
    }
    const all = Object.values(members).flat();
    if (new Set(all).size !== all.length) return { error: "a player can only be in one team" };
  }
  const venue = g.venue == null || g.venue === "" ? null : cleanName(g.venue, 60);
  if (g.venue && !venue) return { error: "venue is not valid" };
  if (!Array.isArray(g.turns) || !g.turns.length || g.turns.length > MAX_TURNS) return { error: `turns must list 1 to ${MAX_TURNS} turns` };

  // Replay the scores from 31: each turn must start from that side's points left, and the last one finishes
  const rem = sides.map(() => TARGET), turns = [];
  for (const [i, t] of g.turns.entries()) {
    if (!t || !isInt(t.p, 0, sides.length - 1) || !isInt(t.s, 0, 8) || !isInt(t.c, 1, 4) || !isInt(t.round, 1, 1000))
      return { error: `turn ${i + 1} is not valid` };
    const side = sides[t.p], before = rem[t.p], bust = t.s > before;
    // Toads per turn: 2, then 3, then 4, never more than the points left; a toad scores at most 2
    if (t.c > Math.min(i === 0 ? 2 : i === 1 ? 3 : 4, before) || t.s > 2 * t.c) return { error: `turn ${i + 1} has more points or toads than possible` };
    const who = cleanName(t.who, 24);
    if (t.before !== before || !!t.bust !== bust) return { error: `turn ${i + 1} does not match the scores before it` };
    if (!who || (members ? !members[side].includes(who) : who !== side)) return { error: `turn ${i + 1} has the wrong thrower` };
    if (rem.includes(0)) return { error: "turns carry on after the game was won" };
    if (!bust) rem[t.p] -= t.s;
    turns.push({ i: i + 1, side, who, s: t.s, c: t.c, bust, before, round: t.round, at: time(t.at) });
  }
  const won = rem.indexOf(0);
  if (won < 0) return { error: "the game is not finished" };
  const finished = time(g.finished) || new Date().toISOString();
  return { game: { id: g.id, mode: g.mode, sides, members, venue, winner: sides[won], rounds: turns.at(-1).round, started: time(g.started), finished, turns } };
}

// Points and toads per person (the thrower), the same sums as the app's scoresheet
function tally(game) {
  const out = new Map();
  for (const t of game.turns) {
    const r = out.get(t.who) || { pts: 0, toads: 0 };
    r.pts += t.s; r.toads += t.c; out.set(t.who, r);
  }
  return out;
}

const getMeta = (db, table, id) => db.send(new GetCommand({ TableName: table, Key: { PK: `GAME#${id}`, SK: "META" } }));
const lookup = (db, table, list, name) =>
  db.send(new GetCommand({ TableName: table, Key: { PK: list, SK: "NAME#" + nameKey(name) } })).then(r => r.Item || null);

// Returns {status:"created"|"exists", game} or {status:"invalid", error}
export async function saveGame(db, table, input, now = new Date()) {
  const c = checkGame(input);
  if (c.error) return { status: "invalid", error: c.error };
  const g = c.game;
  const old = await getMeta(db, table, g.id);
  if (old.Item) return { status: "exists", game: summary(old.Item) };

  // People are the players (Single) or the team members (Duo); registered ones get their id
  const people = g.members ? Object.values(g.members).flat() : g.sides;
  const found = await Promise.all(people.map(n => lookup(db, table, "PLAYERS", n)));
  const venue = g.venue ? await lookup(db, table, "VENUES", g.venue) : null;
  const totals = tally(g);
  const players = people.map((name, i) => {
    const side = g.members ? g.sides.find(s => g.members[s].includes(name)) : name;
    const t = totals.get(name) || { pts: 0, toads: 0 };
    return { name, playerId: found[i] ? found[i].id : null, side, won: side === g.winner, pts: t.pts, toads: t.toads };
  });

  // Turns first: rewriting them on a retry is harmless, and nothing points at them until META exists
  const puts = g.turns.map(t => ({ PutRequest: { Item: { PK: `GAME#${g.id}`, SK: "TURN#" + String(t.i).padStart(4, "0"), ...t } } }));
  for (let i = 0; i < puts.length; i += 25) await batchWrite(db, table, puts.slice(i, i + 25));

  const meta = {
    PK: `GAME#${g.id}`, SK: "META", id: g.id, mode: g.mode, sides: g.sides, members: g.members,
    venue: venue ? venue.name : g.venue, venueId: venue ? venue.id : null, winner: g.winner, rounds: g.rounds,
    turns: g.turns.length, players, started: g.started, finished: g.finished, saved: now.toISOString(),
  };
  const mine = players.filter(p => p.playerId).map(p => ({
    Put: {
      TableName: table,
      Item: {
        PK: `PLAYER#${p.playerId}`, SK: `GAME#${g.finished}#${g.id}`, gameId: g.id, mode: g.mode, finished: g.finished,
        venue: meta.venue, venueId: meta.venueId, side: p.side, won: p.won, pts: p.pts, toads: p.toads, sides: g.sides.length,
        rounds: g.rounds, winner: g.winner,
        // everyone on another side, for head-to-head records
        opponents: players.filter(o => o.side !== p.side).map(o => ({ name: o.name, playerId: o.playerId, won: o.won })),
      },
    },
  }));
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [{ Put: { TableName: table, Item: meta, ConditionExpression: "attribute_not_exists(PK)" } }, ...mine],
    }));
  } catch (e) {
    // Two copies of the same game arriving together: the other one saved it
    if (e.name === "TransactionCanceledException") {
      const r = await getMeta(db, table, g.id);
      if (r.Item) return { status: "exists", game: summary(r.Item) };
    }
    throw e;
  }
  return { status: "created", game: summary(meta) };
}

async function batchWrite(db, table, requests) {
  let left = requests;
  for (let tries = 0; left.length; tries++) {
    if (tries) await new Promise(r => setTimeout(r, 50 * 2 ** tries));
    if (tries > 5) throw new Error("could not write all turns");
    const r = await db.send(new BatchWriteCommand({ RequestItems: { [table]: left } }));
    left = (r.UnprocessedItems && r.UnprocessedItems[table]) || [];
  }
}

// The whole game, turns included, or null
export async function getGame(db, table, id) {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({
      TableName: table, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": `GAME#${id}` }, ExclusiveStartKey,
    }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const meta = items.find(i => i.SK === "META");
  if (!meta) return null;
  const turns = items.filter(i => i.SK.startsWith("TURN#")).sort((a, b) => a.i - b.i).map(({ PK, SK, ...t }) => t);
  return { ...summary(meta), turns };
}

// The latest saved games, newest first, for checking what arrived. It reads the whole table,
// which is fine at pub scale; the stats in step 6 read each player's own summaries instead.
const FIELDS = ["id", "mode", "venue", "winner", "sides", "turns", "finished", "saved"];
export async function recentGames(db, table, limit = 20) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new ScanCommand({
      TableName: table, FilterExpression: "SK = :m", ExpressionAttributeValues: { ":m": "META" }, ExclusiveStartKey,
      // Names go through placeholders, since some (like "mode") may be DynamoDB reserved words
      ProjectionExpression: FIELDS.map((_, n) => "#f" + n).join(", "),
      ExpressionAttributeNames: Object.fromEntries(FIELDS.map((f, n) => ["#f" + n, f])),
    }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.sort((a, b) => (b.finished || "").localeCompare(a.finished || "")).slice(0, limit);
}

function summary(m) {
  const { PK, SK, ...v } = m;
  return v;
}
