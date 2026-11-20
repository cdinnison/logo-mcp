// Worldvectorlogo: official API only, keyless tier (10 calls/day/IP). No account, no scraping.
// Used for live lookup of a named brand. Responses cached 7 days; metadata only is stored.
import { upsertLogo, type Db } from "./db.ts";
import { USER_AGENT } from "./clip.ts";

const API = "https://worldvectorlogo.com/api/v1";
const DAILY_LIMIT = 10;
const CACHE_DAYS = 7;

export async function searchWvl(db: Db, query: string): Promise<{ ids: string[]; note?: string }> {
  const key = `wvl:search:${query.toLowerCase().trim()}`;
  const cached = db
    .prepare(`SELECT body FROM http_cache WHERE key = ? AND fetched_at > datetime('now', ?)`)
    .get(key, `-${CACHE_DAYS} days`) as { body: string } | undefined;
  let body = cached?.body;

  if (!body) {
    const quotaKey = `wvl:quota:${new Date().toISOString().slice(0, 10)}`;
    const used = Number((db.prepare("SELECT body FROM http_cache WHERE key = ?").get(quotaKey) as any)?.body ?? 0);
    if (used >= DAILY_LIMIT) return { ids: [], note: `worldvectorlogo daily limit (${DAILY_LIMIT}) reached; try tomorrow` };
    db.prepare("INSERT INTO http_cache (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body").run(quotaKey, String(used + 1));
    const res = await fetch(`${API}/logos/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return { ids: [], note: `worldvectorlogo returned ${res.status}` };
    body = await res.text();
    db.prepare("INSERT INTO http_cache (key, body, fetched_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at").run(key, body);
  }

  const { data = [] } = JSON.parse(body) as { data?: { slug: string; name: string; svg_url: string; links: { web: string } }[] };
  const ids = data.slice(0, 10).map((d) => {
    const id = `worldvectorlogo:${d.slug}`;
    upsertLogo(db, {
      id,
      source: "worldvectorlogo",
      title: d.name.replace(/ logo$/i, ""),
      designer: null, company: d.name.replace(/ logo$/i, ""), year: null, era: null, mark_type: null,
      style: "[]", industry: "[]", subject: "[]", color: null, keywords: JSON.stringify([query]), description: null,
      thumbnail_url: d.svg_url,
      source_url: d.links.web,
      attribution: `${d.name} via worldvectorlogo.com. Trademark belongs to its owner.`,
      license: "worldvectorlogo terms: personal, non-commercial use only. Reference, do not reuse.",
    });
    return id;
  });
  return { ids };
}
