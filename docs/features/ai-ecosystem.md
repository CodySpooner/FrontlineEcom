# FRONTLINE ECOM — AI ECOSYSTEM
## Pixel-Art Super Office — Complete Feature Build Prompt

> Owner's feature spec, verbatim (2026-10-26). Visual target: `docs/reference/ai-ecosystem-reference.webp`.
> Build lane, ownership and how it maps onto this repo: `docs/backlog/ecosystem.md`. Repo rules: `CLAUDE.md`.

### YOUR MISSION

You are an expert full-stack developer, game systems engineer, pixel-art UI designer, and AI agent orchestration specialist.

I am currently developing an application called **FRONTLINE ECOM**, an AI-powered ecommerce business management platform.

**Your assignment is to build ONE new feature inside my existing application: the AI Ecosystem.**

Do not rebuild, redesign, or replace my existing dashboard, navigation, AI infrastructure, or other application pages.

Inspect the existing codebase first. Reuse its framework, styling system, authentication, backend, agent definitions, and existing services wherever possible.

Your task is to create an immersive, interactive, pixel-art office where I can visually manage up to **30 specialized AI agents** as if they were employees inside a living digital headquarters.

The interface should feel like a combination of:

- A premium isometric pixel-art management game.
- A futuristic cyberpunk corporate office.
- A real-time AI workforce monitoring system.
- An interactive mission-control simulation.

This must be a working application feature, not a static image or animation-only demonstration.

---

# 1. CORE FEATURE — THE LIVING AI OFFICE

Create a new page called:

**AI ECOSYSTEM**

Subtitle: "A LIVING WORKFORCE OF ECOMMERCE AGENTS"

Route: `/ecosystem`

Integrate this page into the existing FRONTLINE ECOM navigation without modifying other page layouts.

The page should feature a large, detailed, interactive isometric pixel-art office occupying most of the available screen.

The entire environment should resemble a futuristic business headquarters with multiple departments, individual employee workstations, advanced computer equipment, and animated AI characters.

Use the existing FRONTLINE ECOM branding:

- Dark charcoal and black.
- Red neon accent lighting.
- Graphite metallic surfaces.
- White typography.
- Subtle cyberpunk atmosphere.
- Existing company logo.

The office should feel alive even when the user isn't directly interacting with it.

Characters can walk, sit, type, collaborate, gather in meeting rooms, and perform task-related animations.

However, actual business activities must be synchronized with real agent execution state.

---

# 2. PIXEL-ART WORLD ENGINE

Build the office as an actual interactive environment rather than a static background.

Reuse the application's existing frontend architecture. If no appropriate renderer is present, use **PixiJS** with React integration for the isometric office scene.

Implement:

- Isometric tile-based world.
- Sprite sheets and frame-based animations.
- Multiple animation layers.
- A* grid-based pathfinding.
- Collision and tile occupancy checks.
- Interactive characters.
- Clickable workstations.
- Department boundaries.
- Smooth camera panning.
- Zoom controls.
- Animated environmental elements.
- Character interaction zones.
- Efficient rendering.

### Camera Controls

Allow users to:

- Click and drag to pan around the office.
- Scroll to zoom in and out.
- Double-click an agent to focus on it.
- Jump directly to a department.
- Reset camera position.
- Fit the entire office on screen.
- Toggle fullscreen office view.

The camera should feel smooth, similar to a polished management game.

Maintain sharp pixel-art rendering at appropriate zoom levels.

Do not blur or stretch sprites unnecessarily.

---

# 3. OFFICE LAYOUT AND DEPARTMENTS

Design a detailed office capable of supporting 30 workers.

The space should consist of ten functional departments.

| Department | Workstations |
|---|---:|
| Executive Headquarters | 2 |
| Product Research | 4 |
| Advertising | 4 |
| Creative Studio | 4 |
| Store Development | 3 |
| Analytics | 3 |
| Copywriting | 3 |
| Operations | 3 |
| Email & SMS | 2 |
| Integrations & Automation | 2 |
| **Total Capacity** | **30** |

### Environment Design

Create visually distinct rooms with matching architectural styling.

**Executive Headquarters**

A premium command room featuring a large conference desk, strategy screens, and a central AI operations hub.

**Product Research**

Multiple computer desks displaying product thumbnails, trend charts, and market research information.

**Advertising**

Workstations featuring campaign graphs, advertising dashboards, and creative performance displays.

**Creative Studio**

A visual production room with editing monitors, virtual media walls, camera equipment, and colorful creative screens.

**Store Development**

Developer workstations with multiple screens, code editor visuals, and ecommerce storefront previews.

**Analytics**

A data-heavy office containing wall-mounted graphs, reporting terminals, and performance visualizations.

**Copywriting**

Workstations with document screens, campaign boards, and writing-related animations.

**Operations**

Order fulfillment terminals, storage racks, shipping containers, and inventory displays.

**Email & SMS**

Messaging workstations and retention marketing displays.

**Integrations & Automation**

Server racks, glowing network equipment, and technical monitoring stations.

### Centerpiece

Create a central collaboration area with a large glowing holographic globe, digital company emblem, or futuristic conference table.

This should visually connect the departments and act as the headquarters' main gathering point.

Add subtle ambient animations, including blinking monitors, flickering lights, and animated data screens.

---

# 4. AI WORKER CHARACTER SYSTEM

Each deployed AI agent must have a unique pixel-art character.

The office supports a maximum of 30 characters at once.

### Character Identity

Every worker has:

- Unique agent ID.
- Display name.
- Assigned department.
- Specialized role.
- Character appearance.
- Workstation.
- Available capabilities.
- Current task.
- Current state.
- Task history.
- AI provider/model configuration, if available.

Use agent definitions from my existing application rather than creating a conflicting second agent system.

### Character Appearance

Create a coherent visual style using small, detailed pixel-art characters.

Allow variation in:

- Hair.
- Clothing.
- Jackets.
- Headsets.
- Accessories.
- Outfit colors.
- Character silhouettes.

Some agents could look like futuristic developers, corporate analysts, cyberpunk operators, creative workers, or technical specialists.

Characters should still appear like employees in the same fictional world.

### Required Character Animations

Implement at minimum:

1. Idle standing.
2. Walking in appropriate isometric directions.
3. Sitting at workstation.
4. Working/typing.
5. Thinking.
6. Talking.
7. Collaborating.
8. Task completed.
9. Awaiting approval.
10. Error/blocked.

Use proper sprite sheets where possible rather than simply moving static character images.

Each animation should transition naturally.

---

# 5. ACTUAL AGENT ACTIVITY CONTROLS CHARACTER BEHAVIOR

This is the most important feature.

**Characters must visually represent what their AI agents are actually doing.**

Example:

I assign the Product Research agent a task to find five potential winning products.

The following should happen:

1. The backend creates a real agent task.
2. The office receives the task event.
3. The Product Research character responds.
4. The character walks to an assigned workstation.
5. It sits and begins a typing/research animation.
6. A small status indicator appears above the character.
7. The agent executes its research workflow through the existing backend.
8. The office receives actual progress and tool events.
9. The character changes its animation as appropriate.
10. When the task completes, a notification appears.
11. I can click the agent to view its real output.

### Agent States

Map backend states to office animation states.

| Agent State | Character Behavior |
|---|---|
| Idle | Standing, sitting, or ambient movement |
| Queued | Waiting indicator |
| Planning | Thinking animation |
| Running | Walking to workstation and working |
| Using Tool | Tool-specific visual activity |
| Collaborating | Moving toward meeting area |
| Awaiting Approval | Warning bubble |
| Completed | Brief completion animation |
| Failed | Error animation |
| Offline | Inactive workstation or character |

Idle characters can perform harmless ambient animations.

Never generate fake completed tasks or fake communication events that appear to represent real work.

---

# 6. VISUAL AGENT COMMUNICATION

I want to physically see AI workers communicating with each other.

For example:

My Product Hunter discovers a strong potential product.

Instead of simply showing a notification, its character can walk to the Market Analyst's desk.

A speech bubble appears:

"Found 3 promising products. Ready for analysis."

The Market Analyst acknowledges the structured task handoff and starts its assigned work.

Then the Market Analyst can communicate the results to the Advertising department.

### Implement

- Agent-to-agent communication animations.
- Speech bubbles.
- Real task handoff visualization.
- Collaborative meetings.
- Team activity indicators.
- Communication history.
- Subtle connection effects.
- Department-to-department workflow indicators.

The actual AI orchestration should not have to wait for the walking animation.

Movement visualizes the communication; the backend remains responsible for the real work.

Speech bubbles must summarize actual collaboration events rather than hallucinating conversations.

---

# 7. TEAM MEETINGS AND GROUP WORKFLOWS

Create a meeting system.

When several agents participate in one workflow, their characters can gather around a meeting table.

Example project:

**Launch a New Shopify Product**

Participating workers:

- Product Hunter.
- Market Analyst.
- Copywriter.
- Creative Studio.
- Store Developer.
- Ad Strategist.

### Visual Sequence

A new mission begins.

Participating agents briefly gather in the meeting area.

The project objective appears above the table.

After the kickoff, agents return to their departments and execute their assigned work.

When a handoff occurs, relevant agent interactions become visible.

Display a mission panel with:

- Mission name.
- Assigned agents.
- Current stage.
- Pending tasks.
- Completed tasks.
- Blocked tasks.
- Deliverables.
- Agent collaboration history.

Multi-agent workflows must use actual task dependencies and the existing orchestration system.

---

# 8. DIRECT INTERACTION WITH WORKERS

Every worker should be clickable.

### Clicking an Agent

Open a detailed side panel displaying:

**Agent Profile**
- Name.
- Character portrait.
- Department.
- Role.
- Description.
- Assigned model.

**Live Activity**
- Current status.
- Current task.
- Tool being used.
- Progress, if measurable.
- Most recent activity.

**Performance**
- Completed tasks.
- Failed tasks.
- Execution history.
- Token/API usage where available.
- Cost of recent work.

**Actions**
- Chat with Agent.
- Assign Task.
- View Task Output.
- View Activity History.
- Configure Agent.
- Pause or Cancel Task.
- Focus Camera.

Use existing backend endpoints and agent interfaces when available.

### Assigning Tasks

Clicking Assign Task should open a compact command panel.

Example:

"Find the top trending automotive accessories with estimated margins above 50%."

Submitting the instruction should create an actual task and cause the corresponding office character to begin its working sequence.

Provide meaningful loading, success, failure, and approval states.

---

# 9. DEPLOYING NEW AI WORKERS

Create a prominent red button:

**+ Deploy Agent**

Use or extend the application's existing agent creation system.

The deployment wizard should let me select:

- Agent name.
- Job specialization.
- Department.
- Available workstation.
- AI model/provider.
- Character appearance.
- Skills and tools.
- Permissions.
- Agent instructions.

When deployed, animate the new character entering the headquarters and traveling to the assigned workstation.

Update the worker counter.

For example:

`18 / 30 Agents Deployed`

Once 30 characters have been deployed, prevent additional deployments until capacity is freed.

An agent can be archived or removed without destroying its historical task records.

---

# 10. AI ECOSYSTEM PAGE INTERFACE

Follow the attached AI Ecosystem design reference and existing FRONTLINE ECOM UI styling.

### Header

Display:

**AI ECOSYSTEM**

"A LIVING WORKFORCE OF ECOMMERCE AGENTS"

### Top Status Cards

Create four compact cards:

- Deployed Agents: 24/30
- Active Tasks: live count
- Task Success Rate
- Active Teams

Use actual backend statistics when available.

### Navigation Tabs

- Office View
- Department View
- Agent List
- Task Board
- Performance

### Main Screen

The interactive isometric office should dominate the page.

Position it centrally, with the environment occupying the majority of the visible area.

### Right-Side Activity Panel

Create a collapsible real-time feed containing:

- Agent started a task.
- Agent completed a task.
- Agent handed work to another agent.
- Agent needs approval.
- Agent encountered an error.
- Team workflow advanced.
- Generated output available.

Clicking an event should focus on the relevant agent or open its task details.

### Bottom Control Bar

Include:

- Agent status key.
- Quick Assign.
- Deploy Agent.
- Create Team.
- Office Settings.
- Office Capacity.
- Active Jobs.

### Additional Toggles

Allow users to show or hide:

- Agent names.
- Speech bubbles.
- Department labels.
- Workload indicators.
- Collaboration connections.
- Character status icons.

The interface should remain clean even with all 30 workers active.

---

# 11. AGENT CUSTOMIZATION AND OFFICE PERSONALIZATION

Make the experience feel like managing a unique workforce.

### Character Customization

Allow changing outfits, colors, accessories, and character variations using available sprite assets.

### Workstations

Each agent has a persistent assigned desk.

Show its name or role when the workstation is selected.

### Office Customization

Support future additions such as:

- Different desk styles.
- Department decorations.
- Alternative lighting themes.
- Animated signs.
- Team banners.
- Office trophies.
- Additional ambient details.

Create the underlying system so cosmetic upgrades can be added later without rewriting the entire map.

---

# 12. OPTIONAL GAMIFICATION

Introduce simple visual progression that rewards meaningful completed work.

### Agent Levels

Possible progression:

- Recruit
- Specialist
- Expert
- Elite
- Master Operator

Agents can gain XP from verified completed workflows.

### Achievements

Examples:

- First Agent Deployed.
- First Team Created.
- First Completed Mission.
- First Agent Collaboration.
- Ten Successful Missions.
- Full Office — 30 Agents.
- One Hundred Completed Tasks.

Display earned achievements in an office trophy area or profile panel.

Agent levels are visual progression mechanics and should not falsely imply that the underlying language models become more intelligent.

---

# 13. REAL-TIME SYNCHRONIZATION

Create a clean connection between the existing AI backend and the virtual office.

Reuse existing event infrastructure if available.

Otherwise, implement a typed event adapter using WebSockets or Server-Sent Events.

### Example Event Interface

```ts
type AgentOfficeEvent =
  | {
      type: "agent.task.started";
      agentId: string;
      taskId: string;
    }
  | {
      type: "agent.task.completed";
      agentId: string;
      taskId: string;
    }
  | {
      type: "agent.task.failed";
      agentId: string;
      taskId: string;
    }
  | {
      type: "agent.handoff";
      fromAgentId: string;
      toAgentId: string;
      taskId: string;
      summary: string;
    }
  | {
      type: "agent.approval.required";
      agentId: string;
      taskId: string;
      approvalId: string;
    };
```

### Technical Requirements

- The backend remains the source of truth.
- Character animation never controls actual task execution.
- Office state restores correctly after reopening.
- Agent positions persist.
- Workstation assignments persist.
- Task status synchronizes automatically.
- Collaboration events trigger visual responses.
- Failed integrations show meaningful errors.
- Network reconnection does not duplicate events.
- Out-of-order messages do not corrupt agent states.

Allow the office to continue rendering smoothly while AI tasks execute asynchronously.

---

# 14. PERFORMANCE REQUIREMENTS

The office must support thirty animated characters without significant lag.

Target approximately 60 FPS on suitable desktop hardware.

Implement:

- Sprite batching.
- Texture atlases.
- Efficient pathfinding.
- Animation state machines.
- Cached static map layers.
- Optimized event handling.
- Camera-based rendering optimizations.
- Minimal unnecessary React rerenders.
- Reduced-motion support.
- Graceful fallback for lower-performance systems.

The office simulation must run independently of network requests.

Do not make AI API calls inside the rendering loop.

---

# 15. DEMO MODE AND DEVELOPMENT TESTING

If the existing agent backend does not yet support the necessary events, create a clearly labeled Demo Mode for testing.

Demo Mode should include:

- Example workers.
- Simulated tasks.
- Character movement.
- Department interactions.
- Speech bubbles.
- Example collaboration sequences.
- Completed task animations.
- Agent information panels.

This makes it possible to test the full experience before the real orchestration integration is complete.

However, build a clean separation between the demo-event provider and real-event provider.

Do not hardcode fake agent activity into the production execution path.

---

# 16. BUILD ORDER

Develop this feature in a practical sequence.

### Step 1 — Inspect Existing Project

Inspect the frontend, navigation, backend, agent management system, styling, and event architecture.

Determine how the feature should integrate without breaking existing functionality.

### Step 2 — Office Scene

Build the isometric environment, departments, decorations, camera, and interactive world.

### Step 3 — Character System

Implement sprites, movement, workstation assignment, animations, and the 30-agent capacity.

### Step 4 — Office UI

Implement header cards, view tabs, live activity, agent selection panels, camera controls, and department navigation.

### Step 5 — Agent Integration

Connect the simulation to existing agent task states and events.

### Step 6 — Collaboration

Implement task handoffs, meeting animations, speech bubbles, and workflow visualization.

### Step 7 — Direct Agent Controls

Implement task assignment, agent chat integration, activity inspection, configuration shortcuts, and supported cancellation.

### Step 8 — Customization and Polish

Add personalization, animation refinements, optional gamification, and performance optimizations.

### Step 9 — Testing

Verify real and demo execution, agent movement, scene persistence, collaboration, task state synchronization, and thirty-agent performance.

Keep the application runnable throughout development.

---

# 17. ACCEPTANCE CRITERIA

The feature is complete when:

- The existing FRONTLINE ECOM dashboard remains unchanged.
- A functional AI Ecosystem page has been added.
- The office is a real interactive isometric scene.
- Up to thirty distinct AI workers can be deployed.
- Every agent has a selectable character.
- Characters can move around the office using collision-aware pathfinding.
- Characters visibly work at assigned desks.
- Users can click workers to inspect their current tasks.
- Users can assign real tasks from the office interface.
- Agent activity changes character animations.
- Agent handoffs produce visible communication events.
- Multi-agent workflows can be represented by office meetings.
- Live activity and worker statistics use real backend data when connected.
- Demo Mode is clearly distinguished from real execution.
- Worker identities and workstation positions survive application restarts.
- The interface remains responsive with thirty deployed characters.
- No existing application features have been unnecessarily replaced or broken.

---

# FINAL DIRECTIVE

Build **ONLY the AI Ecosystem feature** and integrate it into my existing FRONTLINE ECOM application.

Do not rebuild my dashboard.

Do not redesign existing pages.

Do not replace my current stack unless absolutely necessary for the new feature.

The attached pixel-art office design is the visual target.

The office should look like a high-quality futuristic management game, but it must work as a real visual interface for my AI workforce.

**I want to see my agents walk to their desks, research products, write advertisements, collaborate with other agents, gather for projects, and complete real ecommerce tasks.**

The characters should make the AI ecosystem feel alive, while the existing backend handles the actual intelligence and business operations.

Begin by examining my current project, then implement the office scene, agent characters, interactions, and real-time integration.

The final result should be the centerpiece of FRONTLINE ECOM: **a living headquarters for up to 30 AI employees.**
