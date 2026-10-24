// Live tournaments (REQUIREMENTS 4.5). The organiser creates one; anyone with its link follows the tables
// and bracket; whoever has the scoring PIN claims a table and scores it from their own phone.
//   PK=TOURN#<code>  SK=META               → name, venue, status, ver, state (the bracket as JSON), pin, claims, players
//   PK=TOURNS        SK=T#<created>#<code> → list entry, so phones can find tournaments without the link
// The bracket is one item, changed with the same rules as the app (rules.cjs, a copy of app/js/rules.js).
// Every write is conditional on the version read, so two tables scoring at once never overwrite each other:
// the loser of a race reads again and reapplies its change.
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import Toads from "./rules.cjs";
import { cleanName, nameKey } from "./http.mjs";
import { saveGame, deleteGame, deleteGames } from "./games.mjs";

const CODE = /^[A-Z0-9]{6}$/, CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const MAX_PLAYERS = 32, MAX_TABLES = 8, LIST_DAYS = 3;
const key = id => ({ PK: `TOURN#${id}`, SK: "META" });
const sha = s => createHash("sha256").update(s).digest("hex");
const same = (a, b) => timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
const pinHash = (salt, pin) => sha(`toads31 pin:${salt}:${pin}`);
const slow = () => new Promise(r => setTimeout(r, 400)); // slows down PIN guessing

// What everyone may see: never the PIN or the claim tokens
export function publicView(item) {
  const claims = {};
  for (const [n, c] of Object.entries(item.claims || {})) claims[n] = { tag: c.tag, at: c.at };
  return {
    id: item.id, name: item.name, venue: item.venue || null, created: item.created, status: item.status,
    ver: item.ver, tour: JSON.parse(item.state), claims,
  };
}

// → {status:"created", tournament} | {status:"invalid", error}
export async function createTournament(db, table, input, now = new Date()) {
  const b = input || {};
  const name = cleanName(b.name, 40);
  if (!name) return { status: "invalid", error: "name must be 1 to 40 characters, without < or >" };
  const venue = b.venue == null || b.venue === "" ? null : cleanName(b.venue, 60);
  if (b.venue && !venue) return { status: "invalid", error: "venue is not valid" };
  if (!Array.isArray(b.players) || b.players.length < 2 || b.players.length > MAX_PLAYERS)
    return { status: "invalid", error: `players must list 2 to ${MAX_PLAYERS} names` };
  const players = b.players.map(p => cleanName(p, 24));
  if (players.some(p => !p)) return { status: "invalid", error: "a player name is not valid" };
  if (new Set(players.map(nameKey)).size !== players.length) return { status: "invalid", error: "player names must be different" };
  if (!Number.isInteger(b.tables) || b.tables < 1 || b.tables > MAX_TABLES) return { status: "invalid", error: `tables must be 1 to ${MAX_TABLES}` };
  if (typeof b.pin !== "string" || !/^\d{4,8}$/.test(b.pin)) return { status: "invalid", error: "the PIN must be 4 to 8 digits" };

  const tour = Toads.buildTour(players, b.tables, b.format === "byes" ? "byes" : "quali");
  Toads.settle(tour); Toads.assignTables(tour);
  const salt = randomBytes(8).toString("hex"), created = now.toISOString();
  for (let tries = 0; tries < 5; tries++) {
    const id = Array.from({ length: 6 }, () => CHARS[randomInt(CHARS.length)]).join("");
    const item = {
      ...key(id), id, name, venue, created, status: "live", ver: 1, state: JSON.stringify(tour),
      pin: { salt, hash: pinHash(salt, b.pin) }, claims: {}, players,
    };
    try {
      await db.send(new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
          { Put: { TableName: table, Item: { PK: "TOURNS", SK: `T#${created}#${id}`, id, name, venue, created } } },
        ],
      }));
      return { status: "created", tournament: publicView(item) };
    } catch (e) {
      if (e.name !== "TransactionCanceledException") throw e; // that code is taken: pick another
    }
  }
  throw new Error("could not find a free tournament code");
}

const load = async (db, table, id) =>
  typeof id === "string" && CODE.test(id) ? (await db.send(new GetCommand({ TableName: table, Key: key(id) }))).Item || null : null;

// since = the version the phone already has: then only {same:true} comes back, to keep polling cheap
export async function getTournament(db, table, id, since) {
  const item = await load(db, table, id);
  if (!item) return null;
  if (since != null && String(item.ver) === String(since)) return { same: true, ver: item.ver };
  return publicView(item);
}

// Tournaments created in the last few days, newest first
export async function listTournaments(db, table, now = new Date()) {
  const from = new Date(now - LIST_DAYS * 864e5).toISOString();
  const r = await db.send(new QueryCommand({
    TableName: table, KeyConditionExpression: "PK = :pk AND SK >= :from",
    ExpressionAttributeValues: { ":pk": "TOURNS", ":from": `T#${from}` }, ScanIndexForward: false, Limit: 20,
  }));
  return (r.Items || []).map(({ id, name, venue, created }) => ({ id, name, venue: venue || null, created }));
}

// Organiser's list: every tournament, newest first, with how far it got
export async function listAllTournaments(db, table) {
  const r = await db.send(new QueryCommand({
    TableName: table, KeyConditionExpression: "PK = :pk AND SK >= :from",
    ExpressionAttributeValues: { ":pk": "TOURNS", ":from": "T#" }, ScanIndexForward: false, Limit: 100,
  }));
  const items = await Promise.all((r.Items || []).map(i => load(db, table, i.id)));
  return items.filter(Boolean).map(item => {
    const t = JSON.parse(item.state);
    return {
      id: item.id, name: item.name, venue: item.venue || null, created: item.created, status: item.status,
      players: t.n, tables: t.tables, champion: t.champion || null, format: t.format,
      played: Toads.allMatches(t).filter(({ m }) => m.winner && !m.bye).length,
    };
  });
}

// Read, change, write if nobody else wrote in between, otherwise start again.
// change(item, tour) → {reply} to answer without writing, or {reply, write:true} after changing item/tour
async function mutate(db, table, id, change) {
  for (let tries = 0; tries < 8; tries++) {
    const item = await load(db, table, id);
    if (!item) return { status: 404, body: { error: "no such tournament" } };
    const tour = JSON.parse(item.state), r = await change(item, tour);
    if (!r.write) return r.reply;
    const was = item.ver;
    item.ver = was + 1; item.state = JSON.stringify(tour);
    try {
      await db.send(new PutCommand({
        TableName: table, Item: item, ConditionExpression: "ver = :v", ExpressionAttributeValues: { ":v": was },
      }));
      if (r.after) await r.after(item);
      return { ...r.reply, body: { ...r.reply.body, ver: item.ver } };
    } catch (e) {
      if (e.name !== "ConditionalCheckFailedException") throw e;
    }
  }
  return { status: 503, body: { error: "busy, try again" } };
}

const tableNo = (tour, n) => (/^\d+$/.test(String(n)) && Number(n) < tour.tables ? Number(n) : null);
const closed = item => item.status !== "live" ? { reply: { status: 409, body: { error: "the tournament has ended" } } } : null;

// Claim table n with the PIN. takeover = take it from another phone (e.g. its battery died).
// → token (kept by the phone, sent with every score) and tag (shown to everyone, so a phone sees it lost the claim)
export async function claimTable(db, table, id, n, input, now = new Date()) {
  const b = input || {};
  const first = await load(db, table, id);
  if (!first) return { status: 404, body: { error: "no such tournament" } };
  if (typeof b.pin !== "string" || !same(pinHash(first.pin.salt, b.pin), first.pin.hash)) {
    await slow();
    return { status: 403, body: { error: "wrong PIN" } };
  }
  const token = randomBytes(18).toString("base64url"), tag = randomBytes(4).toString("hex");
  return mutate(db, table, id, (item, tour) => {
    const k = tableNo(tour, n);
    if (k == null) return { reply: { status: 404, body: { error: "no such table" } } };
    const shut = closed(item);
    if (shut) return shut;
    if (item.claims[k] && !b.takeover) return { reply: { status: 409, body: { error: "another phone is scoring this table", claimed: true } } };
    item.claims[k] = { hash: sha(token), tag, at: now.toISOString() };
    return { write: true, reply: { status: 200, body: { token, tag, table: k } } };
  });
}

const holds = (item, k, token) => !!(item.claims[k] && typeof token === "string" && same(sha(token), item.claims[k].hash));

// Give the table back: the phone scoring it, or the organiser
export async function releaseTable(db, table, id, n, input, organiser) {
  const token = (input || {}).token;
  return mutate(db, table, id, (item, tour) => {
    const k = tableNo(tour, n);
    if (k == null) return { reply: { status: 404, body: { error: "no such table" } } };
    if (!item.claims[k]) return { reply: { status: 200, body: { released: true, ver: item.ver } } };
    if (!organiser && !holds(item, k, token)) return { reply: { status: 403, body: { error: "this phone isn't scoring that table" } } };
    delete item.claims[k];
    return { write: true, reply: { status: 200, body: { released: true } } };
  });
}

// One change from the phone scoring table n (or the organiser): see applyOp in rules.js.
// A change already applied (a resend) answers OK without changing anything.
export async function playTable(db, table, id, n, input, organiser, now = new Date()) {
  const b = input || {}, op = b.op && typeof b.op === "object" ? { ...b.op } : null;
  if (!op) return { status: 400, body: { error: "op is missing" } };
  // Times come from the phone (it may have been offline); anything odd becomes now
  op.at = typeof op.at === "number" && op.at > now - 864e5 && op.at <= +now + 6e4 ? op.at : +now;
  let finished = null, undone = null;
  return mutate(db, table, id, (item, tour) => {
    const k = tableNo(tour, n);
    if (k == null) return { reply: { status: 404, body: { error: "no such table" } } };
    const shut = closed(item);
    if (shut) return shut;
    if (!organiser && !holds(item, k, b.token)) return { reply: { status: 403, body: { error: "this phone isn't scoring that table", lost: true } } };
    const r = Toads.applyOp(tour, k, op);
    if (r.ask) return { reply: { status: 400, body: { error: "say how many toads were thrown", ask: r.ask } } };
    if (r.error) return { reply: { status: r.conflict ? 409 : 400, body: { error: r.error } } };
    if (r.dup) return { reply: { status: 200, body: { dup: true, ver: item.ver } } };
    const m = Toads.matchOf(tour, op.ri, op.mi);
    finished = r.finished ? m.game : null;
    undone = op.t === "undoWin" ? op.gameId : null;
    return {
      write: true, reply: { status: 200, body: { ok: true } },
      // The game goes into the players' stats; an undone win takes it out again
      after: async it => {
        try {
          if (finished) await saveGame(db, table, {
            ...Toads.gameRecord(finished, { id: finished.id, mode: "single", venue: it.venue, started: finished.started, finished: op.at }),
            tournament: { id: it.id, name: it.name },
          });
          if (undone) await deleteGame(db, table, undone);
        } catch (e) {
          console.error("tournament game stats", e); // the tournament itself is saved; only the stats missed it
        }
      },
    };
  });
}

// Every name in the bracket, in the order the tournament was drawn
function drawOrder(item, tour) {
  if (Array.isArray(item.players)) return item.players;
  if (tour.quali) return tour.quali.draw.slice();
  return tour.rounds[0].flatMap(m => [m.a, m.b]).filter(Boolean);
}
// A player's name, everywhere it appears in the bracket
function renameIn(tour, from, to) {
  const swap = v => (v === from ? to : v);
  for (const { m } of Toads.allMatches(tour)) {
    m.a = swap(m.a); m.b = swap(m.b); m.winner = swap(m.winner);
    if (m.game) {
      m.game.gp = m.game.gp.map(swap);
      for (const h of m.game.hist) h.who = swap(h.who);
    }
    for (const g of m.games || []) if (g[from]) { g[to] = g[from]; delete g[from]; }
  }
  if (tour.quali) tour.quali.draw = tour.quali.draw.map(swap);
  tour.champion = swap(tour.champion);
}
const listKey = item => ({ PK: "TOURNS", SK: `T#${item.created}#${item.id}` });
const putList = (db, table, item) =>
  db.send(new PutCommand({ TableName: table, Item: { ...listKey(item), id: item.id, name: item.name, venue: item.venue, created: item.created } }));

// Organiser: change the name, venue, PIN or number of tables, or correct a player's name.
// input {name?, venue?, pin?, tables?, rename?: {from, to}}
export async function editTournament(db, table, id, input) {
  const b = input || {};
  const name = b.name === undefined ? undefined : cleanName(b.name, 40);
  if (name === null || name === "") return { status: 400, body: { error: "name must be 1 to 40 characters, without < or >" } };
  const venue = b.venue === undefined ? undefined : b.venue === null || b.venue === "" ? null : cleanName(b.venue, 60);
  if (b.venue && !venue) return { status: 400, body: { error: "venue is not valid" } };
  if (b.pin !== undefined && (typeof b.pin !== "string" || !/^\d{4,8}$/.test(b.pin))) return { status: 400, body: { error: "the PIN must be 4 to 8 digits" } };
  if (b.tables !== undefined && (!Number.isInteger(b.tables) || b.tables < 1 || b.tables > MAX_TABLES)) return { status: 400, body: { error: `tables must be 1 to ${MAX_TABLES}` } };
  let rename = null;
  if (b.rename) {
    const to = cleanName(b.rename.to, 24);
    if (typeof b.rename.from !== "string" || !to) return { status: 400, body: { error: "the new name must be 1 to 24 characters, without < or >" } };
    rename = { from: b.rename.from, to };
  }
  const r = await mutate(db, table, id, (item, tour) => {
    if (rename && rename.from !== rename.to) {
      const names = drawOrder(item, tour);
      if (!names.includes(rename.from)) return { reply: { status: 404, body: { error: `${rename.from} isn't in this tournament` } } };
      if (names.some(n => n !== rename.from && nameKey(n) === nameKey(rename.to))) return { reply: { status: 409, body: { error: `${rename.to} is already in this tournament` } } };
      renameIn(tour, rename.from, rename.to);
      item.players = names.map(n => (n === rename.from ? rename.to : n));
    }
    if (b.tables !== undefined && b.tables !== tour.tables) {
      const k = Math.min(b.tables, Math.max(1, Math.floor(tour.n / 2)));
      // A table being taken away must not have a game going on it
      const busy = Toads.allMatches(tour).find(({ m }) => m.table != null && m.table >= k && !m.winner && m.game && !m.game.done);
      if (busy) return { reply: { status: 409, body: { error: `table ${busy.m.table + 1} has a game going: finish it first` } } };
      for (const { m } of Toads.allMatches(tour)) if (m.table != null && m.table >= k && !m.winner) m.table = null;
      for (const n of Object.keys(item.claims)) if (+n >= k) delete item.claims[n];
      tour.tables = k;
      Toads.assignTables(tour);
    }
    if (name !== undefined) item.name = name;
    if (venue !== undefined) item.venue = venue;
    if (b.pin !== undefined) { const salt = randomBytes(8).toString("hex"); item.pin = { salt, hash: pinHash(salt, b.pin) }; }
    return { write: true, reply: { status: 200, body: { saved: true } }, after: it => (name !== undefined || venue !== undefined) && putList(db, table, it) };
  });
  return r;
}

// Organiser: start again from the draw, with the same players and tables. Phones scoring it lose their
// tables, and (unless keepGames) the games it already saved leave the players' stats.
export async function restartTournament(db, table, id, input) {
  const keepGames = !!(input || {}).keepGames;
  const r = await mutate(db, table, id, (item, tour) => {
    const fresh = Toads.buildTour(drawOrder(item, tour), tour.tables, tour.format === "byes" ? "byes" : "quali");
    Toads.settle(fresh); Toads.assignTables(fresh);
    Object.keys(tour).forEach(k => delete tour[k]); Object.assign(tour, fresh);
    item.status = "live"; item.claims = {};
    return { write: true, reply: { status: 200, body: { restarted: true } } };
  });
  if (r.status === 200 && !keepGames) r.body.gamesDeleted = await deleteGames(db, table, { tournament: id });
  return r;
}

// Organiser: end it (scoring stops, everyone still sees the result) or delete it
export async function endTournament(db, table, id) {
  return mutate(db, table, id, item => {
    if (item.status === "ended") return { reply: { status: 200, body: { ended: true, ver: item.ver } } };
    item.status = "ended"; item.claims = {};
    return { write: true, reply: { status: 200, body: { ended: true } } };
  });
}
// withGames: also take its saved games out of the players' stats. → false when there is no such tournament
export async function deleteTournament(db, table, id, withGames) {
  const item = await load(db, table, id);
  if (!item) return false;
  await db.send(new DeleteCommand({ TableName: table, Key: listKey(item) }));
  await db.send(new DeleteCommand({ TableName: table, Key: key(item.id) }));
  return { deleted: true, gamesDeleted: withGames ? await deleteGames(db, table, { tournament: item.id }) : 0 };
}
