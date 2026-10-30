import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Light and dark themes swap logo files. If a pair's pixel dimensions differ,
// object-contain renders the logo at a different size/position per theme.
const brandDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/src/assets/brand');

const THEME_LOGO_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['zeroone-dark-horizontal.png', 'zeroone-light-horizontal.png'],
  ['zeroone-dark-vertical.png', 'zeroone-light-vertical.png'],
  ['01-logo-dark-removebg-preview.png', '01-logo-light-removebg-preview.png'],
];

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(path.join(brandDir, file));
  // PNG IHDR: width and height are big-endian uint32 at byte offsets 16 and 20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('theme logo pairs', () => {
  it.each(THEME_LOGO_PAIRS)('%s and %s have identical dimensions', (dark, light) => {
    expect(pngSize(light)).toEqual(pngSize(dark));
  });
});
