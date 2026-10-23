// Just enough DynamoDB for the API tests: Query on PK, Get, BatchWrite, and all-or-nothing
// TransactWrite with attribute_not_exists conditions
import { QueryCommand, TransactWriteCommand, GetCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

export function fakeDb() {
  const rows = new Map(), k = (pk, sk) => pk + "\u0000" + sk;
  return {
    rows,
    calls: [],
    async send(cmd) {
      const i = cmd.input;
      this.calls.push(cmd.constructor.name);
      if (cmd instanceof QueryCommand) {
        const pk = i.ExpressionAttributeValues[":pk"];
        return { Items: [...rows.values()].filter(r => r.PK === pk).sort((a, b) => a.SK.localeCompare(b.SK)) };
      }
      if (cmd instanceof GetCommand) return { Item: rows.get(k(i.Key.PK, i.Key.SK)) };
      if (cmd instanceof BatchWriteCommand) {
        const [reqs] = Object.values(i.RequestItems);
        if (reqs.length > 25) throw new Error("fake db: more than 25 writes in a batch");
        for (const { PutRequest } of reqs) rows.set(k(PutRequest.Item.PK, PutRequest.Item.SK), { ...PutRequest.Item });
        return { UnprocessedItems: {} };
      }
      if (cmd instanceof TransactWriteCommand) {
        if (i.TransactItems.length > 100) throw new Error("fake db: more than 100 items in a transaction");
        for (const { Put } of i.TransactItems) {
          if (Put.ConditionExpression === "attribute_not_exists(PK)" && rows.has(k(Put.Item.PK, Put.Item.SK))) {
            const e = new Error("Transaction cancelled"); e.name = "TransactionCanceledException"; throw e;
          }
        }
        for (const { Put } of i.TransactItems) rows.set(k(Put.Item.PK, Put.Item.SK), { ...Put.Item });
        return {};
      }
      throw new Error("fake db: unsupported " + cmd.constructor.name);
    },
  };
}
