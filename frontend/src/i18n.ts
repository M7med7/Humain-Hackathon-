import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enAuth from './locales/en/auth.json';
import enProjects from './locales/en/projects.json';
import enTasks from './locales/en/tasks.json';
import enBoard from './locales/en/board.json';
import enTeam from './locales/en/team.json';
import enReports from './locales/en/reports.json';
import enIntegrations from './locales/en/integrations.json';
import enErrors from './locales/en/errors.json';
import enSearch from './locales/en/search.json';
import enSpaces from './locales/en/spaces.json';

import arCommon from './locales/ar/common.json';
import arNavigation from './locales/ar/navigation.json';
import arAuth from './locales/ar/auth.json';
import arProjects from './locales/ar/projects.json';
import arTasks from './locales/ar/tasks.json';
import arBoard from './locales/ar/board.json';
import arTeam from './locales/ar/team.json';
import arReports from './locales/ar/reports.json';
import arIntegrations from './locales/ar/integrations.json';
import arErrors from './locales/ar/errors.json';
import arSearch from './locales/ar/search.json';
import arSpaces from './locales/ar/spaces.json';

export const LANGUAGE_STORAGE_KEY = 'zeroone-language';
export const supportedLanguages = ['en', 'ar'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const namespaces = [
  'common',
  'navigation',
  'auth',
  'projects',
  'tasks',
  'board',
  'team',
  'reports',
  'integrations',
  'errors',
  'search',
  'spaces',
] as const;

const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    auth: enAuth,
    projects: enProjects,
    tasks: enTasks,
    board: enBoard,
    team: enTeam,
    reports: enReports,
    integrations: enIntegrations,
    errors: enErrors,
    search: enSearch,
    spaces: enSpaces,
  },
  ar: {
    common: arCommon,
    navigation: arNavigation,
    auth: arAuth,
    projects: arProjects,
    tasks: arTasks,
    board: arBoard,
    team: arTeam,
    reports: arReports,
    integrations: arIntegrations,
    errors: arErrors,
    search: arSearch,
    spaces: arSpaces,
  },
};

function applyDocumentDirection(language: string): void {
  const normalized: SupportedLanguage = language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = normalized;
  document.documentElement.dir = normalized === 'ar' ? 'rtl' : 'ltr';
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages as unknown as string[],
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    ns: namespaces as unknown as string[],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    returnEmptyString: false,
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: import.meta.env.DEV
      ? (languages, ns, key) => {
        console.warn(`[i18n] Missing translation key "${ns}:${key}" for: ${languages.join(', ')}`);
      }
      : undefined,
  });

// Set <html lang>/<dir> synchronously on module load (before first paint) and
// keep it in sync on every language change — this is the single place that
// writes document-level direction, so it never drifts from i18next's state.
applyDocumentDirection(i18n.language);
i18n.on('languageChanged', applyDocumentDirection);

export default i18n;
