import { inventedLinks, runChecks, webLinks } from '../../../../backend/src/autopilot/services/review/checks';

const english = 'This campaign plan covers audience, channels, budget and timeline for launch week. '.repeat(6);
const arabic = 'تغطي هذه الخطة الجمهور المستهدف والقنوات والميزانية والجدول الزمني لأسبوع الإطلاق. '.repeat(6);

const failed = (checks: ReturnType<typeof runChecks>): string[] => checks.filter((check) => !check.passed).map((check) => check.name);

describe('invented links', () => {
  // The fabricated repository from a real run, written to satisfy a reviewer's request.
  const fabricated = `${english}\nRepository: https://github.com/m-alharbi/prayer-app-mvp-ios.`;

  it('extracts links without trailing punctuation', () => {
    expect(webLinks('See https://example.com/a. And (https://example.com/b), done')).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('flags links that appear in none of the provided material', () => {
    expect(inventedLinks(fabricated, 'Objective: launch the prayer app')).toEqual(['https://github.com/m-alharbi/prayer-app-mvp-ios']);
    expect(failed(runChecks(fabricated, 'markdown', { language: 'en' }, 'Objective: launch the prayer app'))).toContain('no_invented_links');
  });

  it('allows links the client provided', () => {
    const sources = 'Our store: https://qahwalab.example/shop';
    expect(failed(runChecks(`${english}\nOrder at https://qahwalab.example/shop.`, 'markdown', { language: 'en' }, sources))).toEqual([]);
  });
});

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

    it('does not count markup and CSS as English in a bilingual page', () => {
      const styled = `<!doctype html><html><head><style>${'.hero-section{display:flex;justify-content:center;background-color:white}'.repeat(30)}</style></head><body><p>${arabic}</p><p>${english.slice(0, 120)}</p></body></html>`;
      expect(failed(runChecks(styled, 'html', { language: 'both' }))).not.toContain('language');
    });

    it('rejects an unfinished document', () => {
      expect(failed(runChecks(`<html><body><p>${english}</p>`, 'html', { language: 'en' }))).toContain('html_complete');
    });
  });
});
