import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const localesRoot = resolve('src/locales');
const languages = ['en', 'ar'];

function flatten(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, output);
    else output[path] = child;
  }
  return output;
}

const namespaceFiles = readdirSync(resolve(localesRoot, 'en')).filter((file) => file.endsWith('.json')).sort();
const problems = [];
let keyCount = 0;

for (const namespaceFile of namespaceFiles) {
  const translations = Object.fromEntries(languages.map((language) => {
    const file = resolve(localesRoot, language, namespaceFile);
    return [language, flatten(JSON.parse(readFileSync(file, 'utf8')))];
  }));
  const allKeys = new Set(languages.flatMap((language) => Object.keys(translations[language])));
  keyCount += allKeys.size;

  if (allKeys.size === 0) problems.push(`${namespaceFile}: namespace is empty in both languages`);
  for (const key of allKeys) {
    for (const language of languages) {
      const value = translations[language][key];
      if (!(key in translations[language])) problems.push(`${namespaceFile}: ${language} is missing ${key}`);
      else if (typeof value !== 'string' || value.trim() === '') problems.push(`${namespaceFile}: ${language}.${key} is blank or not a string`);
    }
  }
}

console.log(`i18n coverage: ${keyCount} unique keys across ${namespaceFiles.length} namespaces`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('English/Arabic key parity: 100%');
}
