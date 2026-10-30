import { afterEach, describe, expect, it } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../../frontend/src/i18n';

describe('application language foundation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('updates document language and direction immediately', async () => {
    await i18n.changeLanguage('ar');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');

    await i18n.changeLanguage('en');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });

  it('persists a user-selected supported language', async () => {
    await i18n.changeLanguage('ar');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });

  it('uses Arabic plural forms', async () => {
    await i18n.changeLanguage('ar');
    expect(i18n.t('notifications.unreadCount', { ns: 'common', count: 0 })).toBe('لا إشعارات غير مقروءة');
    expect(i18n.t('notifications.unreadCount', { ns: 'common', count: 2 })).toBe('إشعاران غير مقروءين');
    expect(i18n.t('notifications.unreadCount', { ns: 'common', count: 11 })).toBe('11 إشعارًا غير مقروء');
  });

  it('keeps shared project terminology consistent in Arabic', async () => {
    await i18n.changeLanguage('ar');
    expect(i18n.t('newProject', { ns: 'projects' })).toBe('مشروع جديد');
    expect(i18n.t('createProject', { ns: 'projects' })).toBe('إنشاء مشروع');
    expect(i18n.t('createProject', { ns: 'navigation' })).toBe('إنشاء مشروع');
    expect(i18n.t('count', { ns: 'projects', count: 3 })).toBe('3 مشاريع');
  });
});
