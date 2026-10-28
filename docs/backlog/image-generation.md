# Backlog — image-generation lane (agent portraits)

Repo rules: `CLAUDE.md` (worker loop, hard rules). Look and feel: `docs/DESIGN.md` §3.

> Owner, 2026-10-28: page-header images are removed (the header is a plain title strip) and portraits lose their rank
> frames. Request 1 and IMG-03/04 are superseded and `public/art/headers/` is deleted; don't regenerate header art.
> The portraits stay. The lane is finished.

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

Owns: `apps/web/public/art/agents/**`, `Art.tsx`, this file. Pages only pass props to `Portrait`; change a page only
if its `Portrait` call has to change. The AI Ecosystem page's own pixel-art (`src/ecosystem/**`, `WorkerPortrait`)
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
  Budget: a portrait ≤ ~80 KB, all new art ≤ ~4 MB.
- Write the prompts you used into `apps/web/public/art/PROMPTS.md` so an image can be regenerated in the same style.

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
- Keep `Portrait`'s API (`role`, `className`) and the paused look (`opacity-40 grayscale` from Agents.tsx); no rank
  frames. Remove SVG symbols that nothing uses afterwards.

## Done when

`pnpm check` green; every page in the list above and every place `Portrait` is used checked in a browser at 1280 and
1920 px wide, with before/after screenshots saved in `.agent/` (git-ignored); no console errors; the header drag region
and window buttons still work. Then create an empty `.agent/STOP` in this worktree and stop.

This lane is finite. The owner: "they dont have to work continually just get it where all the images are fixed and
then it can stop". Once IMG-01..07 are done, do not add new items (this overrides CLAUDE.md's "Backlog empty?" rule),
and ignore a watchdog nudge if `.agent/STOP` is already there.

## Inbox
<!-- other lanes append requests here: - [ ] (from <lane>) <request> -->

## Items
- [x] IMG-01 Inspect: `Hero.tsx`, `Art.tsx`, `nav.ts`, `index.css` (`hero-bg`), every `Hero` / `Portrait` call, both
  screenshots, DESIGN.md §3. Screenshot today's headers and the AI Agents page as "before".
- [x] IMG-02 Style frame: generate the Command Center header and one portrait (Ad Strategist) first; tune until they
  match the art direction, then record the final prompts in `PROMPTS.md` as the template for the rest.
- [x] IMG-03 Header images for every section in the list, same template.
- [x] IMG-04 Wire headers: `Hero` shows the page's image (replace `HeroArt` / `Scene` / the SVG skyline with an image
  key per page in `nav.ts`), text readable, right side and drag region intact, no layout shift, 900–2560 px.
- [x] IMG-05 The other seven portraits, same template.
- [x] IMG-06 Wire portraits: `Portrait` renders the image at every size, rank frames and paused look kept, unused SVG
  symbols removed.
- [x] IMG-07 Acceptance pass ("Done when" above), fix what it finds, then STOP.

## Done

- 2026-10-27 IMG-07: Acceptance passed: 12 headers and 8 portraits (1.04 MB), every route and Portrait context at 1280/1920 with before/after screenshots and zero console errors; 900–2560 header crops, all rank/paused frames, native window buttons and drag verified. Production assets match; pnpm check 149 files/992 tests green. Fixed missing favicon and duplicate Done entries. Finite lane complete; STOP follows push.

- 2026-10-27 IMG-06: Portrait keeps its role/rank/className API and rank/paused frames; all eight images share a face-focused crop. Reframed Operations with imagegen to align its eyes. Removed unused SVG sprite and Shell mount; all callers checked at 1280/1920 with no browser errors, pnpm check green.

- 2026-10-27 IMG-05: All eight 768px portraits generated with distinct expressions, silhouettes and role props; exact prompts recorded. Browser galleries checked at 1280/1920 with 32/42/48/96px and wide-card crops. Every portrait below 80 KB; pnpm check green.

- 2026-10-27 IMG-04: Hero/nav now load per-section local WebP art, including agent detail; removed skyline/scenes and gradient art. Browser checks at 900/1280/1920/2560 confirm loaded images, unchanged header height, pointer-events none, drag/no-drag CSS. All header screenshots saved; pnpm check green.

- 2026-10-27 IMG-03: Twelve distinct generated WebP headers total 496 KB; all exact prompts recorded. Reviewed header galleries at 1280/1920 in browser and loaded art in Orca; pnpm check green. Agent detail will share AI Agents; Ecosystem uses no Hero.

- 2026-10-27 IMG-02: Generated and optimized Command Center and Ad Strategist; exact prompts recorded in public/art/PROMPTS.md. Previewed at 1280/1920 (.agent/style-frame-*); 25 KB header, 67 KB portrait; pnpm check green.

- 2026-10-27 IMG-01: Inspected both marked-up references, design/build rules and all Hero/Portrait callers; saved before captures of all 15 routes at 1280/1920 in `.agent/`. Browser errors: none; `pnpm check`: 149 files / 992 tests. Ecosystem has its own header (no Hero); leave that lane's pixel art intact. Scope: Hero/nav/hero-bg, Art, AgentDetail's art prop, and Shell's obsolete SvgDefs mount; rank frames and paused styling stay.

## Blocked
