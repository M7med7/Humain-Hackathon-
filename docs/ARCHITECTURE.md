# ZeroOne Autopilot — architecture

Autopilot is a new module added to the existing ZeroOne Manager application. It turns a business objective into a plan, does the work that AI can do, routes the rest to the right person, and keeps compute cost low. The existing application is unchanged except for bug fixes.

## Layers (MVC)

```
backend/src/autopilot/
├── config/          env validation (fails fast at startup) and model tiers
├── models/          domain types and zod schemas: tasks, runs, events, deliverables, routing decisions
├── repositories/    data access behind one interface: Supabase for the app, in-memory for tests and evaluation
├── services/        business logic, no HTTP and no SQL
│   ├── llm/         Gemini client: timeouts, retries, structured output, token accounting, record/replay
│   ├── prompts/     versioned prompt templates
│   ├── router       decides ai / hybrid / human for each task
│   ├── scheduler    event bus; wakes an agent only when its inputs are ready (no LLM)
│   ├── worker       produces deliverables for AI tasks
│   ├── reviewer     checks deliverables: deterministic checks first, LLM judge only when needed
│   └── lead         reacts to changes and failures, re-plans, escalates decisions to people
├── controllers/     HTTP handlers: validate input, call services, shape responses
├── routes/          URL wiring and per-route middleware (rate limits)
└── index.ts         composition root: builds services with their dependencies

frontend/src/features/autopilot/   views (React pages and components), hooks, API client
eval/                              datasets and the evaluation runner
```

Dependencies point one way: routes → controllers → services → repositories/models. Services receive their dependencies through constructors, so the same code runs against Supabase in the app and against memory in the evaluation harness.

## Changing a workflow after it starts

Runs are live in memory while they work, and every change is saved as a snapshot. People can change a run at any time from the workflow canvas:

- `POST /api/autopilot/runs/:id/changes` takes an instruction, optionally about one step. One planner call returns a checked revision: steps to update (and redo), steps to remove, and new steps (routed like the original plan). Steps an agent is working on cannot be changed.
- `DELETE /api/autopilot/runs/:id/tasks/:taskId` removes a step without a model call. It stays visible as removed, and later steps stop waiting for it.

A finished run reopens for the change and writes its report again when every step is done. A run that a server restart cut off is loaded from its snapshot when someone next answers or changes it: interrupted agent work starts again and open requests go back to people.

## Security

- **Secrets** live only in ignored `.env` files; configuration is validated at startup and the process refuses to start when a required value is missing. A pre-commit hook (`scripts/check-secrets.sh`) blocks credentials and env files.
- **Access control** reuses the existing middleware: every `/api` route needs a verified Supabase session and is scoped to the caller's space. The browser never talks to the new tables directly; row-level security is on with no public policies.
- **Input validation** with zod at every controller.
- **Cost abuse** is limited by per-user rate limits on Autopilot endpoints and a hard token budget per run.
- **Model output is untrusted.** Structured output is schema-validated before use. Generated HTML is shown only inside a sandboxed iframe with scripts disabled.
- **Prompt injection.** Client text and documents are passed as clearly delimited data. Agents have no tools that act outside the app; anything external is routed to a person by design, so injected instructions cannot trigger real-world actions.
- **Logs** record token counts, models, latency and cost, not prompt contents or keys.

## AI engineering and compute optimization

| Practice | Where |
|---|---|
| Event-driven agents that cost nothing while idle | scheduler |
| Deterministic code before any LLM call (dependencies, stalls, format checks) | scheduler, reviewer |
| Model tiers: Flash-Lite for routing and checks, Flash for writing, escalation only after a failed review | config, llm |
| Scoped context: each agent sees its task and its direct inputs only | worker |
| Stable prompt prefixes for implicit caching; cached tokens reported | prompts, llm |
| Structured output with schemas, low temperature for decisions | llm, router, reviewer |
| Timeouts, retries with backoff on 429/5xx, fallback model | llm |
| Versioned prompts, recorded responses for reproducible evaluation | prompts, llm |
| Every optimization can be switched off for ablation | config |
