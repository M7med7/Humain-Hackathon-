import { runChecks } from '../../../../backend/src/autopilot/services/review/checks';
import { repairHtml } from '../../../../backend/src/autopilot/services/review/repair';

const body = '<p>Ramadan Blend, 20% off with free delivery after Iftar. Order online or visit one of our six Riyadh cafes.</p>'.repeat(8);

describe('repairHtml', () => {
  it('leaves a clean page untouched', () => {
    const page = `<!doctype html><html><body>${body}</body></html>`;
    expect(repairHtml(page)).toEqual({ content: page, changes: [] });
  });

  it('removes scripts, handlers and external resources so the page passes the safety checks', () => {
    const page = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal">',
      '<style>@import url("https://cdn.example/x.css"); body{margin:0}</style>',
      '<script src="https://cdn.example/app.js"></script><script>track()</script>',
      `</head><body onload="track()"><a href="javascript:alert(1)">Order</a><img src="https://img.example/a.png" alt="cup">${body}`,
      '<iframe src="https://maps.example/embed"></iframe></body></html>',
    ].join('');
    const { content, changes } = repairHtml(page);
    expect(content).not.toMatch(/<script|onload=|javascript:|https?:/i);
    expect(changes.length).toBeGreaterThanOrEqual(6);
    const failed = runChecks(content, 'html', { language: 'en' }).filter((check) => !check.passed);
    expect(failed).toEqual([]);
  });
});
