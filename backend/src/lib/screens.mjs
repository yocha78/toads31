// Big screen for a practice game: the scoring phone posts the game as it goes, a TV polls it.
//   PK=SCREEN#<code>  SK=META → key (only the phone that made the screen can change it), game, ver, updated, ttl
// A screen is forgotten 24 hours after its last change (DynamoDB TTL on "ttl", and GET checks too).
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { cleanName } from "./http.mjs";

const CODE = /^[A-Z0-9]{6}$/, KEY = /^[A-Za-z0-9_-]{16,64}$/, DAY = 864e5;
const MAX_SIDES = 16, MAX_TURNS = 600;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const pk = code => ({ PK: "SCREEN#" + code, SK: "META" });

// Keeps only what the big screen shows, checked. Returns {game} or {error}.
export function checkScreenGame(input) {
  const g = input || {};
  if (!Array.isArray(g.gp) || !g.gp.length || g.gp.length > MAX_SIDES) return { error: `gp must list 1 to ${MAX_SIDES} names` };
  const gp = g.gp.map(n => cleanName(n, 24));
  if (gp.some(n => !n) || new Set(gp).size !== gp.length) return { error: "side names are not valid" };
  if (!Array.isArray(g.rem) || g.rem.length !== gp.length || !g.rem.every(v => isInt(v, 0, 31))) return { error: "rem is not valid" };
  if (!isInt(g.cur, 0, gp.length - 1) || !isInt(g.round, 1, 9999)) return { error: "cur or round is not valid" };
  if (!Array.isArray(g.hist) || g.hist.length > MAX_TURNS) return { error: `hist must list at most ${MAX_TURNS} turns` };
  const hist = [];
  for (const h of g.hist) {
    if (!h || !isInt(h.p, 0, gp.length - 1) || !isInt(h.s, 0, 31) || !isInt(h.before, 0, 31) || !isInt(h.round, 1, 9999)) return { error: "a turn is not valid" };
    const who = cleanName(h.who, 24);
    if (!who) return { error: "a turn is not valid" };
    hist.push({ p: h.p, s: h.s, before: h.before, round: h.round, bust: !!h.bust, who, ...(isInt(h.c, 1, 4) ? { c: h.c } : {}) });
  }
  let members;
  if (g.members != null) {
    if (typeof g.members !== "object") return { error: "members is not valid" };
    members = {};
    for (const s of gp) {
      const m = g.members[s];
      if (!Array.isArray(m) || m.length !== 2) return { error: "members is not valid" };
      members[s] = m.map(n => cleanName(n, 24));
      if (members[s].some(n => !n)) return { error: "members is not valid" };
    }
  }
  const wins = {};
  if (g.wins != null && typeof g.wins === "object") for (const s of gp) if (isInt(g.wins[s], 1, 999)) wins[s] = g.wins[s];
  const winner = g.winner == null ? null : gp.includes(g.winner) ? g.winner : undefined;
  if (winner === undefined) return { error: "winner is not valid" };
  // Before the game: the throwing order being picked on the phone (sides so far, closest first)
  let picking;
  if (g.picking != null) {
    if (!Array.isArray(g.picking) || g.picking.length > gp.length) return { error: "picking is not valid" };
    picking = g.picking.map(n => cleanName(n, 24));
    if (picking.some(n => !gp.includes(n)) || new Set(picking).size !== picking.length) return { error: "picking is not valid" };
  }
  return { game: { gp, rem: g.rem.slice(), cur: g.cur, round: g.round, hist, ...(members ? { members } : {}), ...(picking ? { picking } : {}), wins, done: !!g.done, winner } };
}

// → {status, body}
export async function putScreen(db, table, code, body, now = Date.now()) {
  if (!CODE.test(code || "")) return { status: 404, body: { error: "no such screen" } };
  if (!body || !KEY.test(body.key || "")) return { status: 400, body: { error: "key is not valid" } };
  const c = checkScreenGame(body.game);
  if (c.error) return { status: 400, body: { error: c.error } };
  const old = (await db.send(new GetCommand({ TableName: table, Key: pk(code) }))).Item;
  const live = old && old.ttl * 1000 > now;
  if (live && old.key !== body.key) return { status: 403, body: { error: "this screen belongs to another phone" } };
  const ver = (live ? old.ver : 0) + 1;
  await db.send(new PutCommand({ TableName: table, Item: { ...pk(code), key: body.key, game: c.game, ver, updated: new Date(now).toISOString(), ttl: Math.floor((now + DAY) / 1000) } }));
  return { status: 200, body: { ver } };
}

// → the screen {code, game, ver, updated}, {same:true} when ver is unchanged since `since`, or null
export async function getScreen(db, table, code, since, now = Date.now()) {
  if (!CODE.test(code || "")) return null;
  const s = (await db.send(new GetCommand({ TableName: table, Key: pk(code) }))).Item;
  if (!s || s.ttl * 1000 <= now) return null;
  if (since != null && String(s.ver) === String(since)) return { same: true, ver: s.ver };
  return { code, game: s.game, ver: s.ver, updated: s.updated };
}
