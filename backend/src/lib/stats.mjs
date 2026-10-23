// A registered player's stats (REQUIREMENTS 4.3), worked out from their game summaries
// (PLAYER#<id> / GAME#…, written when each game is saved). venueId narrows them to one pub.
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "./directory.mjs";

const avg = (pts, toads) => (toads ? Math.round((pts / toads) * 1000) / 1000 : null);

export async function playerStats(db, table, id, venueId) {
  if (typeof id !== "string" || !id) return null;
  const p = await db.send(new GetCommand({ TableName: table, Key: { PK: `PLAYER#${id}`, SK: "PROFILE" } }));
  if (!p.Item) return null;
  const all = (await queryAll(db, table, `PLAYER#${id}`, "GAME#")).sort((a, b) => b.finished.localeCompare(a.finished));

  // Pubs this player has played at, for the filter
  const pubs = new Map();
  for (const g of all) {
    const key = g.venueId || (g.venue ? "name:" + g.venue : null);
    if (!key) continue;
    const v = pubs.get(key) || { venueId: g.venueId || null, name: g.venue, played: 0 };
    v.played++; pubs.set(key, v);
  }
  const games = venueId ? all.filter(g => g.venueId === venueId) : all;

  const sum = (list) => {
    const pts = list.reduce((a, g) => a + g.pts, 0), toads = list.reduce((a, g) => a + g.toads, 0);
    return { played: list.length, won: list.filter(g => g.won).length, pts, toads, avg: avg(pts, toads) };
  };
  const byMonth = new Map();
  for (const g of games) {
    const m = g.finished.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) || []), g]);
  }
  // Best game: highest points per toad, at least 4 toads thrown; the latest wins a tie
  const best = games.filter(g => g.toads >= 4).reduce((b, g) => (!b || g.pts / g.toads > b.pts / b.toads ? g : b), null);
  // Head to head: games against each opponent, by player id (registered) or name (guest)
  const h2h = new Map();
  for (const g of games) {
    for (const o of g.opponents || []) {
      const key = o.playerId || "guest:" + o.name;
      const r = h2h.get(key) || { name: o.name, playerId: o.playerId || null, played: 0, won: 0, lost: 0 };
      r.played++;
      if (g.won) r.won++;
      else if (o.won) r.lost++;
      r.name = r.name || o.name;
      h2h.set(key, r);
    }
  }
  const view = g => ({
    gameId: g.gameId, finished: g.finished, mode: g.mode, venue: g.venue || null, venueId: g.venueId || null,
    won: g.won, pts: g.pts, toads: g.toads, avg: avg(g.pts, g.toads), sides: g.sides, rounds: g.rounds || null,
    side: g.side, winner: g.winner || null, opponents: (g.opponents || []).map(o => o.name),
  });
  return {
    player: { id, name: p.Item.name, created: p.Item.created },
    venueId: venueId || null,
    venues: [...pubs.values()].sort((a, b) => b.played - a.played),
    totals: sum(games),
    months: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, list]) => ({ month, ...sum(list) })),
    best: best ? view(best) : null,
    headToHead: [...h2h.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
    recent: games.slice(0, 10).map(view),
  };
}
