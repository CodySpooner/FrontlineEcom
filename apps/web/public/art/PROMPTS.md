# Frontline generated art

Generated with the built-in image_gen tool on 2026-10-27. No external image URLs are used at runtime. Optimized to WebP with Pillow (RGB, quality 82, method 6); headers retain the generated 2048×683 framing, portraits are 768×768 square masters. Keep the image proportions; use object-cover on a right-anchored header image with a maximum display width so very wide windows do not crop away the face.


## Section header series

Each request used `headers/command-center.webp`'s uncompressed source as the reference. Exact request = common prompt below + ` Subject: ` + the corresponding subject. Agent detail reuses `ai-agents`; Ecosystem does not use Hero and keeps its own art.

Use the reference as the style and composition anchor. Create a new Frontline Ecom page header by changing its focal subject as specified below. Keep the 3:1 wide landscape framing (2048x683), clean cinematic semi-realistic digital illustration with painterly material planes, matte charcoal black (#08080a to #131316), restrained #c3121f/#ff2a3a soft red rim light and tiny warm white highlights. Not photographic, not vector, not pixel art. Keep the left 50% nearly empty black, the top-right quiet, no architecture clutter. One compact focal subject centered at x=76%, head/primary feature near y=35%, supporting prop near y=63%; contain the subject within the right 35% and middle 60% of the image. It is displayed as a shallow cropped application banner: silhouette, face and prop must be close together. No text, letters, logos, symbols on banners, watermarks, UI panels, or decorative frames. 

### ai-agents

A charismatic female squad captain in angular black armor, a compact crown-like helmet with glowing red eyes, composed confident expression. One hand raised to a communications earpiece, a small red holographic formation of eight dots floating close to the shoulder. One character only, a sense of a team leader coordinating specialists.

### analytics

A cool analytical figure in a compact ram-inspired black helm with an open expressive face and one raised eyebrow. Hold a single palm-sized crimson glass data prism near the face, containing luminous ascending red bars with no numbers. A reflective HUD monocle catches that light, methodical and precise.

### product-research

A sharp-eyed young scout in black armor with a visor pushed up, a pleased found-a-winner grin, faint glowing red eyes. Hold a compact scanning lens near one eye, inspecting a small unbranded dark product cube outlined in red light close to the face. Curious, alert, inventive.

### creative-studio

An energetic female artist in matte black techwear, wild short red-streaked spiky hair and glowing red eyes, playful focused smile. A camera hangs at the collar and a red light-paint stylus makes one restrained crimson arc close to her gloved hand. Clear compact silhouette, no extra swirling clutter.

### store-builder

A calm hooded builder-hacker in matte black cloth and armor, glowing red eyes, headset and a faint confident smile. Holds one tiny architectural storefront model in both palms near the chest; its simple awning and doorway edges glow red, without any signs or letters.

### orders-fulfillment

A broad dependable quartermaster in black work armor with a heavy vertical grill half-mask and friendly glowing red eyes. Leaning an elbow on one compact shipping crate, carrying a small blank clipboard against the chest, one red scanner light. Strong sturdy silhouette, no piles of packages.

### competitor-intel

A mysterious observant spy in a black hood and half-mask, intelligent glowing red eyes looking sideways. Holding one compact red optical scouting lens at cheek height, a subtle single red radar ring behind the lens. Sleek and restrained, one focal character.

### automation

A precise black armored robotic hand holding one small mechanical hourglass at center-right. The hourglass contains a restrained stream of red glowing particles and a single slim circular mechanism around it; crisp silhouette, calm unattended machine intelligence. No human figure, no cogs scattered around.

### integrations

One compact sculptural pair of matte-black modular cable connectors joined together, suspended at center-right. A small glowing crimson core illuminates the connection and two simple cables curve away into the darkness. Physical cinematic materials, purposeful and elegant, no network diagram or floating UI.

### knowledge-base

A thoughtful hooded archivist in black cloth, knowing glowing red eyes, with an ancient-meets-future black book held open close to the chest. The book has softly glowing red page edges, blank pages with a subtle red light wash but absolutely no writing. Quiet and intelligent.

### settings

A black armored engineer's gauntlet adjusting one substantial matte-black precision control dial, with restrained red illumination around its rim. Compact sculptural mechanical object, no labels, numbers or interface; elegant physical machinery against deep charcoal.

## Style frame

### Command Center: initial generation

Use case: stylized-concept. Asset type: desktop dashboard cinematic header artwork. Create a very wide 3:1 landscape master, 1536x512 or wider. Frontline Ecom style: clean premium cinematic digital illustration, semi-realistic painterly edges, not a photograph, not pixel art, not vector. Restrained near-black charcoal (#08080a to #131316), deep red #c3121f and soft #ff2a3a rim lighting, tiny warm white highlights only. Subject: a solitary hooded armored commander leaning over a compact glowing red strategic table, confident and watchful, two small glowing red eyes visible under the hood; one unified focal silhouette. Composition critical: most of the image is nearly empty dark charcoal. Put the complete small commander and tabletop at x=76%, between y=35% and y=70%, occupying only 22% of image width and 35% of image height, for a very shallow banner crop. Left 50% completely quiet black; top-right corner also quiet black for controls. Subtle hazy crimson halo behind subject, abstract faint distant headquarters depth, no skyline clutter. It must still read when center-cropped vertically to a 10:1 strip. Broad simple material planes, matte armor and cloth, elegant minimal atmosphere. No text, no letters, no logos, no watermark, no UI or interface frame.

### Command Center: selected refinement

Reference: the initial Command Center image (same hooded commander, palette, painting style). The tool returned a 3:1 image even when asked for a shallow strip. Selected output: `headers/command-center.webp`.

Use case: stylized-concept. Asset type: extremely wide short desktop application banner, aspect ratio 8:1, target 3072x384 pixels. Generate a panoramic shallow strip, NOT a standard landscape picture. Use the reference only for painting style, palette, and hooded commander identity. Change composition to fit a very short banner: one small hooded armored commander and compact glowing tactical table on the right, face and table both completely visible within the middle 60% of image height, centered at x=76%, y=52%. The subject should occupy only 18% of total image width. Left 50% completely empty near-black charcoal. Top-right 20% quiet black, no tall architecture. One restrained crimson halo behind the figure, no clutter, no symbols or banners behind him. Clean premium cinematic digital illustration, semi-realistic painterly planes, matte charcoal armor and cloth, restrained red #ff2a3a / #c3121f rim light, small glowing red eyes, tiny white highlights. Dark #08080a–#131316 background. No text, no logos, no watermark, no UI. Critical: keep the entire recognizable subject in the shallow strip, with space above head and below table.

### Ad Strategist: selected generation

Output: `agents/ad-strategist.webp`.

Use case: stylized-concept. Asset type: square 1024x1024 character portrait for a dark ecommerce command-center app. Frontline Ecom style: premium cinematic digital illustration, semi-realistic with confident painterly planes, not photography, not pixel art or flat vector. Dark charcoal (#08080a–#131316) matte armor and black backdrop, restrained #c3121f / #ff2a3a soft red rim lighting, small warm white highlights only. One character, head and shoulders, eye-level camera, centered face with eyes at y=40%; head including helmet occupies x=28–72% and y=15–55%, shoulders below, ample dark margin. Face must read at 32px and in a horizontal card crop. Subject: Ad Strategist, a charismatic seasoned war-room general with angular black horned helm, face open and visible, short dark beard, confident slight smirk and glowing red eyes. Leaning forward with one gauntlet resting on a compact glowing red targeting tablet held near his chest, experienced and calculating, visibly human personality. Two compact swept horns provide the recognisable silhouette. Broad clean shapes, expressive face, natural anatomy, subtle material detail, no busy background. One focal subject, no extra figures. No text, no letters, no logos, no watermark, no frame, no UI baked into the image.

