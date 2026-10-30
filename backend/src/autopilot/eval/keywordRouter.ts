import type { RoutingDecision } from '../models/routing';
import type { RoutableTask } from '../services/prompts/router.prompt';

/**
 * Zero-cost baseline: routes by keywords alone. It shows how far simple rules get
 * and where the model earns its cost (look-alike tasks, Arabic phrasing).
 */
const HUMAN_PATTERNS = [
  /\bsign(s|ed)?\b/i, /\bsignature\b/i, /\bpay\b/i, /\bpayment\b/i, /\bdeposit\b/i, /\bapprove\b/i,
  /\bhand (the|over)\b/i, /\bcollect\b/i, /\binspect\b/i, /\bpack\b/i, /\bhold\b/i, /\bcall(s)?\b/i,
  /\binterview\b/i, /\blive session\b/i, /\bprovide\b/i, /\bconfirm\b/i, /\bshare\b/i,
  /وق[ّ]?ع/, /توقيع/, /ادفع/, /دفع/, /اعتم[د]/, /تف[ق]ّ?د/, /غل[ّ]?ف/, /زو[ّ]?د/, /حد[ّ]?د/, /أك[ّ]?د/,
];

const HYBRID_PATTERNS = [
  /\bbook\b/i, /\bpublish\b/i, /\bsend\b/i, /\bregister\b/i, /\bconfigure\b/i, /\bcreate .*accounts?\b/i,
  /\bupload\b/i, /\bupdate .*address\b/i, /\border\b/i, /\brecord\b/i, /احجز/, /أرسل/, /سج[ّ]?ل/,
];

export function keywordRoute(tasks: readonly RoutableTask[]): RoutingDecision[] {
  return tasks.map((task) => {
    const text = `${task.title} ${task.description}`;
    if (HUMAN_PATTERNS.some((pattern) => pattern.test(text))) {
      return { taskId: task.id, executor: 'human', reason: 'authority', action: 'perform', role: null, rationale: 'keyword match' };
    }
    if (HYBRID_PATTERNS.some((pattern) => pattern.test(text))) {
      return { taskId: task.id, executor: 'hybrid', reason: 'access', action: 'perform', role: 'writer', rationale: 'keyword match' };
    }
    return { taskId: task.id, executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'no keyword match' };
  });
}
