# ZeroOne Autopilot

**Give it an objective. AI agents do the work. People step in only when they're truly needed.**

Submission for the AI Builders Hackathon (HUMAIN × Misk), Challenge 3: Autonomous Enterprise.

- **Live app:** https://zeroone-autopilot.vercel.app — choose **Enter as a judge** on the sign-in page. Judges land on Autopilot with a four-step guide, a link to the showcase run (press **Replay** on its workflow to watch it build) and links to the test results and code. The tour is view-only; creating or changing runs requires an account.
- **Evaluation results:** [`eval/RESULTS.md`](eval/RESULTS.md) · iteration log: [`eval/ITERATIONS.md`](eval/ITERATIONS.md) · test design: [`eval/README.md`](eval/README.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## The problem

Project tools are good at planning work, and then they wait for people: someone still chases status, reassigns tasks and writes the report. Much of the work itself (drafts, research, pages, plans, reports) can now be done by AI. The hard part is knowing which steps truly need a person: approvals, publishing, credentials, sign-off, or information only someone has.

## What Autopilot does

A project manager writes one objective, a deadline and the people who can approve or act. Autopilot then:

1. **Plans** the work and schedules it against the deadline.
2. **Routes every task** to agents, to agents plus a person, or to a person, and records the reason.
3. **Does the agent work**, and a reviewer checks every deliverable before it is accepted.
4. **Asks people only for real-world steps** (approve, provide information, perform an action) through a single "Needs you" list.
5. **Adapts** when things change (a client scope change, a silent teammate, broken agent output) by re-planning, reassigning or escalating the trade-off. People can also change the workflow at any time, even after it finished: ask the AI to change a step, or add and remove steps, and the agents carry on.
6. **Reports** the outcome in English and Arabic, built only from what actually happened, and mirrors the project into ZeroOne's board.

## How it works

Six agent roles share one event-driven engine:

| Role | Job | Model use |
|---|---|---|
| Planner | Turns the objective into tasks, dependencies and estimates | At kickoff, and again only when new scope arrives |
| Router | Decides agents / agents + person / person for each task, with a reason | Small model, structured output |
| Scheduler | Wakes an agent only when its inputs are ready; detects stalls | None (plain code) |
| Workers | Produce deliverables (documents, emails, plans, HTML pages) | Cheapest model first; a stronger one only after a rejected attempt; each sees only its task and direct inputs |
| Reviewer | Checks each deliverable | Code checks first; an AI judge only when needed |
| Lead | Reacts to changes, reassigns silent people, escalates decisions, writes the report | Reminders and deadline checks are plain code; a model only for the report |

**Compute choices:** agents cost nothing while idle (event-driven, no polling loop); cheap models first with escalation only after a failed review; scoped context per agent; deterministic checks before any model call; a hard token budget per run. Every optimization can be switched off to measure its effect (see ablations in [`eval/RESULTS.md`](eval/RESULTS.md)).

**Safety choices:** agents have no tools that act outside the app, so anything external is routed to a person by design; client text is passed as delimited data; model output is schema-validated and generated HTML is shown in a sandboxed iframe with scripts disabled.

## Results

Held-out test data was written and committed before any agent code existed ([`eval/datasets/CHECKSUMS`](eval/datasets/CHECKSUMS)). Highlights from [`eval/RESULTS.md`](eval/RESULTS.md):

| Measure | Result |
|---|---|
| Projects delivered on time (5 held-out objectives × 2 runs) | 10 / 10 |
| Injected problems handled (scope changes, corrupted output, silent person) | 16 / 16 |
| Routing accuracy on 40 held-out tasks (per-task router) | 95%, with 0% missed-person and 0% unnecessary-person errors |
| Tasks done or prepared by agents | 76% on average |
| First-pass review acceptance | 61% |
| Model cost per project | $0.035 on average (22 calls) |
| Fake links in accepted deliverables | 0 of 45 |
| Tokens saved by event-driven agents (ablation) | 58–76% |

## What we tested and what we learned

**Tested:** routing on 40 held-out tasks (a third in Arabic, with look-alike pairs such as "design the printed banner" vs "collect the printed banners"); 5 held-out business processes run end to end twice each, with problems injected mid-run (client scope changes, corrupted agent output, a teammate who never answers); ablations that switch each optimization off; and 243 automated tests. Every change was made on the dev split; the held-out split was run only with the final configuration.

**Learned** (full log with evidence in [`eval/ITERATIONS.md`](eval/ITERATIONS.md)):

- **Plans stopped at documents.** The first planner covered 0% of the real-world checkpoints (budget approval, publishing, brand files). Planning through to the real outcome raised coverage to 67%.
- **Optimizations can mislead the reviewer.** Stripping markup to save tokens made the judge reject a valid page as "plain text"; the judge is now told what was removed.
- **Fix in code, not with another model call.** Repairing generated pages in code instead of regenerating them cut the campaign run's cost by 55%.
- **Single runs are noisy.** The same configuration scored 67% and then 0% on one metric, so final results use repeated trials (pass^2).
- **Fewer calls cost accuracy.** Batching routing into 2 calls instead of 40 lost 5 points of accuracy on held-out tasks.
- **Missing inputs are the hardest case.** Most rejections (39 of 48) came from the review judge, typically when agents invented or omitted details nobody provided. This is the main next step.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, React Flow (workflow canvas), i18next (English and Arabic, RTL) — deployed on Vercel |
| Backend | Node.js, Express 5, TypeScript, Zod — deployed on Render |
| Data and auth | Supabase (PostgreSQL, Auth, row-level security) |
| AI | Google Gemini Flash-Lite model tiers |
| Tests | Jest and Supertest (backend), Vitest and Testing Library (frontend) |

## What is new in this repository

Autopilot is a new module built for the hackathon on top of ZeroOne Manager, an existing project-management app that provides authentication, workspaces, the task board and dashboards. The hackathon work lives in:

- `backend/src/autopilot/` — the agent engine, services, prompts, controllers and evaluation runner
- `frontend/src/features/autopilot/` — the Autopilot screens (objective, run view, agents at work, workflow canvas, timeline, deliverables, report)
- `eval/` — datasets, recorded results and the iteration log
- `migrations/add_autopilot_runs.sql`, `migrations/add_judge_access.sql` — the new tables and view-only judge access

## Run it locally

**Prerequisites:** Node.js 20 or newer, a Supabase project, and a Gemini API key.

1. **Database.** In the Supabase SQL editor run, in order: [`schema.sql`](schema.sql), [`migrations/fill_schema_gaps.sql`](migrations/fill_schema_gaps.sql), [`migrations/add_spaces.sql`](migrations/add_spaces.sql), [`migrations/add_autopilot_runs.sql`](migrations/add_autopilot_runs.sql), [`migrations/add_judge_access.sql`](migrations/add_judge_access.sql), [`migrations/default_assigned_tech.sql`](migrations/default_assigned_tech.sql).

2. **Backend** — create `backend/.env` (see [`.env.example`](.env.example) for every option):

   ```env
   PORT=5001
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   GEMINI_API_KEY=your-gemini-api-key
   ALLOWED_ORIGIN=http://localhost:5173
   ```

3. **Frontend** — create `frontend/.env`:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-key
   VITE_API_URL=http://localhost:5001
   ```

4. **Start both** (two terminals):

   ```bash
   cd backend && npm install && npm run dev
   ```

   ```bash
   cd frontend && npm install && npm run dev
   ```

5. Open http://localhost:5173, sign up, choose **Autopilot**, and use **Try an example**. Keep **Simulate my team's replies** on to watch a full run in about two minutes: simulated teammates answer their own requests, while anything addressed to you or needing your decision waits in **Needs you**. **Agents at work** shows which agents are working, on what, and which are asleep. **Workflow** draws the plan as a live graph: boxes appear as the plan is made, steps light up while an agent works on them, and clicking a step shows why it was routed that way, its acceptance criteria, its draft and any approval waiting on it. In the same panel, ask the AI to change the step or remove it; **Change the workflow** adds or removes steps for the whole run, and **Replay** plays a run back from its activity log. While the run is active, use **Message from the client** to change the scope and watch the lead agent re-plan.

Never commit `.env` files or expose the service-role key to the browser. [`scripts/check-secrets.sh`](scripts/check-secrets.sh) scans for credentials and is used as a pre-commit hook.

## Test it

```bash
cd backend && npm test     # 165 tests: engine, routing, reviewer, lead, workflow changes, auth, API
cd frontend && npm test    # 78 tests: Autopilot views, workflow graph and replay, plan diff, page loading, utilities
```

**Reproduce the routing evaluation without an API key.** Model responses are recorded, so the held-out routing numbers replay offline (any 20+ character placeholder satisfies the key check):

```bash
cd backend
GEMINI_API_KEY=replay-only-placeholder-key npm run eval:routing -- --split heldout --variant per-task --cache replay
```

**Run the full evaluation** (needs a real Gemini key; free tier works but is slow): `scripts/run-evaluation.sh` runs routing, the held-out end-to-end objectives (two trials each) and the ablations, then `cd backend && npm run eval:summary` regenerates [`eval/RESULTS.md`](eval/RESULTS.md). Each end-to-end run is saved as JSON under [`eval/results/objectives/`](eval/results/objectives/).

## Limitations and next steps

- **Missing inputs.** When a task needs information nobody provided, agents tend to invent it or leave it out, and the reviewer rejects the work. Next: detect missing information and ask a person before work starts.
- **Simulated people.** End-to-end tests use simulated teammates on a compressed clock; delivery days measure the plan, not a live team. Next: pilot with a real team.
- **Reproducibility.** Routing replays offline. The end-to-end recordings predate the latest reviewer and report prompt fixes, so replaying them offline stops early; re-running end to end needs a key.
- **Free-tier quota** (500 requests per model per day) stopped several ablation runs; they are reported as stopped, not counted.
- **No external actions yet.** Email, Slack and calendar steps are routed to people. Next: connect them behind explicit approvals.

## Project structure

```text
backend/            Express API (existing app routes + src/autopilot/)
frontend/           React app (existing pages + src/features/autopilot/)
eval/               datasets, recorded results, RESULTS.md, ITERATIONS.md
migrations/         SQL migrations, including Autopilot and judge access
docs/               architecture notes
scripts/            evaluation runner and secret check
schema.sql          base database schema
render.yaml         backend deployment definition
```
