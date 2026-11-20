import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb, toBlob, type Logo } from "./db.ts";
import { embedImageUrl, embedTexts } from "./clip.ts";
import { searchWvl } from "./wvl.ts";

const db = openDb();
const server = new McpServer({ name: "logo-mcp", version: "0.1.0" });

const LICENSE_NOTE: Record<string, string> = {
  symbools: "Noncommercial reference only. Keep the credit. Trademark belongs to its owner.",
  worldvectorlogo: "Personal, non-commercial reference only. Trademark belongs to its owner.",
};

const parse = (s: string) => JSON.parse(s) as string[];

function card(l: Logo) {
  return {
    id: l.id,
    title: l.title,
    designer: l.designer,
    year: l.year,
    era: l.era,
    source: l.source,
    mark_type: l.mark_type,
    style: parse(l.style),
    industry: parse(l.industry),
    subject: parse(l.subject).slice(0, 6),
    thumbnail_url: l.thumbnail_url,
    source_url: l.source_url,
    attribution: l.attribution,
    license_note: LICENSE_NOTE[l.source] ?? l.license,
  };
}

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const getLogo = (id: string) => db.prepare("SELECT * FROM logos WHERE id = ?").get(id) as (Logo & { embedding: Buffer | null }) | undefined;
const byRowids = (rowids: number[]) => {
  if (!rowids.length) return [];
  const rows = db.prepare(`SELECT * FROM logos WHERE rowid IN (${rowids.map(() => "?").join(",")})`).all(...rowids) as Logo[];
  const map = new Map(rows.map((r) => [r.rowid, r]));
  return rowids.map((r) => map.get(r)!).filter(Boolean);
};

type Filters = { mark_type?: string; style?: string; industry?: string; era?: string; color?: string; subject?: string; sources?: string[] };

function where(f: Filters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const sources = f.sources?.length ? f.sources : ["symbools"];
  clauses.push(`l.source IN (${sources.map(() => "?").join(",")})`);
  params.push(...sources);
  for (const k of ["mark_type", "era", "color"] as const) {
    if (f[k]) { clauses.push(`l.${k} = ? COLLATE NOCASE`); params.push(f[k]); }
  }
  for (const k of ["style", "industry", "subject"] as const) {
    if (f[k]) { clauses.push(`EXISTS (SELECT 1 FROM json_each(l.${k}) WHERE value LIKE ?)`); params.push(`%${f[k]}%`); }
  }
  return { sql: clauses.join(" AND "), params };
}

const ftsQuery = (q: string) =>
  q.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map((t) => `"${t}"`).join(" OR ") ?? "";

const facetParams = {
  mark_type: z.string().optional().describe("wordmark | lettermark | symbol | combination | emblem | abstract"),
  style: z.string().optional().describe("geometric | organic | line | solid | negative space | modular | illustrative"),
  industry: z.string().optional().describe("e.g. airlines, banks, food, publishing (see list_facets)"),
  era: z.string().optional().describe("e.g. pre-1973"),
  color: z.string().optional().describe("e.g. monochrome"),
  subject: z.string().optional().describe("e.g. bird, circle, hand, arrow, spiral (see list_facets)"),
};

server.registerTool(
  "search_logos",
  {
    description:
      "Search curated, designer-made logo marks by concept, shape, or mood (e.g. 'circle monogram', 'bird in flight', 'calm geometric bank'). Ranks by CLIP image match blended with tags. Add 'worldvectorlogo' to sources to also look up a named real-world brand (live API, 10 lookups/day).",
    inputSchema: {
      query: z.string().optional().describe("What the mark should show or feel like"),
      ...facetParams,
      sources: z.array(z.enum(["symbools", "worldvectorlogo"])).optional().describe("Default ['symbools']"),
      limit: z.number().int().min(1).max(50).optional().describe("Default 12"),
      cursor: z.string().optional().describe("next_cursor from a previous call"),
    },
  },
  async ({ query, limit = 12, cursor, ...filters }) => {
    const offset = Number(cursor ?? 0) || 0;
    const w = where(filters);
    const notes: string[] = [];
    let ordered: number[];

    if (query?.trim()) {
      const scores = new Map<number, number>();
      const add = (rowids: number[]) => rowids.forEach((r, i) => scores.set(r, (scores.get(r) ?? 0) + 1 / (60 + i)));
      const [qv] = await embedTexts([`a logo of ${query}`]);
      add(
        (db.prepare(`SELECT l.rowid FROM logos l WHERE l.embedding IS NOT NULL AND ${w.sql} ORDER BY vec_distance_cosine(l.embedding, ?) LIMIT 300`)
          .all(...w.params, toBlob(qv)) as { rowid: number }[]).map((r) => r.rowid)
      );
      const fq = ftsQuery(query);
      if (fq)
        add(
          (db.prepare(`SELECT l.rowid FROM logos_fts f JOIN logos l ON l.rowid = f.rowid WHERE logos_fts MATCH ? AND ${w.sql} ORDER BY bm25(logos_fts, 2, 2, 2, 1, 1.5) LIMIT 300`)
            .all(fq, ...w.params) as { rowid: number }[]).map((r) => r.rowid)
        );
      ordered = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);

      if (filters.sources?.includes("worldvectorlogo") && offset === 0) {
        const { ids, note } = await searchWvl(db, query);
        if (note) notes.push(note);
        const brand = ids.map((id) => getLogo(id)!.rowid);
        ordered = [...brand, ...ordered.filter((r) => !brand.includes(r))];
      }
    } else {
      ordered = (db.prepare(`SELECT l.rowid FROM logos l WHERE ${w.sql} ORDER BY l.rowid`).all(...w.params) as { rowid: number }[]).map((r) => r.rowid);
    }

    const page = byRowids(ordered.slice(offset, offset + limit)).map(card);
    const next = offset + limit < ordered.length ? String(offset + limit) : null;
    return json({ total: ordered.length, results: page, next_cursor: next, ...(notes.length ? { notes } : {}) });
  }
);

server.registerTool(
  "get_logo",
  { description: "Full details for one logo: designer, company, description, keywords, attribution and license.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const l = getLogo(id);
    if (!l) return fail(`No logo with id ${id}`);
    return json({ ...card(l), company: l.company, description: l.description, subject: parse(l.subject), keywords: parse(l.keywords), color: l.color, license: l.license });
  }
);

server.registerTool(
  "similar_logos",
  {
    description: "Find marks that look like a given logo (by id) or any image URL (PNG/JPG/SVG). Visual similarity from CLIP, nudged by shared tags.",
    inputSchema: {
      id: z.string().optional(),
      image_url: z.string().url().optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 12"),
    },
  },
  async ({ id, image_url, limit = 12 }) => {
    if (!id && !image_url) return fail("Pass id or image_url");
    let v: Float32Array;
    let tags = new Set<string>();
    if (id) {
      const l = getLogo(id);
      if (!l) return fail(`No logo with id ${id}`);
      tags = new Set([...parse(l.subject), ...parse(l.keywords), ...parse(l.industry)]);
      v = l.embedding ? new Float32Array(l.embedding.buffer, l.embedding.byteOffset, l.embedding.byteLength / 4) : await embedImageUrl(l.thumbnail_url);
    } else {
      try { v = await embedImageUrl(image_url!); } catch (e) { return fail(`Could not read image: ${(e as Error).message}`); }
    }
    const rows = db
      .prepare(`SELECT rowid, id, subject, keywords, industry, 1 - vec_distance_cosine(embedding, ?) AS sim FROM logos WHERE embedding IS NOT NULL AND id IS NOT ? ORDER BY sim DESC LIMIT 100`)
      .all(toBlob(v), id ?? null) as { rowid: number; subject: string; keywords: string; industry: string; sim: number }[];
    const ranked = rows
      .map((r) => {
        const t = [...parse(r.subject), ...parse(r.keywords), ...parse(r.industry)];
        const shared = tags.size ? t.filter((x) => tags.has(x)).length / new Set([...t, ...tags]).size : 0;
        return { rowid: r.rowid, score: 0.85 * r.sim + 0.15 * shared, sim: r.sim };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const cards = byRowids(ranked.map((r) => r.rowid)).map((c, i) => ({ ...card(c), similarity: Number(ranked[i].sim.toFixed(3)) }));
    return json({ results: cards });
  }
);

server.registerTool(
  "list_facets",
  { description: "Filter values with counts for search_logos: mark_type, style, industry, era, color, subject, sources.", inputSchema: {} },
  async () => {
    const scalar = (col: string) =>
      Object.fromEntries((db.prepare(`SELECT ${col} v, count(*) n FROM logos WHERE ${col} IS NOT NULL GROUP BY v ORDER BY n DESC`).all() as { v: string; n: number }[]).map((r) => [r.v, r.n]));
    const array = (col: string, top = 80) =>
      Object.fromEntries((db.prepare(`SELECT j.value v, count(*) n FROM logos, json_each(logos.${col}) j GROUP BY v ORDER BY n DESC LIMIT ?`).all(top) as { v: string; n: number }[]).map((r) => [r.v, r.n]));
    return json({
      sources: scalar("source"),
      mark_type: scalar("mark_type"),
      style: array("style"),
      industry: array("industry"),
      era: scalar("era"),
      color: scalar("color"),
      subject: array("subject"),
    });
  }
);

const findCollection = (ref: string) =>
  db.prepare("SELECT * FROM collections WHERE id = ? OR name = ? COLLATE NOCASE").get(Number(ref) || -1, ref) as { id: number; name: string; description: string | null } | undefined;

server.registerTool(
  "create_collection",
  { description: "Create a named collection to save logo picks into (e.g. one per project).", inputSchema: { name: z.string().min(1), description: z.string().optional() } },
  async ({ name, description }) => {
    if (findCollection(name)) return fail(`A collection named "${name}" already exists`);
    const { lastInsertRowid } = db.prepare("INSERT INTO collections (name, description) VALUES (?, ?)").run(name, description ?? null);
    return json({ id: Number(lastInsertRowid), name, description: description ?? null });
  }
);

server.registerTool(
  "list_collections",
  { description: "All collections with how many logos each holds.", inputSchema: {} },
  async () =>
    json(db.prepare("SELECT c.id, c.name, c.description, c.created_at, count(i.logo_id) AS count FROM collections c LEFT JOIN collection_items i ON i.collection_id = c.id GROUP BY c.id ORDER BY c.created_at DESC").all())
);

server.registerTool(
  "get_collection_contents",
  { description: "Logos saved in a collection, with your notes.", inputSchema: { collection: z.string().describe("Collection id or name") } },
  async ({ collection }) => {
    const c = findCollection(collection);
    if (!c) return fail(`No collection "${collection}"`);
    const items = db.prepare("SELECT l.*, i.note, i.added_at FROM collection_items i JOIN logos l ON l.id = i.logo_id WHERE i.collection_id = ? ORDER BY i.added_at").all(c.id) as (Logo & { note: string | null; added_at: string })[];
    return json({ ...c, logos: items.map((l) => ({ ...card(l), note: l.note, added_at: l.added_at })) });
  }
);

server.registerTool(
  "save_logo",
  {
    description: "Save a logo to a collection with an optional note on what to borrow from it. Saving again updates the note.",
    inputSchema: { collection: z.string().describe("Collection id or name"), logo_id: z.string(), note: z.string().optional() },
  },
  async ({ collection, logo_id, note }) => {
    const c = findCollection(collection);
    if (!c) return fail(`No collection "${collection}". Create it with create_collection first.`);
    if (!getLogo(logo_id)) return fail(`No logo with id ${logo_id}`);
    db.prepare("INSERT INTO collection_items (collection_id, logo_id, note) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET note = COALESCE(excluded.note, note)").run(c.id, logo_id, note ?? null);
    return json({ saved: logo_id, collection: c.name, note: note ?? null });
  }
);

await server.connect(new StdioServerTransport());
