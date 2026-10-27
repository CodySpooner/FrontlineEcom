# Backlog — image-generation lane (page header art + agent portraits)

Repo rules: `CLAUDE.md` (worker loop, hard rules). Look and feel: `docs/DESIGN.md` §3.

## What the owner asked for (verbatim, 2026-10-27)

> 1. i want this to be a cool image header that matches our color scheme somrthing simple but clean (so this for all
>    the page headers for each section not just the command center)
> 2. on our ai agents screen i dont wan these to look like generic shapes i want these agents to actually have
>    personality please

Screenshots they marked up: `docs/reference/image-gen-1-header.png` (the Command Center header, circled) and
`docs/reference/image-gen-2-agents.png` (the AI Agents cards with today's flat SVG portraits). Today both are drawn in
code: the header is `apps/web/src/components/Hero.tsx` (gradient `hero-bg` in `index.css` + SVG skyline + SVG figures
picked by `art` in `apps/web/src/nav.ts`), the portraits are `Portrait` + the `<symbol>`s in `SvgDefs` in
`apps/web/src/components/Art.tsx`. Replace both with generated images.

## Lane

Owns: `apps/web/public/art/**` (new: `headers/`, `agents/`), `Hero.tsx`, `Art.tsx`, the `art` field in `nav.ts`, the
`hero-bg` utility in `index.css`, this file. Pages only pass props to `Hero` / `Portrait`; change a page only if its
`Hero` / `Portrait` call has to change. The AI Ecosystem page's own pixel-art (`src/ecosystem/**`, `WorkerPortrait`)
stays as it is. The other lanes are stopped right now; still keep to these files.

## Art direction (both jobs, one style)

- Use your image-generation tool. Generated art, not SVG shapes. One consistent style across every image: clean,
  cinematic digital illustration (semi-realistic, not pixel art, not photo), dark charcoal / black (`#08080a`–`#131316`)
  with red light (`#ff2a3a`, `#c3121f`), white only for small highlights. Soft red rim light, glowing red eyes on the
  characters (DESIGN.md §3: dark armored / hooded / masked characters).
- **Simple but clean:** one focal subject per image, lots of dark negative space, no clutter, no text, no logos, no
  watermarks, no UI baked into the image.
- Save as WebP (fall back to optimized JPG/PNG only if you can't convert) under `apps/web/public/art/`, loaded by
  absolute path like `src/ecosystem` loads `/ecosystem/*.png` (works offline and in the packaged app; no CDNs).
  Budget: a header ≤ ~250 KB, a portrait ≤ ~80 KB, all new art ≤ ~4 MB.
- Write the prompts you used into `apps/web/public/art/PROMPTS.md` so an image can be regenerated in the same style.

## Headers (request 1)

- One header image **per section**, each with its own subject that hints at the page, same style and framing:
  Command Center, AI Agents, Store Analytics, Product Research, Creative Studio, Store Builder, Orders & Fulfillment,
  Competitor Intel, Automation, Integrations, Knowledge Base, Settings, AI Ecosystem (its `Hero`, if it uses one), and
  the agent detail page (`AgentDetail.tsx` — can reuse AI Agents' or be its own).
- Composition: very wide, short banner (the visible strip is ~5:1 to 10:1 depending on window width). Subject and red
  glow in the right half; the left ~45% stays dark and quiet so the title and subtitle read; the top-right corner stays
  calm (Ask AI field, bell, profile chip sit there). Rendered with `object-cover` anchored right, so it holds up from
  900 px to 2560 px wide.
- The header is also the desktop window's drag region (`.titlebar`): the image must be `pointer-events-none`,
  `draggable={false}`, and the min/max/close area must stay usable. No layout shift: the header keeps its size while the
  image loads (dark background underneath).

## Portraits (request 2)

Eight characters with real personality: a face or mask with expression, a pose, a prop that says what they do, a
silhouette you can tell apart at 32 px. Keep each one's current look as the anchor so the squad stays recognisable:

| Role | Current look (`LOOK` in Art.tsx) | Personality to give it |
|------|------|------|
| Ad Strategist | horned helm | confident war-room general, slight smirk, glowing targeting tablet |
| Product Hunter | visor helm | sharp-eyed scout, visor pushed up, scanning lens, "found a winner" grin |
| Store Developer | hood | calm builder-hacker, headset, storefront wireframe hologram |
| Creative Studio | spiky crest | energetic artist, wild red-streaked hair, light-paint on gloves, camera/stylus |
| Market Analyst | ram helm | cool analyst, raised eyebrow, HUD lens with charts reflected |
| Copywriter | masked hood | mysterious wordsmith, half-mask, glowing stylus-quill, knowing eyes |
| Email & SMS | ninja headband | fast, friendly messenger-ninja, message drones, a wink |
| Operations | heavy grill-mask | big dependable quartermaster, arms crossed, crates/clipboard |

- Bust or head-and-shoulders, same camera, same lighting, dark background that blends into the card. Square master
  (≥ 512 px); the face must read at every size `Portrait` is used: 32 px (Chat), 42/48 px (Dashboard, Onboarding, agent
  detail), 96 px (DevGallery) and the AI Agents card (full card width × 132 px — set `object-position` so the face sits
  in that strip).
- Keep `Portrait`'s API (`role`, `rank`, `className`), the rank frames (`FRAME`) and the paused look (`opacity-40
  grayscale` from Agents.tsx). Remove SVG symbols that nothing uses afterwards.

## Done when

`pnpm check` green; every page in the list above and every place `Portrait` is used checked in a browser at 1280 and
1920 px wide, with before/after screenshots saved in `.agent/` (git-ignored); no console errors; the header drag region
and window buttons still work. Then create an empty `.agent/STOP` in this worktree and stop.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

## Items
- [ ] IMG-01 Inspect: `Hero.tsx`, `Art.tsx`, `nav.ts`, `index.css` (`hero-bg`), every `Hero` / `Portrait` call, both
  screenshots, DESIGN.md §3. Screenshot today's headers and the AI Agents page as "before".
- [ ] IMG-02 Style frame: generate the Command Center header and one portrait (Ad Strategist) first; tune until they
  match the art direction, then record the final prompts in `PROMPTS.md` as the template for the rest.
- [ ] IMG-03 Header images for every section in the list, same template.
- [ ] IMG-04 Wire headers: `Hero` shows the page's image (replace `HeroArt` / `Scene` / the SVG skyline with an image
  key per page in `nav.ts`), text readable, right side and drag region intact, no layout shift, 900–2560 px.
- [ ] IMG-05 The other seven portraits, same template.
- [ ] IMG-06 Wire portraits: `Portrait` renders the image at every size, rank frames and paused look kept, unused SVG
  symbols removed.
- [ ] IMG-07 Acceptance pass ("Done when" above), fix what it finds, then STOP.

## Done

## Blocked
