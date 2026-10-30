import { runChecks } from '../../../../backend/src/autopilot/services/review/checks';

const english = 'This campaign plan covers audience, channels, budget and timeline for launch week. '.repeat(6);
const arabic = 'تغطي هذه الخطة الجمهور المستهدف والقنوات والميزانية والجدول الزمني لأسبوع الإطلاق. '.repeat(6);

const failed = (checks: ReturnType<typeof runChecks>): string[] => checks.filter((check) => !check.passed).map((check) => check.name);

describe('runChecks', () => {
  it('passes a complete English document', () => {
    expect(failed(runChecks(english, 'markdown', { language: 'en' }))).toEqual([]);
  });

  it('rejects content that is too short', () => {
    expect(failed(runChecks('Short.', 'markdown', { language: 'en' }))).toContain('length');
  });

  it('rejects placeholder text', () => {
    expect(failed(runChecks(`${english}\nPrice: TBD`, 'markdown', { language: 'en' }))).toContain('no_placeholders');
    expect(failed(runChecks(`${english}\n[insert logo here]`, 'markdown', { language: 'en' }))).toContain('no_placeholders');
  });

  it('rejects English output when Arabic was required', () => {
    expect(failed(runChecks(english, 'markdown', { language: 'ar' }))).toContain('language');
  });

  it('requires both languages for bilingual deliverables', () => {
    expect(failed(runChecks(english, 'markdown', { language: 'both' }))).toContain('language');
    expect(failed(runChecks(`${english}\n${arabic}`, 'markdown', { language: 'both' }))).toEqual([]);
  });

  describe('html', () => {
    const page = (body: string): string =>
      `<!doctype html><html><head><style>body{margin:0}</style></head><body><main>${body}<p>${english}</p></main></body></html>`;

    it('passes a self-contained page', () => {
      expect(failed(runChecks(page(`<p>${english}</p>`), 'html', { language: 'en' }))).toEqual([]);
    });

    it('rejects scripts and inline event handlers', () => {
      expect(failed(runChecks(page(`<p>${english}</p><script>alert(1)</script>`), 'html', { language: 'en' }))).toContain('html_no_scripts');
      expect(failed(runChecks(page(`<img onerror="alert(1)"><p>${english}</p>`), 'html', { language: 'en' }))).toContain('html_no_scripts');
    });

    it('rejects external resources', () => {
      expect(failed(runChecks(page(`<img src="https://tracker.example/x.png"><p>${english}</p>`), 'html', { language: 'en' }))).toContain('html_self_contained');
    });

    it('rejects an unfinished document', () => {
      expect(failed(runChecks(`<html><body><p>${english}</p>`, 'html', { language: 'en' }))).toContain('html_complete');
    });
  });
});
