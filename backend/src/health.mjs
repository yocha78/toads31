// GET /health: proves the API, the function and the database are wired together
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({});

export async function handler() {
  let database = "ok";
  try {
    await db.send(new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: { PK: { S: "HEALTH" }, SK: { S: "CHECK" } } }));
  } catch (e) {
    console.error("health: database check failed", e);
    database = "unreachable";
  }
  const ok = database === "ok";
  return {
    statusCode: ok ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ ok, stage: process.env.STAGE, database, time: new Date().toISOString() }),
  };
}
