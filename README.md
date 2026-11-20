# logo-mcp

Personal logo inspiration over MCP, in the spirit of the Mobbin MCP but for marks. Curated, designer-made logos only, no icon libraries.

Local and private: a SQLite index with [sqlite-vec](https://github.com/asg017/sqlite-vec), CLIP embeddings computed on your machine, stdio transport.

## Setup

Node 22.18 or newer (runs the TypeScript directly, no build step).

```sh
npm install
npm run ingest   # ~25 min first run: reads symbools, embeds each mark once
npm run smoke    # starts the server and calls every tool
```

Ingest is idempotent. Run it again to pick up new symbools books; only marks without vectors are fetched. `npm run ingest -- --retag` re-runs auto-tagging without refetching images.

### Claude Code

```sh
claude mcp add logos -- node /absolute/path/to/logo-mcp/src/server.ts
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "logos": {
      "command": "node",
      "args": ["/absolute/path/to/logo-mcp/src/server.ts"]
    }
  }
}
```

The companion skill is in [`skills/logo-brief/SKILL.md`](skills/logo-brief/SKILL.md). Copy it into `~/.claude/skills/` (or your agent's skills folder) to turn picks into a logo brief.

## Tools

| Tool | |
|---|---|
| `search_logos` | Concept, shape, or mood query plus filters: `mark_type`, `style`, `industry`, `era`, `color`, `subject`, `sources`, `limit`, `cursor` |
| `get_logo` | Full record: designer, company, description, keywords, attribution, license |
| `similar_logos` | By `id` or any `image_url` |
| `list_facets` | Filter values with counts |
| `create_collection` · `list_collections` · `get_collection_contents` · `save_logo` | Save picks per project, with notes |

Every result carries a hotlinked `thumbnail_url`, the `source_url`, designer, attribution, and a license note.

## How ranking works

- **Search**: the query is embedded with CLIP's text encoder ("a logo of …") and matched against each mark's image vector, then fused (reciprocal rank) with full-text matches on title, designer, company, description, and tags.
- **Similar**: CLIP image similarity (85%) plus shared subject/keyword/industry tags (15%).
- **Facets** come from source metadata first. `mark_type` is set by rule where the data settles it (glyph chapters and short text → lettermark, text plus symbol → combination). Otherwise it, and `style`, come from CLIP zero-shot on the image.

Model: `Xenova/clip-vit-base-patch32`, downloaded once into `data/models/`.

## Sources

| Source | Status | How |
|---|---|---|
| [symbools](https://symbools.com) | Indexed | Public `marks.json` per book, as its `llms.txt` invites. robots allows all. Metadata and credit kept verbatim. Thumbnails are hotlinked. Each image is fetched once, sequentially, only to compute its vector, then discarded. Terms: noncommercial reference, keep the credit. |
| [Worldvectorlogo](https://worldvectorlogo.com) | Live lookup | Official API, keyless tier (10 calls a day per IP), only when `sources` includes `worldvectorlogo`. Responses cached 7 days, metadata only. No account. Terms: personal, non-commercial. |
| [Logobook](https://www.logobook.com) | TODO | No terms page found and "All rights reserved" footer. Left out until there's a clear yes. |
| [Brand Archive](https://brandarchive.xyz) | Candidate, not ingested | Freemium product (search limits on free, Pro subscription), the site serves a Vercel bot checkpoint to automated clients (429/403), and the Terms of Use load in an iframe that couldn't be read headlessly. Use it by hand. |
| LogoLounge, LogoArchive, Fonts In Use, Brand New | Excluded | Terms forbid copying, or the content is gated or paid. |

Nothing here stores or serves logo files. The only files on disk are the SQLite index (`data/logos.db`: metadata, vectors, your collections) and the CLIP model.

## Layout

```
src/server.ts   MCP tools
src/ingest.ts   symbools ingest, embeddings, zero-shot tags
src/wvl.ts      Worldvectorlogo live lookup with cache and daily quota
src/clip.ts     CLIP image/text embeddings
src/db.ts       schema and upserts
scripts/smoke.ts
skills/logo-brief/SKILL.md
```

Personal, noncommercial use. Every mark belongs to its owner.
