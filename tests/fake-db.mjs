// Just enough DynamoDB for the API tests: Query on PK, Get, BatchWrite, and all-or-nothing
// TransactWrite with attribute_not_exists conditions
import { QueryCommand, TransactWriteCommand, GetCommand, BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

export function fakeDb() {
  const rows = new Map(), k = (pk, sk) => pk + "\u0000" + sk;
  return {
    rows,
    calls: [],
    async send(cmd) {
      const i = cmd.input;
      this.calls.push(cmd.constructor.name);
      if (cmd instanceof QueryCommand) {
        const pk = i.ExpressionAttributeValues[":pk"], sk = i.ExpressionAttributeValues[":sk"] || "";
        return { Items: [...rows.values()].filter(r => r.PK === pk && r.SK.startsWith(sk)).sort((a, b) => a.SK.localeCompare(b.SK)).map(r => ({ ...r })) };
      }
      if (cmd instanceof ScanCommand) {
        const sk = i.ExpressionAttributeValues[":m"];
        return { Items: [...rows.values()].filter(r => r.SK === sk).map(r => ({ ...r })) };
      }
      if (cmd instanceof GetCommand) return { Item: rows.get(k(i.Key.PK, i.Key.SK)) };
      if (cmd instanceof BatchWriteCommand) {
        const [reqs] = Object.values(i.RequestItems);
        if (reqs.length > 25) throw new Error("fake db: more than 25 writes in a batch");
        for (const { PutRequest, DeleteRequest } of reqs) {
          if (PutRequest) rows.set(k(PutRequest.Item.PK, PutRequest.Item.SK), { ...PutRequest.Item });
          else rows.delete(k(DeleteRequest.Key.PK, DeleteRequest.Key.SK));
        }
        return { UnprocessedItems: {} };
      }
      if (cmd instanceof TransactWriteCommand) {
        if (i.TransactItems.length > 100) throw new Error("fake db: more than 100 items in a transaction");
        const key = op => (op.Put ? k(op.Put.Item.PK, op.Put.Item.SK) : k(op.Delete.Key.PK, op.Delete.Key.SK));
        for (const op of i.TransactItems) {
          const cond = (op.Put || op.Delete).ConditionExpression, there = rows.has(key(op));
          if ((cond === "attribute_not_exists(PK)" && there) || (cond === "attribute_exists(PK)" && !there)) {
            const e = new Error("Transaction cancelled"); e.name = "TransactionCanceledException"; throw e;
          }
        }
        for (const op of i.TransactItems) {
          if (op.Put) rows.set(key(op), { ...op.Put.Item });
          else rows.delete(key(op));
        }
        return {};
      }
      throw new Error("fake db: unsupported " + cmd.constructor.name);
    },
  };
}
