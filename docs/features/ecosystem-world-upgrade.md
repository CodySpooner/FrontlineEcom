# ECOSYSTEM — CHARACTER REDESIGN & IMMERSIVE WORLD UPGRADE

> Owner's brief, verbatim (2026-10-31). Staged items: `docs/backlog/ecosystem.md` → "World upgrade".
> Character style reference: `.agent/character-reference.png` in the `ecosystem` worktree. It is a third-party pixel-art
> sheet (four armored/robed swordsmen, signed @GEORGE_TTOWERS), kept out of git on purpose: use it only as direction for
> proportions, shading, materials and detail level. Never copy its characters, never commit or ship the image.

## 1. START IN THE EXISTING ORCA WORKSTATION
Open the existing Orca workstation named exactly:

ecosystem

Start or resume the appropriate Codex development worker inside that workstation.

First verify the available Orca controls, repository, current branch, existing work, and worker status. Do not create a duplicate workstation or launch competing workers that could overwrite each other's changes.

Inspect the current AI Ecosystem implementation before modifying it. Understand its rendering approach, character assets, animation system, interactions, state management, and connections to the rest of the application.

Preserve working functionality and unrelated changes.

This is an ambitious creative and technical upgrade to the existing Ecosystem—not a request to replace it with a disconnected demonstration.

Proceed through implementation, testing, and refinement within the actual environment's capabilities. Do not stop after producing a plan, mood board, or attractive screenshot.

## 2. THE OVERALL VISION
The current ecosystem already looks good, but I want to push it much further.

I want it to feel like a living, intricately designed digital world inhabited by my AI agents—something visually impressive at first glance and increasingly interesting the longer I explore it.

The goal is not simply "add more effects."

The goal is stronger art direction, much better characters, richer environments, satisfying interactions, expressive animation, and carefully placed details that make the entire experience feel cohesive and exceptional.

Think: an explorable world with personality and purpose—not a dashboard covered in particles.

I want two levels of impact:

Immediate impact: The composition, characters, lighting, and motion should make the upgrade obvious immediately.

Long-term discovery: Looking more closely should reveal smaller environmental details, character behaviors, interactions, and visual connections that are easy to miss initially.

Use substantial creative freedom. Make confident artistic decisions rather than making only minor cosmetic adjustments.

At the same time, preserve the ecosystem's identity and usefulness. It should remain easy to understand which agents are present, what they are doing, and how to interact with them.

## 3. FIRST PRIORITY: REDESIGN THE CHARACTERS
The characters are the first major task.

They look acceptable now, but they do not fully match the theme or achieve the level of detail I want.

I will provide a reference image showing the general visual style, craftsmanship, and detail level I want them to resemble.

### How to use the reference
Study its visual language: proportions, silhouettes, materials, shading, lighting, clothing or equipment complexity, facial treatment, and overall presentation.

Use those qualities as artistic direction.

Do not recreate the exact characters, copy their identities, or produce slightly recolored versions of the reference.

Create original characters that belong specifically in our ecosystem.

If the reference image is not actually available, clearly identify that missing dependency. Continue inspecting the implementation and improving areas that do not depend on the reference, but do not pretend to have analyzed an image or finalize the reference-dependent character style from a guess.

### What the redesign should accomplish
Each character should have a recognizable silhouette, a distinct personality, and a coherent role within the world.

Make the differences meaningful through posture, clothing, equipment, accessories, expression, and movement—not merely a different accent color.

A research-focused character might have specialized scanning equipment or data instruments. A creative specialist could have a different visual vocabulary and tools. An analytical character might communicate precision through its design and behavior.

These are starting ideas, not mandatory costumes. Develop a stronger direction when the reference and existing theme suggest one.

### Detail without visual clutter
Improve the characters' construction and finish: material variation, layered forms, intentional accessories, convincing lighting, and small details that reward closer inspection.

However, detail must survive at the size the characters actually appear in the ecosystem.

A character should read clearly from the overview and reveal additional craftsmanship when inspected more closely. Avoid designs that look impressive only in a large isolated portrait.

Maintain consistent proportions, perspective, lighting direction, and rendering quality across the full cast.

### Upgrade the actual assets
Do not treat a new border, glow, background, or color filter as a complete character redesign.

Improve or replace the underlying character assets using the rendering and asset pipeline appropriate to this project.

If the application uses sprites, SVG, layered illustrations, rigs, or 3D models, work with that reality. Do not claim to have built animated 3D characters when the result is a static image with a CSS transform.

Where new assets require an unavailable tool or service, identify the limitation and pursue a supported alternative without misrepresenting the result.

## 4. GIVE THE CHARACTERS PERSONALITY THROUGH MOTION
The characters should feel present in the world rather than pasted onto it.

Create an animation language with restrained idle behavior, clear activity transitions, expressive reactions, and role-specific details.

Examples could include checking a display, adjusting a tool, observing a nearby object, preparing an output, or acknowledging a completed handoff.

Avoid giving every character the same looping bounce.

### State-driven behavior
Connect meaningful character behaviors to actual supported agent states.

| State | Possible visual treatment |
|---|---|
| Idle or available | Subtle posture shifts, occasional glances, quiet equipment activity. |
| Working | Focused interaction with the character's tools or workspace. |
| Collaborating | A visible handoff or communication effect associated with a real collaboration event. |
| Waiting for input or approval | An understandable, restrained attention cue. |
| Completed | A brief, satisfying completion response rather than a permanent celebration loop. |
| Interrupted or failed | A clear but non-disruptive indication with access to the actual explanation. |

Adapt these ideas to the actual execution model.

Decorative idle motion is welcome. Fabricated research activity, fake collaboration, or invented task completion is not.

Characters should also respond naturally to selection and focus without requiring constant motion to remain interesting.

## 5. SECOND PRIORITY: TAKE THE ENTIRE ECOSYSTEM MUCH FURTHER
Once the character direction is established, build the environment around that same level of quality.

Choose a coherent visual concept and execute it deeply.

Depending on the existing world and reference, this could resemble a sophisticated agent headquarters, an interconnected digital city, a detailed research complex, or another stronger concept that fits the application.

Do not combine unrelated themes simply because each one looks cool independently.

### Composition and depth
Give the environment a clear focal point, recognizable regions, intentional pathways, and a strong sense of scale.

Create separation between foreground, main activity areas, and background. Use lighting, atmosphere, layering, and perspective to make the scene feel dimensional.

Avoid a flat collection of floating panels or buildings arranged without visual logic.

The world should look deliberately composed from its default view—not require constant camera adjustments to become attractive.

### Distinct spaces with a shared identity
Where the existing agent roles support it, give different specialties recognizable spaces.

Possible directions include:

| Area | Creative possibilities |
|---|---|
| Research | Scanning instruments, reference displays, observation platforms, organized evidence trails. |
| Creative | An asset studio, production surfaces, evolving visual displays, expressive tools. |
| Analytics | Measurement equipment, readable information surfaces, precise movement, structured visual patterns. |
| Knowledge | A central archive, connected storage structures, meaningful links to saved information. |
| Automation and coordination | Routing structures, controlled transfer effects, visible task handoffs and system connections. |

These are creative prompts, not a requirement to invent new application capabilities.

Only represent a region as functional when it corresponds to an actual feature. Otherwise, keep it clearly environmental.

## 6. CREATE A COHESIVE MOTION AND EFFECTS SYSTEM
I want impressive animation, motion, and effects—but with direction and restraint.

Build a consistent motion language rather than adding unrelated animations to individual components.

Use different layers of movement:

Ambient motion: Slow environmental activity that makes the world feel alive without demanding attention.

Interaction motion: Responsive feedback for hovering, selecting, inspecting, navigating, and opening panels.

Event motion: More noticeable effects for genuine events such as a task starting, a handoff occurring, or an output becoming available.

The stronger the visual effect, the more meaningful the event should be.

### Creative possibilities
Explore effects such as illuminated routes, controlled energy transfers, animated machinery, layered atmosphere, subtle reflections, reactive lighting, holographic surfaces, and environmental transitions.

Make effects originate from believable places and interact with the scene rather than floating randomly over everything.

Light, motion, and color should reinforce the world's structure. A connection effect should make it easier to understand a relationship, not merely make the screen brighter.

### Avoid visual fatigue
Do not run every effect at full intensity all the time.

Vary timing and rhythm so the scene does not feel like one synchronized loop. Use quiet areas and moments of stillness to make important motion stand out.

Avoid excessive flashing, constant camera movement, heavy screen shake, unreadable glow, and distracting celebration effects.

Do not add unsolicited autoplay audio.

## 7. BUILD DETAILS THAT REWARD EXPLORATION
This is a major part of the request.

I want to notice new details after spending significant time in the ecosystem.

Create detail at multiple scales:

From a distance: Strong architecture, character silhouettes, lighting, and activity patterns.

At normal viewing distance: Role-specific equipment, environmental props, connections, signage, and small character behaviors.

When inspecting closely: Material details, tiny mechanical movements, thoughtful symbols, contextual responses, and subtle world-building touches.

Possible details include a character's tool reacting to a nearby event, a small mechanism moving inside a structure, an interface surface changing when a real output appears, or an environmental element responding to selection.

Use occasional discoveries and restrained Easter eggs where they fit the theme.

Do not hide essential controls, important errors, or required information behind Easter eggs.

Avoid filling the scene with meaningless microtext or invented performance numbers. Environmental decoration should not impersonate actual analytics.

The richness should come from deliberate design—not from scattering random props everywhere.

## 8. MAKE EXPLORATION AND INTERACTION SATISFYING
The ecosystem should be enjoyable to navigate, not just enjoyable to watch.

Improve the interactions that already exist and add useful ones where they fit naturally.

### Character interaction
Selecting an agent should clearly focus that character and provide access to its real identity, role, status, current work, and existing conversation or details.

Keep contextual information readable and consistent with the world's styling.

Do not make the user chase a moving character to click it.

### World navigation
Where supported by the layout, provide smooth, bounded pan and zoom, an easy return to the overview, and a reliable way to find a selected agent.

Avoid accidental navigation while interacting with controls.

For larger ecosystems, consider a restrained overview map or agent locator rather than forcing the user to search manually through a crowded scene.

### Connections and discoveries
Meaningful connections should be inspectable. When a visible relationship represents actual collaboration or shared knowledge, let the user understand what it means.

Use progressive detail: keep the overall scene attractive and uncluttered, then reveal additional information on selection or inspection.

Preserve keyboard access and usable touch interactions where applicable. Important actions must not depend exclusively on hover.

## 9. KEEP THE WORLD CONNECTED TO REAL APPLICATION STATE
The ecosystem must remain part of the real application.

Reuse actual agent identities, roles, store associations, execution states, conversations, and supported collaboration events.

Do not create a second, disconnected agent registry for the visual experience.

Keep store boundaries and permissions intact. Switching stores should not leave another store's agents, messages, or activity visible.

Distinguish clearly between:

Decorative world behavior, which exists to create atmosphere.

Functional agent behavior, which represents something that actually happened.

A beautiful simulated handoff must not be presented as evidence that two agents collaborated.

When data is loading, unavailable, or disconnected, show a suitable state rather than fabricating activity to keep the environment busy.

Clicking a character or decorative object must not unexpectedly launch a paid task, modify a store, or perform an external action.

## 10. PUSH THE VISUAL QUALITY WITHOUT SACRIFICING PERFORMANCE
The ecosystem should remain pleasant to use during a long session.

Optimize the experience as part of the artistic work—not after adding every effect.

Use an appropriate asset strategy, reuse resources where possible, and avoid unnecessary animation work for offscreen or hidden elements.

Manage renderer lifecycles, event listeners, animation loops, and resources carefully so navigating away and returning does not accumulate duplicate effects or memory usage.

### Quality levels and motion controls
Provide appropriate quality settings where the rendering workload justifies them.

A reduced-effects mode should remain attractive rather than feeling like a broken version of the scene.

Respect reduced-motion preferences and provide a way to pause or substantially reduce ambient animation.

Avoid making essential status information dependent on animation.

### Verify actual performance
Aim for smooth interaction on representative supported hardware and document the conditions tested.

Test realistic agent counts, larger populations, extended viewing, repeated navigation, resizing, and multiple simultaneous activity states.

Do not claim a universal frame rate based on one brief test.

The goal is a richly detailed world that remains responsive—not a visually impressive scene that becomes unpleasant after five minutes.

## 11. EXECUTE IN A CLEAR ORDER
Work through the upgrade in coherent stages.

### Stage One — Audit and establish the direction
Inspect the current implementation and available reference. Identify what should remain, what needs improvement, and which technical constraints influence the design.

Establish a shared visual language for characters, environment, materials, lighting, and motion.

### Stage Two — Prove the character direction
Develop one representative character to the intended quality level and evaluate it inside the actual ecosystem.

Check its readability, lighting, scale, animation, and compatibility with the environment before extending the direction across the cast.

Do not stop at an isolated character portrait that does not work in the application.

### Stage Three — Upgrade the full cast and environment
Apply the established character language consistently. Improve the world's composition, structures, depth, props, and supporting details.

### Stage Four — Integrate motion and real state
Add the ambient, interaction, and event animation systems. Connect functional effects to genuine application events.

### Stage Five — Refine, optimize, and test
Review the whole experience in motion, repair inconsistencies, improve performance, and verify existing functionality.

Capture useful before-and-after comparisons and maintain clear implementation checkpoints.

Use creative autonomy for ordinary artistic and technical decisions. Do not stop after each minor choice to request approval.

However, do not bypass missing references, paid asset purchases, destructive changes, or other genuine authorization requirements.

## 12. QUALITY BAR AND ACCEPTANCE CRITERIA
The upgrade is successful when the improvement is obvious across the entire experience—not just one polished corner.

The characters should be original, substantially more detailed, consistent with the reference's general quality and style, and integrated into the ecosystem's theme.

The environment should feel cohesive, dimensional, and intentionally designed, with both striking overall composition and rewarding close-up details.

Animation should communicate personality and activity while remaining comfortable to watch.

Interactions should be responsive and useful. Existing agent workflows should continue to function.

Verify character selection, agent details, navigation, store changes, real status transitions, waiting and error states, reduced motion, viewport resizing, and repeated mounting and unmounting.

Run the project's applicable build checks, type checks, linting, and relevant automated or manual tests.

Review the experience both as a static composition and as a moving scene. Screenshots alone are not sufficient to verify an animation-heavy feature.

Do not declare completion after adding glow, particles, and a few hover effects to otherwise unchanged assets.

## 13. FINAL HANDOFF
Provide a clear summary of the actual character, environment, animation, and interaction improvements.

Include screenshots and, where the environment supports capture, a short recording showing the experience in motion.

Report the checks performed, performance conditions tested, any unavailable capabilities, and remaining limitations.

Do not claim work continues in the background unless a real persistent worker is running. Do not automatically merge or deploy beyond the authorization already granted.

## FIRST ACTION
Open the existing Orca workstation ecosystem, start or resume its Codex worker, inspect the current implementation and available reference, and begin with the character redesign.

Then carry that quality level through the environment, animation, interactions, and finer details.

Be bold. I want an ecosystem that feels alive, original, and meticulously crafted—a world that is immediately impressive, genuinely useful, and still rewarding to explore after the first impression wears off.
