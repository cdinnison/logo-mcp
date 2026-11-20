// npm run ingest            index new marks and embed any without vectors
// npm run ingest -- --retag re-run zero-shot style/mark_type tagging on everything
import { openDb, upsertLogo, indexText, toBlob, fromBlob, type Db } from "./db.ts";
import { embedImageUrl, embedTexts, dot, USER_AGENT } from "./clip.ts";

const SYMBOOLS = "https://www.symbools.com"; // apex 308-redirects here
const DELAY_MS = 250; // one request at a time, roughly 1/s with fetch latency

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res;
};

const GLYPH_CHAPTERS = /numerals|ideographs|syllabary/i;
const SHAPE_CHAPTERS = /circles|rectangles|triangles|polygons|curves|arrows|signs/i;

/** symbools: every book listed in llms.txt, one marks.json per book. */
async function ingestSymbools(db: Db) {
  const llms = await (await get(`${SYMBOOLS}/llms.txt`)).text();
  const books = [...new Set(llms.match(/https:\/\/(?:www\.)?symbools\.com\/[\w-]+\/marks\.json/g) ?? [])];
  let n = 0;
  for (const url of books) {
    const data = await (await get(url)).json();
    const book = data.book;
    const tx = db.transaction(() => {
      for (const m of data.marks) {
        const text = (m.text ?? "").replace(/\s/g, "");
        const ruleType = GLYPH_CHAPTERS.test(m.chapter) ? "lettermark" : text ? (text.length <= 3 ? "lettermark" : "combination") : null;
        upsertLogo(db, {
          id: `symbools:${book.slug}:${m.number}`,
          source: "symbools",
          title: m.company ?? `Mark ${m.number}`,
          designer: m.designer ?? null,
          company: m.company ?? null,
          year: null, // per-mark years aren't in the book; all predate its publication
          era: book.year ? `pre-${book.year}` : null,
          mark_type: ruleType,
          style: "[]",
          industry: JSON.stringify(m.industry ?? []),
          subject: JSON.stringify([...(m.subject ?? []), m.chapter.toLowerCase()]),
          color: "monochrome",
          keywords: JSON.stringify([...(m.keywords ?? []), ...(m.text ? [m.text] : [])]),
          description: m.description ?? null,
          thumbnail_url: m.files.png_1024.replace("//symbools.com", "//www.symbools.com"),
          source_url: m.url.replace("//symbools.com", "//www.symbools.com"),
          attribution: m.credit,
          license: data.terms,
        });
        n++;
      }
    });
    tx();
    console.log(`symbools: ${data.marks.length} marks from ${book.title}`);
  }
  return n;
}

const STYLES: Record<string, string> = {
  geometric: "a geometric logo built from circles, squares and straight lines",
  organic: "an organic logo with flowing natural curves",
  line: "a line art logo drawn with thin outlines",
  solid: "a bold solid black silhouette logo",
  "negative space": "a logo that uses negative space to reveal a hidden shape",
  modular: "a modular logo made of repeated units in a pattern",
  illustrative: "a detailed illustrative drawing used as a logo",
};
const MARK_TYPES: Record<string, string> = {
  symbol: "a pictorial logo of a recognizable object or creature",
  abstract: "an abstract logo mark made of pure shapes",
  emblem: "an emblem logo enclosed in a badge, seal or crest",
};

function softmax(scores: number[], t = 100) {
  const e = scores.map((s) => Math.exp(s * t));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

/** Zero-shot CLIP tags. Only fills mark_type when source metadata didn't settle it. */
function tag(v: Float32Array, chapter: string, ruleType: string | null, styleVecs: Float32Array[], typeVecs: Float32Array[]) {
  const sp = softmax(styleVecs.map((s) => dot(v, s)));
  const styles = Object.keys(STYLES)
    .map((k, i) => [k, sp[i]] as const)
    .sort((a, b) => b[1] - a[1])
    .filter(([, p], i) => i === 0 || p > 0.25)
    .slice(0, 2)
    .map(([k]) => k);
  if (ruleType) return { styles, markType: ruleType };
  const tp = softmax(typeVecs.map((s) => dot(v, s)));
  let markType = Object.keys(MARK_TYPES)[tp.indexOf(Math.max(...tp))];
  if (markType === "symbol" && SHAPE_CHAPTERS.test(chapter) && tp[0] < 0.6) markType = "abstract";
  return { styles, markType };
}

async function embedMissing(db: Db, retag: boolean) {
  const [styleVecs, typeVecs] = await Promise.all([embedTexts(Object.values(STYLES)), embedTexts(Object.values(MARK_TYPES))]);
  const todo = db
    .prepare(`SELECT rowid, id, thumbnail_url, subject, mark_type, embedding FROM logos WHERE source = 'symbools' ${retag ? "" : "AND embedding IS NULL"}`)
    .all() as { rowid: number; id: string; thumbnail_url: string; subject: string; mark_type: string | null; embedding: Buffer | null }[];
  console.log(`embedding ${todo.length} marks`);
  const save = db.prepare("UPDATE logos SET embedding = ?, style = ?, mark_type = ? WHERE rowid = ?");
  let done = 0, failed = 0;
  for (const row of todo) {
    try {
      let v: Float32Array;
      if (row.embedding) v = fromBlob(row.embedding);
      else {
        v = await embedImageUrl(row.thumbnail_url);
        await sleep(DELAY_MS);
      }
      const subjects: string[] = JSON.parse(row.subject);
      const chapter = subjects[subjects.length - 1] ?? "";
      const ruleType = row.mark_type && ["lettermark", "combination"].includes(row.mark_type) ? row.mark_type : null;
      const { styles, markType } = tag(v, chapter, ruleType, styleVecs, typeVecs);
      save.run(toBlob(v), JSON.stringify(styles), markType, row.rowid);
      indexText(db, row.rowid);
    } catch (e) {
      failed++;
      console.warn(`skip ${row.id}: ${(e as Error).message}`);
    }
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  }
  console.log(`embedded ${done - failed}, failed ${failed}`);
}

const db = openDb();
const total = await ingestSymbools(db);
await embedMissing(db, process.argv.includes("--retag"));
const { n, vectors } = db.prepare("SELECT count(*) AS n, count(embedding) AS vectors FROM logos WHERE source='symbools'").get() as any;
console.log(`done: ${total} symbools marks in source, ${n} indexed, ${vectors} with image vectors`);
