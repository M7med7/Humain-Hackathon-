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
