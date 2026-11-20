// Starts the server over stdio and calls every tool once.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_PATH } from "../src/db.ts";

// Run against a throwaway copy so smoke collections never touch your real ones.
const copy = join(tmpdir(), `logo-mcp-smoke-${Date.now()}.db`);
new Database(DB_PATH, { readonly: true }).exec(`VACUUM INTO '${copy}'`);

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/server.ts"], env: { ...process.env, LOGO_MCP_DB: copy } as Record<string, string> }));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};
const brief = (r: any) => `${r.id}  ${r.title} — ${r.designer ?? "?"}  [${r.mark_type}; ${r.style.join(", ")}]\n    ${r.source_url}`;

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));

const s = await call("search_logos", { query: "circle monogram", limit: 3 });
console.log(`\nsearch_logos "circle monogram" (${s.total} matches)\n` + s.results.map(brief).join("\n"));

const f = await call("search_logos", { query: "bird in flight", mark_type: "symbol", industry: "airlines", limit: 3 });
console.log(`\nsearch_logos "bird in flight" airlines/symbol\n` + f.results.map(brief).join("\n"));

const g = await call("get_logo", { id: s.results[0].id });
console.log(`\nget_logo → ${g.title}: ${g.description}\n    ${g.attribution}`);

const sim = await call("similar_logos", { id: s.results[0].id, limit: 3 });
console.log(`\nsimilar_logos(${s.results[0].id})\n` + sim.results.map((r: any) => `${r.similarity}  ` + brief(r)).join("\n"));

const facets = await call("list_facets");
console.log("\nlist_facets mark_type:", JSON.stringify(facets.mark_type), "\nstyle:", JSON.stringify(facets.style));

const name = `smoke-${Date.now()}`;
const c = await call("create_collection", { name });
await call("save_logo", { collection: name, logo_id: s.results[0].id, note: "ring construction" });
const lc = await call("list_collections");
const gc = await call("get_collection_contents", { collection: String(c.id) });
console.log(`\ncollections: ${lc.length}; "${gc.name}" holds ${gc.logos.length} (${gc.logos[0].id}: ${gc.logos[0].note})`);

await client.close();
