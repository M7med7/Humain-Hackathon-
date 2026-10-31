const REPOSITORY_URL = 'https://github.com/M7med7/Humain-Hackathon-';

/** Evidence a reviewer may want next to the live demo: the evaluation results and the code. */
export const EVIDENCE_LINKS = [
  { key: 'results', href: `${REPOSITORY_URL}/blob/main/eval/RESULTS.md` },
  { key: 'code', href: REPOSITORY_URL },
] as const;
