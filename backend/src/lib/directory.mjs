// Players and venues: shared lists anyone can add to (REQUIREMENTS 4.3, 4.4).
// List entry  PK=PLAYERS|VENUES  SK=NAME#<lowercase name>  → id, name, created (+ area for venues)
// Record      PK=PLAYER#<id>|VENUE#<id>  SK=PROFILE      → the same details, for later per-item data
import { randomUUID } from "node:crypto";
import { QueryCommand, TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { cleanName, nameKey } from "./http.mjs";

export const KINDS = {
  players: { list: "PLAYERS", prefix: "PLAYER", max: 24, fields: [] },
  venues: { list: "VENUES", prefix: "VENUE", max: 60, fields: [["area", 40]] },
};

export async function listAll(db, table, kind) {
  const k = KINDS[kind], items = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": k.list },
      ExclusiveStartKey,
    }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.map(i => publicView(kind, i)).sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
}

// Returns {status:"created", item} | {status:"exists", item} | {status:"invalid", error}
export async function add(db, table, kind, input, now = new Date()) {
  const k = KINDS[kind];
  const name = cleanName(input && input.name, k.max);
  if (!name) return { status: "invalid", error: `name must be 1 to ${k.max} characters, without < or >` };
  const extra = {};
  for (const [f, max] of k.fields) {
    if (input[f] == null || input[f] === "") continue;
    const v = cleanName(input[f], max);
    if (!v) return { status: "invalid", error: `${f} must be up to ${max} characters, without < or >` };
    extra[f] = v;
  }
  const id = randomUUID(), created = now.toISOString(), key = "NAME#" + nameKey(name);
  const item = { id, name, created, ...extra };
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: table, Item: { PK: k.list, SK: key, ...item }, ConditionExpression: "attribute_not_exists(PK)" } },
        { Put: { TableName: table, Item: { PK: `${k.prefix}#${id}`, SK: "PROFILE", ...item }, ConditionExpression: "attribute_not_exists(PK)" } },
      ],
    }));
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const r = await db.send(new GetCommand({ TableName: table, Key: { PK: k.list, SK: key } }));
      if (r.Item) return { status: "exists", item: publicView(kind, r.Item) };
    }
    throw e;
  }
  return { status: "created", item: publicView(kind, item) };
}

function publicView(kind, i) {
  const v = { id: i.id, name: i.name, created: i.created };
  for (const [f] of KINDS[kind].fields) if (i[f]) v[f] = i[f];
  return v;
}
