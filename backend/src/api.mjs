// The Toads 31 API: one function, routed by API Gateway's route key
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { json, readBody } from "./lib/http.mjs";
import { listAll, add } from "./lib/directory.mjs";

const defaultDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function makeHandler(db = defaultDb, table = process.env.TABLE_NAME) {
  const routes = {
    "GET /players": () => list("players"),
    "POST /players": e => create("players", e),
    "GET /venues": () => list("venues"),
    "POST /venues": e => create("venues", e),
  };
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
