import type { PlanTask } from '../../models/plan';
import type { ReviewCheck } from '../../models/run';

const MIN_LENGTH = { markdown: 300, html: 800 } as const;
const PLACEHOLDER = /lorem ipsum|\[insert|\[your |\bTBD\b|\bTODO\b|\{\{.*?\}\}/i;
const ARABIC_LETTER = /[؀-ۿ]/g;
const LATIN_LETTER = /[A-Za-z]/g;
const MIN_LANGUAGE_SHARE = 0.25;
const MIN_SECOND_LANGUAGE_SHARE = 0.1;

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/** Free, deterministic checks every deliverable must pass before any model judges it. */
export function runChecks(content: string, format: 'markdown' | 'html', task: Pick<PlanTask, 'language'>): ReviewCheck[] {
  const checks: ReviewCheck[] = [
    {
      name: 'length',
      passed: content.length >= MIN_LENGTH[format],
      detail: `${content.length} characters (minimum ${MIN_LENGTH[format]})`,
    },
    {
      name: 'no_placeholders',
      passed: !PLACEHOLDER.test(content),
      detail: PLACEHOLDER.test(content) ? 'contains placeholder text' : 'no placeholder text',
    },
    languageCheck(content, task.language),
  ];
  if (format === 'html') checks.push(...htmlChecks(content));
  return checks;
}

function languageCheck(content: string, language: PlanTask['language']): ReviewCheck {
  const arabic = count(content, ARABIC_LETTER);
  const latin = count(content, LATIN_LETTER);
  const total = Math.max(1, arabic + latin);
  const arabicShare = arabic / total;
  const latinShare = latin / total;
  const passed =
    language === 'ar'
      ? arabicShare >= MIN_LANGUAGE_SHARE
      : language === 'en'
        ? latinShare >= MIN_LANGUAGE_SHARE
        : arabicShare >= MIN_SECOND_LANGUAGE_SHARE && latinShare >= MIN_SECOND_LANGUAGE_SHARE;
  return { name: 'language', passed, detail: `arabic ${(arabicShare * 100).toFixed(0)}%, latin ${(latinShare * 100).toFixed(0)}%, required ${language}` };
}

function htmlChecks(content: string): ReviewCheck[] {
  const lower = content.toLowerCase();
  const complete = lower.includes('<html') && lower.includes('</html>');
  const scripted = /<script\b|\son[a-z]+\s*=|javascript:/i.test(content);
  const external = /\s(src|href)\s*=\s*["']https?:/i.test(content);
  return [
    { name: 'html_complete', passed: complete, detail: complete ? 'complete document' : 'missing <html> or </html>' },
    { name: 'html_no_scripts', passed: !scripted, detail: scripted ? 'contains script or event handler' : 'no scripts' },
    { name: 'html_self_contained', passed: !external, detail: external ? 'loads external resources' : 'self-contained' },
  ];
}
