export interface Repair {
  content: string;
  /** Human-readable list of what was removed; empty when nothing changed. */
  changes: string[];
}

const RULES: ReadonlyArray<{ label: string; pattern: RegExp; replacement: string }> = [
  { label: 'script block', pattern: /<script\b[\s\S]*?<\/script\s*>/gi, replacement: '' },
  { label: 'script tag', pattern: /<script\b[^>]*>/gi, replacement: '' },
  { label: 'event handler', pattern: /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, replacement: '' },
  { label: 'javascript link', pattern: /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, replacement: '$1=$2#$2' },
  { label: 'external stylesheet or font', pattern: /<link\b[^>]*href\s*=\s*["']https?:[^>]*>/gi, replacement: '' },
  { label: 'external CSS import', pattern: /@import\s+url\(\s*["']?https?:[^)]*\)\s*;?/gi, replacement: '' },
  { label: 'external image or media', pattern: /\s(src|srcset)\s*=\s*(["'])https?:[^"']*\2/gi, replacement: '' },
  { label: 'iframe or embed', pattern: /<(iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, replacement: '' },
];

/**
 * Removes unsafe or external parts from generated HTML in code instead of paying
 * for a new generation. The page is still shown in a sandboxed iframe; this is a
 * second layer.
 */
export function repairHtml(html: string): Repair {
  let content = html;
  const changes: string[] = [];
  for (const rule of RULES) {
    const count = content.match(rule.pattern)?.length ?? 0;
    if (count === 0) continue;
    content = content.replace(rule.pattern, rule.replacement);
    changes.push(`${count} ${rule.label}${count > 1 ? 's' : ''}`);
  }
  return { content, changes };
}
