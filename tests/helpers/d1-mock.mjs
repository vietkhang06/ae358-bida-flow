import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function createMockD1() {
  const sqlite = new DatabaseSync(":memory:");
  const schemaPath = path.resolve(import.meta.dirname, "../../drizzle/0000_natural_silvermane.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  sqlite.exec(schemaSql);

  function wrapStatement(query, boundParams = []) {
    return {
      _query: query,
      _params: boundParams,
      bind(...params) {
        return wrapStatement(query, params);
      },
      async first() {
        const stmt = sqlite.prepare(query);
        const row = stmt.get(...boundParams);
        return row ?? null;
      },
      async all() {
        const stmt = sqlite.prepare(query);
        const results = stmt.all(...boundParams);
        return { results: results ?? [] };
      },
      async run() {
        const stmt = sqlite.prepare(query);
        const info = stmt.run(...boundParams);
        return { success: true, meta: { changes: info.changes } };
      },
    };
  }

  const d1 = {
    prepare(query) {
      return wrapStatement(query);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const stmt of statements) {
          const res = await stmt.run();
          results.push(res);
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    _raw: sqlite,
  };

  return d1;
}
