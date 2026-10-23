// Just enough DynamoDB for the API tests: Query on PK, Get, Put and Delete, BatchWrite, and all-or-nothing
// TransactWrite with attribute_not_exists conditions. Put also knows the "ver = :v" condition.
import { QueryCommand, TransactWriteCommand, GetCommand, BatchWriteCommand, ScanCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

export function fakeDb() {
  const rows = new Map(), k = (pk, sk) => pk + "\u0000" + sk;
  return {
    rows,
    calls: [],
    async send(cmd) {
      const i = cmd.input;
      this.calls.push(cmd.constructor.name);
      if (cmd instanceof QueryCommand) {
        const v = i.ExpressionAttributeValues, pk = v[":pk"], sk = v[":sk"] || "", from = v[":from"] || "";
        let items = [...rows.values()].filter(r => r.PK === pk && r.SK.startsWith(sk) && r.SK >= from).sort((a, b) => a.SK.localeCompare(b.SK));
        if (i.ScanIndexForward === false) items.reverse();
        if (i.Limit) items = items.slice(0, i.Limit);
        return { Items: structuredClone(items) };
      }
      if (cmd instanceof ScanCommand) {
        const sk = i.ExpressionAttributeValues[":m"], pk = i.ExpressionAttributeValues[":g"] || "";
        return { Items: [...rows.values()].filter(r => r.SK === sk && r.PK.startsWith(pk)).map(r => ({ ...r })) };
      }
      if (cmd instanceof GetCommand) {
        const r = rows.get(k(i.Key.PK, i.Key.SK));
        return { Item: r && structuredClone(r) };
      }
      if (cmd instanceof PutCommand) {
        const key = k(i.Item.PK, i.Item.SK), old = rows.get(key), c = i.ConditionExpression;
        const ok = !c || (c === "attribute_not_exists(PK)" ? !old : c === "ver = :v" ? old && old.ver === i.ExpressionAttributeValues[":v"] : null);
        if (ok === null) throw new Error("fake db: unsupported condition " + c);
        if (!ok) { const e = new Error("Condition failed"); e.name = "ConditionalCheckFailedException"; throw e; }
        rows.set(key, structuredClone(i.Item));
        return {};
      }
      if (cmd instanceof DeleteCommand) { rows.delete(k(i.Key.PK, i.Key.SK)); return {}; }
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
