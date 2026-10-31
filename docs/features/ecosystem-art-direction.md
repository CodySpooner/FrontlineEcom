# Frontline field headquarters — art direction

2026-10-31 · ECO-47 · Owner reference inspected locally; third-party image is never shipped.

## Audit and retained foundations

The office uses Pixi WebGL, a cached Canvas floor/prop texture, a 3840 × 3840 character atlas
(30 seats, 48 × 64 cells, ten poses, four directions, four frames), and independent world layers.
`characters.ts` paints the underlying sprites and portraits. `workerSprites.ts` owns movement,
frame selection, real handoff visits, meetings, selection and culling. `renderer.ts` owns camera,
resources and the ticker. Existing archetypes are varied but large heads and box-shaped bodies
dominate their silhouettes; most poses use the same one-pixel bounce.

`events.ts` adapts existing agents/runs/approvals/missions. `useOffice.ts` reconciles REST and live
events; `useDemoOffice.ts` is a separate, explicitly labelled simulation. Preserve that boundary,
the current deployment/seat contract, saved appearance options, existing conversations and tasks.
Preserve Settings' reduced-motion adapter. No additional agent registry, paid calls or store writes.

The current full-office composition is spacious but the ten rooms have nearly identical massing.
Existing skyline, platform identifiers, logo projector, live telemetry, desk beacons, paths and
department equipment stay. Improve architecture and quiet areas before adding more effects.
Audit gaps to close in subsequent items: unbounded panning, no independent ambient pause,
all-store-only office state, and generic idle gestures. Static textures and shared atlas remain
appropriate; this is original procedural 2D pixel art, not rigged 3D or generated sprite imagery.

## Shared visual language

Concept: a staffed industrial research headquarters above a night city. Specialists wear practical
layered field clothing and carry instruments specific to their role. No weapons, copied costumes,
ranks, trophies or game mechanics. Knowledge remains an existing feature; scenery does not invent
new controls or pretend to be operational business data.

Reference lessons: roughly four-to-five-head figures, weight in boots and hips, overlapping cloth,
small articulated metal edges, readable negative space around limbs, restrained faces, clusters
of three values rather than scattered bright pixels. Adapt these qualities into original designs.
Use a 12–14 pixel head, long split coats or vests, 18–20 pixel legs and asymmetrical equipment
inside the existing cell. Fit view must read silhouette and status; closer views reveal seams,
clasps, leather straps, glass lenses, folded fabric and contrasting sleeves.

Palette: charcoal ink #10131e; blue-grey steel #70869b; pale metal #cedce0; warm canvas #b8a088;
Frontline red accents; the saved worker colour remains the fabric colour, saved accent the tool
light. Light arrives from upper left: narrow warm top edges, cooler right-side shadows. Metal
gets one sharp highlight, cloth broad stepped shading, glass a dark body and a small pale reflection.
Keep status colours independent from costume colours and retain textual status explanations.

| Role | Original silhouette and equipment | Quiet gesture |
|---|---|---|
| Product Hunter | Split survey coat, asymmetric sample satchel, shoulder sensor and hand scanner | Inspect lens |
| Market Analyst | Precise long waistcoat, narrow spectacles, hinged measuring slate | Adjust slate |
| Ad Strategist | Short signal jacket, collar receiver, directional aerial and campaign folio | Touch receiver |
| Creative Studio | Draped studio apron, rolled sleeve, stylus and glass colour board | Rotate stylus |
| Store Developer | Utility overshirt, segmented forearm brace, fold-out terminal | Check wrist |
| Copywriter | Long soft cardigan, paper folio, pen and shoulder book strap | Turn page |
| Operations | Reinforced vest, broad boots, label reader and parcel harness | Check strap |
| Email & SMS | Tailored courier coat, dispatch case, compact communications tablet | Close case |

Saved skin/hair/outfit/accessory/gear/variant choices still apply. Role identity comes from the
existing agent role, with a safe legacy fallback for unknown identifiers. Portraits use the same painter.

## World and motion

Compose around the logo atrium: a recessed layered central dais, radial approach markings, raised
department entry frames, cool rear glazing, dark service foundation and restrained foreground rails.
Give rooms distinct canopy/bench forms without changing collision geometry or desk IDs. Detail
belongs on existing structural surfaces: fastening plates, floor access panels, tools and storage.
Quiet archive/reading corners contrast with technical equipment. Any discovery text identifies
scenery explicitly; essential information is always in ordinary panels and controls.

Three motion tiers: ambient (rare staggered glances/tool adjustments, slow equipment, no shared
bounce), interaction (short focus/selection response, stable desk and directory targets), event
(real work/approval/handoff/completion/failure only). Completion resolves once to rest. No looping
celebration, flashing, shake or autoplay audio. Reduce/pause keeps status, navigation and context
usable without needing motion; low power keeps a deliberate static composition.

## Verification plan

Prove Product Hunter in the running office before extending the painter to all eight roles. Check
fit/close-up, every pose/direction, existing appearance recovery and matching portraits. For each
slice run `pnpm check`, inspect Orca screenshots and the scene in motion, then commit and push.
Final coverage includes store switching, waiting/failure, selection, bounded navigation, keyboard,
touch-size controls, reduced motion, resize, remounts, mixed 30-worker simulation and a ten-minute
soak. Record measured conditions and limitations rather than promising a universal frame rate.
