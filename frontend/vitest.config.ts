import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, '../test/frontend');
const nm = path.resolve(__dirname, 'node_modules');

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Test files live outside frontend/, so Vite can't walk up to frontend/node_modules.
    // These aliases ensure all packages resolve to the single frontend/node_modules copy.
    alias: [
      { find: /^react\/(.+)$/, replacement: `${nm}/react/$1` },
      { find: /^react$/, replacement: `${nm}/react/index.js` },
      { find: /^react-dom\/(.+)$/, replacement: `${nm}/react-dom/$1` },
      { find: /^react-dom$/, replacement: `${nm}/react-dom/index.js` },
      { find: /^react-router-dom$/, replacement: `${nm}/react-router-dom` },
      { find: /^@testing-library\/(.+)$/, replacement: `${nm}/@testing-library/$1` },
      { find: /^lucide-react$/, replacement: `${nm}/lucide-react` },
    ],
  },
  server: {
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: [path.join(testDir, 'setup.ts')],
    include: [`${testDir}/**/*.test.{ts,tsx}`],
    globals: true,
  },
});
