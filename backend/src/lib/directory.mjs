// Players and venues: shared lists anyone can add to (REQUIREMENTS 4.3, 4.4).
// List entry  PK=PLAYERS|VENUES  SK=NAME#<lowercase name>  → id, name, created (+ area for venues)
// Record      PK=PLAYER#<id>|VENUE#<id>  SK=PROFILE      → the same details, for later per-item data
import { randomUUID } from "node:crypto";
import { QueryCommand, TransactWriteCommand, GetCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
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

/* ---------- housekeeping (organiser only) ---------- */

const profileKey = (k, id) => ({ PK: `${k.prefix}#${id}`, SK: "PROFILE" });
async function profile(db, table, kind, id) {
  if (typeof id !== "string" || !id) return null;
  const r = await db.send(new GetCommand({ TableName: table, Key: profileKey(KINDS[kind], id) }));
  return r.Item || null;
}

// Rename, and for venues change the area. → {status:"ok"|"missing"|"invalid"|"exists", item?, error?}
export async function update(db, table, kind, id, input) {
  const k = KINDS[kind], old = await profile(db, table, kind, id);
  if (!old) return { status: "missing" };
  const name = input && input.name != null ? cleanName(input.name, k.max) : old.name;
  if (!name) return { status: "invalid", error: `name must be 1 to ${k.max} characters, without < or >` };
  const next = { ...old, name };
  for (const [f, max] of k.fields) {
    if (!input || !(f in input)) continue;
    if (input[f] == null || input[f] === "") { delete next[f]; continue; }
    const v = cleanName(input[f], max);
    if (!v) return { status: "invalid", error: `${f} must be up to ${max} characters, without < or >` };
    next[f] = v;
  }
  const oldKey = "NAME#" + nameKey(old.name), newKey = "NAME#" + nameKey(name);
  const { PK, SK, ...details } = next;
  const items = [
    { Put: { TableName: table, Item: next, ConditionExpression: "attribute_exists(PK)" } },
    { Put: { TableName: table, Item: { PK: k.list, SK: newKey, ...details }, ConditionExpression: oldKey === newKey ? "attribute_exists(PK)" : "attribute_not_exists(PK)" } },
  ];
  if (oldKey !== newKey) items.push({ Delete: { TableName: table, Key: { PK: k.list, SK: oldKey } } });
  try {
    await db.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (e.name !== "TransactionCanceledException") throw e;
    const taken = await db.send(new GetCommand({ TableName: table, Key: { PK: k.list, SK: newKey } }));
    if (taken.Item && taken.Item.id !== id) return { status: "exists", item: publicView(kind, taken.Item) };
    throw e;
  }
  return { status: "ok", item: publicView(kind, next) };
}

// All items under one partition (optionally only SKs starting with a prefix)
export async function queryAll(db, table, pk, skPrefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
      ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
      ExclusiveStartKey,
    }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function batchWrite(db, table, requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let left = requests.slice(i, i + 25);
    for (let tries = 0; left.length; tries++) {
      if (tries > 5) throw new Error("could not finish a batch write");
      if (tries) await new Promise(r => setTimeout(r, 50 * 2 ** tries));
      const r = await db.send(new BatchWriteCommand({ RequestItems: { [table]: left } }));
      left = (r.UnprocessedItems && r.UnprocessedItems[table]) || [];
    }
  }
}

// Delete a player or venue. For a player, their game summaries go too (their stats), so they are no
// longer linked to any game; saved games keep the name as it was typed, like a guest's.
export async function remove(db, table, kind, id) {
  const k = KINDS[kind], old = await profile(db, table, kind, id);
  if (!old) return { status: "missing" };
  const own = (await queryAll(db, table, `${k.prefix}#${id}`)).filter(i => i.SK !== "PROFILE");
  await batchWrite(db, table, own.map(i => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })));
  await db.send(new TransactWriteCommand({
    TransactItems: [
      { Delete: { TableName: table, Key: profileKey(k, id) } },
      { Delete: { TableName: table, Key: { PK: k.list, SK: "NAME#" + nameKey(old.name) } } },
    ],
  }));
  return { status: "ok", item: publicView(kind, old) };
}

// Merge a duplicate player into another: the duplicate's games move across, then it is deleted.
// Safe to run again if it stops half way.
export async function mergePlayers(db, table, id, intoId) {
  if (id === intoId) return { status: "invalid", error: "a player can't be merged into themselves" };
  const [from, into] = await Promise.all([profile(db, table, "players", id), profile(db, table, "players", intoId)]);
  if (!from || !into) return { status: "missing" };
  const [mine, theirs] = await Promise.all([queryAll(db, table, `PLAYER#${id}`, "GAME#"), queryAll(db, table, `PLAYER#${intoId}`, "GAME#")]);
  const have = new Set(theirs.map(i => i.SK));
  // A game both were in (unlikely: one person, two names) keeps the surviving player's own result
  const moves = mine.filter(i => !have.has(i.SK)).map(i => ({ PutRequest: { Item: { ...i, PK: `PLAYER#${intoId}` } } }));
  await batchWrite(db, table, moves);
  await remove(db, table, "players", id);
  return { status: "ok", item: publicView("players", into), moved: moves.length };
}

function publicView(kind, i) {
  const v = { id: i.id, name: i.name, created: i.created };
  for (const [f] of KINDS[kind].fields) if (i[f]) v[f] = i[f];
  return v;
}
