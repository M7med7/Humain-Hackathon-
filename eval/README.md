# Evaluation

ZeroOne Autopilot is judged on two claims: it sends work to a person only when the work truly needs one, and it delivers the rest at the lowest compute cost. This folder holds the data used to test both claims.

## Held-out discipline

`*.heldout.json` files were written and committed **before** any router prompt or agent code existed. They are never used while developing or tuning. `datasets/CHECKSUMS` records their SHA-256 so any later edit is visible. Results are reported separately for `dev` and `heldout`.

The held-out split deliberately differs from dev:

- **Different business processes.** Dev covers campaign launch, employee onboarding and event planning. Held-out covers procurement, contract review, customer-support rollout, office relocation and a sales outreach push.
- **More Arabic.** About a third of held-out tasks are written in Arabic.
- **Look-alike pairs.** Tasks that sound physical or legal but are not ("design the printed banner", "prepare the signature page") sit next to ones that are ("collect the printed banners", "sign the agreement").

## Capability profile

Labels assume the platform's agents can:

- research from their own knowledge and from documents attached to the project
- write, translate (Arabic and English), summarize, analyze and compare
- produce documents, checklists, plans, schedules, emails and single-page HTML
- message people inside ZeroOne

and cannot:

- act in the physical world
- sign, commit the company legally, approve spending or move money
- log in to external systems or accounts the project has not connected
- speak for a person in a live call, meeting or interview
- know facts that exist only in someone's head or in files nobody provided

## Labels

Each routing task has one `executor`:

| executor | meaning |
|---|---|
| `ai` | an agent completes the whole task |
| `hybrid` | an agent prepares everything; a person does one final step |
| `human` | a person must do the task; an agent can at most remind or summarize |

`hybrid` and `human` tasks also carry a `reason` and the person's `action`:

| reason | example |
|---|---|
| `physical` | hand over the laptop, collect printed banners, inspect the venue |
| `authority` | sign a contract, approve the budget, make a hiring decision, pay a supplier |
| `access` | publish from the company ad account, create accounts in the HR system |
| `relationship` | negotiate on a live call, interview a candidate |
| `private_knowledge` | provide the brand logo files, confirm the new hire's start date |

| action | what the person does in the app |
|---|---|
| `approve` | yes / no on something the agent prepared |
| `provide` | upload a file or answer a question |
| `perform` | do it outside the app, then mark it done |

## Metrics

**Routing**
- accuracy over the three executors
- **missed human rate**: share of `human`/`hybrid` tasks labeled `ai` (the agent attempts something it cannot do; the costly error)
- **unnecessary human rate**: share of `ai` tasks sent to a person (wastes people's time)
- reason accuracy on correctly routed `human`/`hybrid` tasks

**End to end** (objectives)
- share of tasks delivered by agents, and human touches per project
- first-pass review acceptance and rework count
- cost per successfully delivered task (failed attempts still count)
- pass^k: the share of objectives that succeed on all k repeated runs
