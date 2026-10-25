// The Toads 31 API: one function, routed by API Gateway's route key
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { json, readBody } from "./lib/http.mjs";
import { listAll, add, update, remove, mergePlayers } from "./lib/directory.mjs";
import { saveGame, getGame, recentGames, deleteGame, deleteGames } from "./lib/games.mjs";
import { login, isOrganiser, parameterStorePassword } from "./lib/auth.mjs";
import { playerStats } from "./lib/stats.mjs";
import {
  createTournament, getTournament, listTournaments, listAllTournaments, claimTable, releaseTable, playTable, endTournament,
  deleteTournament, editTournament, restartTournament,
} from "./lib/tournaments.mjs";

const defaultDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function makeHandler(db = defaultDb, table = process.env.TABLE_NAME, getPassword = parameterStorePassword()) {
  const ONE = { players: "player", venues: "venue" };
  const id = e => (e.pathParameters || {}).id;
  // Organiser-only routes answer 401 without a valid token
  const organiser = fn => async e => ((await isOrganiser(getPassword, e)) ? fn(e) : json(401, { error: "organiser login needed" }));
  const housekeeping = (kind, r) =>
    r.status === "missing" ? json(404, { error: `no such ${ONE[kind]}` })
    : r.status === "invalid" ? json(400, { error: r.error })
    : r.status === "exists" ? json(409, { error: "that name is already taken", [ONE[kind]]: r.item })
    : json(200, { [ONE[kind]]: r.item, ...(r.moved != null ? { moved: r.moved } : {}) });
  const routes = {
    "POST /auth/organiser": async e => {
      const r = await login(getPassword, readBody(e));
      return r.token ? json(200, r) : json(r.status, { error: r.error });
    },
    "GET /players/{id}/stats": async e => {
      const venue = (e.queryStringParameters || {}).venue || null;
      const stats = await playerStats(db, table, id(e), venue);
      return stats ? json(200, stats) : json(404, { error: "no such player" });
    },
    "PATCH /players/{id}": organiser(async e => housekeeping("players", await update(db, table, "players", id(e), readBody(e) || {}))),
    "DELETE /players/{id}": organiser(async e => housekeeping("players", await remove(db, table, "players", id(e)))),
    "POST /players/{id}/merge": organiser(async e => housekeeping("players", await mergePlayers(db, table, id(e), (readBody(e) || {}).into))),
    "PATCH /venues/{id}": organiser(async e => housekeeping("venues", await update(db, table, "venues", id(e), readBody(e) || {}))),
    "DELETE /venues/{id}": organiser(async e => housekeeping("venues", await remove(db, table, "venues", id(e)))),
    "GET /players": () => list("players"),
    "POST /players": e => create("players", e),
    "GET /venues": () => list("venues"),
    // Only the organiser adds pubs, so the list stays tidy; everyone picks from it
    "POST /venues": organiser(e => create("venues", e)),
    "POST /games": async e => {
      const body = readBody(e);
      if (!body) return json(400, { error: "body must be a JSON object" });
      // Only the server links a game to a tournament
      const r = await saveGame(db, table, { ...body, tournament: undefined });
      if (r.status === "invalid") return json(400, { error: r.error });
      return json(r.status === "created" ? 201 : 200, { game: r.game });
    },
    "GET /games": async () => json(200, { games: await recentGames(db, table) }),
    "POST /tournaments": organiser(async e => {
      const r = await createTournament(db, table, readBody(e));
      return r.status === "invalid" ? json(400, { error: r.error }) : json(201, { tournament: r.tournament });
    }),
    // Organiser clean-up: one game, one player's games, or every saved game (?confirm=all, so it is never an accident)
    "DELETE /games/{id}": organiser(async e =>
      (await deleteGame(db, table, id(e))) ? json(200, { deleted: 1 }) : json(404, { error: "no such game" })),
    "DELETE /players/{id}/games": organiser(async e => json(200, { deleted: await deleteGames(db, table, { player: id(e) }) })),
    "DELETE /games": organiser(async e =>
      (e.queryStringParameters || {}).confirm === "all" ? json(200, { deleted: await deleteGames(db, table, "all") }) : json(400, { error: "add ?confirm=all" })),
    // ?all=1 lists every tournament with its progress (the organiser's management list)
    "GET /tournaments": async e => json(200, {
      tournaments: (e.queryStringParameters || {}).all ? await listAllTournaments(db, table) : await listTournaments(db, table),
    }),
    "PATCH /tournaments/{id}": organiser(async e => reply(await editTournament(db, table, id(e), readBody(e)))),
    "POST /tournaments/{id}/restart": organiser(async e => reply(await restartTournament(db, table, id(e), readBody(e)))),
    "GET /tournaments/{id}": async e => {
      const t = await getTournament(db, table, id(e), (e.queryStringParameters || {}).since);
      return t ? json(200, t.same ? t : { tournament: t }) : json(404, { error: "no such tournament" });
    },
    "POST /tournaments/{id}/tables/{n}/claim": async e => reply(await claimTable(db, table, id(e), e.pathParameters.n, readBody(e))),
    "POST /tournaments/{id}/tables/{n}/release": async e =>
      reply(await releaseTable(db, table, id(e), e.pathParameters.n, readBody(e), await isOrganiser(getPassword, e))),
    "POST /tournaments/{id}/tables/{n}/play": async e =>
      reply(await playTable(db, table, id(e), e.pathParameters.n, readBody(e), await isOrganiser(getPassword, e))),
    "POST /tournaments/{id}/end": organiser(async e => reply(await endTournament(db, table, id(e)))),
    "DELETE /tournaments/{id}": organiser(async e => {
      const r = await deleteTournament(db, table, id(e), (e.queryStringParameters || {}).games === "delete");
      return r ? json(200, r) : json(404, { error: "no such tournament" });
    }),
    "GET /games/{id}": async e => {
      const game = await getGame(db, table, (e.pathParameters || {}).id);
      return game ? json(200, { game }) : json(404, { error: "no such game" });
    },
  };
  const reply = r => json(r.status, r.body);
  async function list(kind) {
    return json(200, { [kind]: await listAll(db, table, kind) });
  }
  async function create(kind, event) {
    const body = readBody(event);
    if (!body) return json(400, { error: "body must be a JSON object" });
    const r = await add(db, table, kind, body);
    const one = kind === "players" ? "player" : "venue";
    if (r.status === "invalid") return json(400, { error: r.error });
    if (r.status === "exists") return json(409, { error: "already exists", [one]: r.item });
    return json(201, { [one]: r.item });
  }
  return async function handler(event) {
    const route = routes[event.routeKey];
    if (!route) return json(404, { error: "not found" });
    try {
      return await route(event);
    } catch (e) {
      console.error(event.routeKey, e);
      return json(500, { error: "something went wrong" });
    }
  };
}

export const handler = makeHandler();
