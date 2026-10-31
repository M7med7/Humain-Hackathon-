# Iteration log

Every change below was made on the **dev** split only. The held-out split is run once, at the end, with the final configuration.

## Routing v1 (router-v1, Gemini 3.5 Flash-Lite, batched, minimal thinking)

| Router | Accuracy | Missed person | Unnecessary person | Calls | Cost |
|---|---|---|---|---|---|
| Keyword rules (no model) | 90.0% | 17.6% | 4.3% | 0 | $0 |
| Batched Flash-Lite | 95.0% | 0.0% | 0.0% | 2 | $0.006 |

The keyword rules were written after reading dev, so their dev score is optimistic. The two router errors (confirming a start date, choosing a buddy) are borderline labels; the prompt was not tuned for them, to avoid fitting dev.

## Engine run 1 (obj-dev-01, campaign launch, scope change injected)

Completed on day 1 of 10, 7 of 9 tasks by agents, 86% first-pass acceptance, scope change absorbed with the deadline intact. 21 calls, 49.6k tokens, $0.16.

Defects found and fixed:

| Defect | Evidence | Fix |
|---|---|---|
| HTML markup and CSS counted as English in the language check | A bilingual page measured 90% Latin and was rejected | Language check reads visible text only (regression test added) |
| Reviewer misled by its own token optimization | Tags are stripped before judging; the judge rejected a valid page as "plain text, no HTML" | The judge is told markup was removed and to judge content only |
| Third attempt ran out of output tokens | Gemini counts thinking toward the output limit; medium thinking exhausted 9k tokens | Output limit grows with the thinking level; HTML limit raised to 16k |
| Plans stopped at documents | 0% of expected human checkpoints (budget approval, publishing ads, brand files) appeared in the plan | Planner v2 plans through to the real-world outcome and makes those steps explicit |

## Engine run 2 (planner-v2, all three dev objectives)

| Objective | Delivered | Agent share | First-pass | Human checkpoints covered | Perturbation | Calls | Cost |
|---|---|---|---|---|---|---|---|
| Campaign launch | day 1/10 | 82% | 78% | 67% (was 0%) | scope change handled | 27 | $0.120 |
| Employee onboarding | day 4/7 | 44% | 25% | 100% | bad output caught | 15 | $0.023 |
| Customer event | day 3/14 | 80% | 88% | 67% | silent person reassigned | 20 | $0.031 |

Onboarding's 25% first-pass rate traced to three causes, all fixed for run 3:

| Cause | Evidence | Fix |
|---|---|---|
| Writers did not know who signs | Emails ended with "[Your Name]" and failed the placeholder check | Workers get the project's people and a named sender (worker-v2); mail-merge fields like `{{first_name}}` are allowed for unknown recipients |
| Hybrid tasks judged on the person's step | "Send welcome emails" rejected because hires had not confirmed receipt | The judge is told a person finishes the task and to judge only the agent's part (reviewer-v2) |
| The page builder kept adding scripts and web fonts | Each rejection paid for a 16k-token regeneration | Scripts, handlers and external resources are removed in code before review, with no model call |

## Engine run 3 (worker-v2, reviewer-v2, HTML repair; all three dev objectives)

| Objective | Delivered | Agent share | First-pass* | Human checkpoints covered | Perturbation | Calls | Cost |
|---|---|---|---|---|---|---|---|
| Campaign launch | day 3/10 | 80% | 75% | 0% | scope change handled | 29 | $0.055 (was $0.120) |
| Employee onboarding | day 3/7 (was 4) | 43% | 33% | 100% | bad output caught | 12 | $0.018 |
| Customer event | day 6/14 | 78% | 71% | 33% | silent person reassigned | 23 | $0.028 |

\* Computed before the metric fix below; it still counted the task the scenario corrupted on purpose.

What this run taught us:

- **Cost fell** on the campaign launch (−55%) once generated pages were repaired in code instead of regenerated.
- **The first-pass metric was unfair to the system.** With few agent tasks, the deliberately corrupted one dominated the rate (onboarding could not exceed 67%). Corrupted tasks are now excluded from first-pass and scored only under perturbation handling.
- **Single runs are noisy.** Human-checkpoint coverage on the identical campaign config moved 67% → 0%. The plan did route "Schedule emails and social posts" to a person, but the keyword metric only accepts "publish" or "ad account". Two consequences: final results use repeated trials (pass^k), and the keyword coverage metric is reported with this known false-negative limitation. Held-out keywords stay frozen.

## Free-tier configuration and user testing (commit 4b938b7 → ceeda2c)

- **Models:** routing and review moved to Gemini 3.1 Flash-Lite after a dev comparison with 3.5 Flash-Lite (same 97.5% accuracy, 0 missed human tasks, 39% cheaper, 2× faster); planning and writing use 3.5 Flash-Lite. Each falls back to the other, spreading work over two daily quotas.
- **Fabrication found in user testing (not in the datasets):** on a software objective, the reviewer asked for a repository link and an iOS build, and the agent's retry invented both. Fixes: honesty rules for workers (worker-v3), a code check that rejects links absent from the provided material, and a reviewer that fails fabricated claims and never asks agents for what only a person can provide (reviewer-v3/v4). Dev check afterwards: 0 invented links, first-pass 75%.
- **Held-out evaluation** ran at commit ceeda2c. Five held-out runs made before the fabrication fix were set aside unread in `objectives/heldout-v1/`; they are used only to compare invented-link counts.

## Held-out evaluation (ceeda2c): see RESULTS.md

10 of 10 runs finished on time; pass^2 = 5 of 5 objectives; 16 of 16 injected problems handled; 76% of tasks done or prepared by agents; $0.035 per project. Main limitation: tasks that need data nobody provided (for example company contact details) bounce between "invented" and "incomplete" in review.

## After the evaluation (not reflected in held-out numbers)

Found while reviewing a live run inside ZeroOne:
- reviewer-v5: the judge sees the plan's other tasks and does not require their work (a strategy outline was rejected twice for lacking the email sequence, which is a separate task);
- worker-v4: agents never present a deliverable as written or approved by a person (an outline said "Prepared by: Reem");
- the polling-supervisor ablation baseline ignores its own malformed answers instead of stopping the run.

Found while rehearsing the game demo (2D sandbox game in Unity):
- reviewer-v7: on steps a person finishes, each criterion is shown to the judge as preparation ("Prepares everything the person needs so that: …"). Before, both such steps were rejected three times for criteria only the person could meet (Steam fee paid, build uploaded), then escalated.
- worker-v5: the agent is told when a person does the final step and prepares a hand-off (material plus a checklist) against the same framed criteria. Before, its first draft claimed the store page was already live.

Ablations stopped by the free-tier quota are re-run after the daily reset with this final code, together with a fresh full baseline.
