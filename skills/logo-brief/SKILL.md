---
name: logo-brief
description: Use when designing, critiquing, or rebranding a logo, wordmark, symbol, monogram, or app icon, or when asked for logo references. Finds curated reference marks through the logo MCP and turns the picks into a logo brief. Not for downloading assets to ship.
---

# Logo brief

## When to call the MCP
- Logo, wordmark, symbol, app icon, or favicon work: starting, iterating, reviewing.
- The user gives a name, product, industry, or tone words ("calm, mid-century, bird").
- The user shares a mark and wants more like it: `similar_logos` with `image_url`.
- Not for copying a specific brand's logo, UI screens (use Mobbin), or when final art already exists.

## Flow
1. Pull the inputs: product, audience, industry, mark type, tone words, constraints, must-avoid.
2. `search_logos` two or three times from different angles: the concept ("bird in flight"), the shape ("circle monogram"), the industry or style. Use `list_facets` for exact filter values.
3. Pick 6–10 that differ from each other. `get_logo` on the ones you cite.
4. Run `similar_logos` on the two or three strongest. If the neighbors all look alike, the idea is crowded; say so.
5. Need a real brand for comparison? Add `"worldvectorlogo"` to `sources` (10 live lookups a day).
6. `create_collection` named after the project, then `save_logo` each pick with a one-line note on what to borrow.

## The brief
For each pick, one line each: construction (grid, circle, negative space, stroke weight, symmetry), why it fits, what principle to borrow.

Then:
- **Directions** (2–3): one sentence each, with the references behind it.
- **Form**: shape vocabulary, weight, corners, symmetry, mark type.
- **Color**: start in one color. References only hint at a palette.
- **Avoid**: clichés seen in crowded results.
- **Tests**: 16 px favicon, 32 px app icon, one color, reversed.
- **Next**: trademark search (USPTO / TMview) before committing.

## Rules
- Every reference gets its designer, attribution, and source link. Link, never paste or redistribute files.
- Inspiration only. Never reproduce or trace a mark into a deliverable. Symbools is noncommercial reference; Worldvectorlogo is personal, non-commercial.
- Output is a table of picks and the brief. Nothing else.
