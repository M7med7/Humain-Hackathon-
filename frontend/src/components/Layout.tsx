import { useState, useRef, useEffect, useCallback } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Calendar, Users, FolderOpen, Plus, LogOut, Pencil, X, Check, Bell, Settings, ArrowLeftRight, Map, Search, Menu, Moon, Sun, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "./Logo";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { GridBackground } from "./GridBackground";
import { motion, AnimatePresence } from "motion/react";
import logoDarkUrl from "../assets/brand/01-logo-dark-removebg-preview.png";
import logoLightUrl from "../assets/brand/01-logo-light-removebg-preview.png";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import { supabase } from "../lib/supabase";
import { api, type AppNotification, type NotificationPreferences } from "../lib/api";

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const NOTIFICATION_TYPE_KEYS: Record<string, string> = {
  assignment: "assignments",
  mention: "mentions",
  comment: "comments",
  status_changed: "status_changes",
  due_soon: "due_reminders",
  overdue: "overdue_alerts",
  project_risk: "project_risk",
  file_uploaded: "comments",
};

export function Layout() {
  const { t } = useTranslation(["navigation", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, toggleLanguage } = useLanguage();
  const isAIActive = location.pathname.includes("task") || location.pathname.includes("create");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const email = session?.user.email ?? "";
  const fullName = session?.user.user_metadata?.full_name as string | undefined;
  const initials = getInitials(fullName, email);
  const displayName = fullName ?? email.split("@")[0];
  const isProjectsActive = location.pathname === "/" || location.pathname.startsWith("/projects/");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    api.users.getProfile(userId).then(({ profile }) => setAvatarUrl(profile.avatar_url)).catch(() => { });
  }, [session?.user.id]);

  const refreshNotifications = useCallback(() => {
    const userId = session?.user.id;
    if (!userId) return;
    api.notifications.list(userId)
      .then((data) => {
        setNotifications(data.notifications);
        setUnreadCount(data.unread_count);
        setPreferences(data.preferences);
      })
      .catch(() => { });
  }, [session?.user.id]);

  useEffect(() => {
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications]);

  useEffect(() => {
    const refresh = () => {
      const userId = session?.user.id;
      if (!userId) return;
      api.users.getProfile(userId).then(({ profile }) => setAvatarUrl(profile.avatar_url)).catch(() => { });
    };
    window.addEventListener('userProfileUpdated', refresh);
    return () => window.removeEventListener('userProfileUpdated', refresh);
  }, [session?.user.id]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setEditingProfile(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
        setShowPreferences(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const openEdit = () => {
    setNameInput(fullName ?? "");
    setPhoneInput(
      session?.user.id
        ? (localStorage.getItem(`phone_${session.user.id}`) ?? "")
        : ""
    );
    setSaveError(null);
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (!session?.user.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.users.update(session.user.id, { full_name: nameInput.trim(), phone: phoneInput.trim() });
      await supabase.auth.updateUser({ data: { full_name: nameInput.trim() } });
      if (phoneInput.trim()) {
        localStorage.setItem(`phone_${session.user.id}`, phoneInput.trim());
      } else {
        localStorage.removeItem(`phone_${session.user.id}`);
      }
      window.dispatchEvent(new CustomEvent('userProfileUpdated'));
      setEditingProfile(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("common:profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/login");
  };

  const openNotification = async (item: AppNotification) => {
    if (!item.read_at) {
      await api.notifications.markRead(item.id, true).catch(() => { });
      setNotifications((current) => current.map((n) => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    setNotificationsOpen(false);
    navigate(item.link_path ?? (item.project_id ? `/task/${item.project_id}` : "/"));
  };

  const markAllRead = async () => {
    if (!session?.user.id) return;
    await api.notifications.markAllRead(session.user.id);
    setNotifications((current) => current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
  };

  const toggleRead = async (item: AppNotification, read: boolean) => {
    await api.notifications.markRead(item.id, read);
    setNotifications((current) => current.map((n) => n.id === item.id ? { ...n, read_at: read ? new Date().toISOString() : null } : n));
    setUnreadCount((count) => Math.max(0, count + (read ? -1 : 1)));
  };

  const updatePreference = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!session?.user.id || !preferences) return;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    const { preferences: saved } = await api.notifications.updatePreferences(session.user.id, { [key]: value });
    setPreferences(saved);
  };

  useEffect(() => {
    // Closing the mobile drawer is an intentional response to navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(false);
  }, [location.pathname]);

  const submitGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = globalSearch.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    setGlobalSearch("");
  };

  return (
    <div className="w-full h-dvh flex flex-col app-bg relative overflow-hidden">
      <GridBackground isAIActive={isAIActive} theme={theme} />

      {/* Full-viewport-width header */}
      <header className="h-16 shrink-0 border-b app-border app-surface backdrop-blur-md flex items-center justify-center relative z-30 overflow-visible">
        <img
          src={theme === "dark" ? logoDarkUrl : logoLightUrl}
          alt="01 Manager"
          className="absolute top-1/2 z-0 w-auto -translate-y-1/2 object-contain pointer-events-none max-md:start-16 max-md:h-11 md:max-lg:hidden lg:left-1/2 lg:h-[60px] lg:-translate-x-1/2"
        />

        {/* Hamburger — mobile only, opens sidebar drawer */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="absolute start-4 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-xl border app-border app-surface-soft app-muted hover:app-surface-soft transition-colors md:hidden"
          aria-label={t("navigation:openMenu")}
        >
          <Menu className="h-4 w-4" />
        </button>

        <form onSubmit={submitGlobalSearch} className="absolute start-5 top-1/2 z-10 hidden w-[min(360px,32vw)] -translate-y-1/2 md:block">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 app-subtle" />
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder={t("common:search.placeholder")}
            className="w-full rounded-xl border app-border app-input py-2 ps-9 pe-3 text-sm outline-none transition-colors focus:border-purple-500/50"
          />
        </form>

        {/* Profile — absolute end so logo stays centered */}
        <div className="absolute end-5 top-0 z-10 h-full flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex h-9 items-center gap-1.5 px-2.5 rounded-xl border app-border app-surface-soft app-muted hover:app-surface-soft transition-colors text-xs font-semibold"
            aria-label={t("common:language.switcherAriaLabel")}
            title={t("common:language.switcherAriaLabel")}
          >
            <Languages className="h-4 w-4" />
            <span className="hidden sm:inline">{language === "ar" ? t("common:language.english") : t("common:language.arabic")}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border app-border app-surface-soft app-muted hover:app-surface-soft transition-colors"
            aria-label={theme === "dark" ? t("common:theme.switchToLight") : t("common:theme.switchToDark")}
            title={theme === "dark" ? t("common:theme.light") : t("common:theme.dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative" ref={notificationRef}>
            <button
              onClick={() => {
                setNotificationsOpen((v) => !v);
                setMenuOpen(false);
                refreshNotifications();
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border app-border app-surface-soft app-muted hover:app-surface-soft transition-colors"
              aria-label={t("common:notifications.ariaLabel")}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {notificationsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  className="fixed inset-x-2 top-16 z-50 max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl border app-border app-surface-elevated shadow-2xl shadow-black/50 backdrop-blur-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-96 sm:max-h-[70vh]"
                >
                  <div className="flex items-center justify-between border-b app-border px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold app-text">{t("common:notifications.title")}</div>
                      <div className="text-xs app-subtle">{t("common:notifications.unreadCount", { count: unreadCount })}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={markAllRead} className="text-xs text-purple-500 hover:text-purple-700">{t("common:notifications.markAllRead")}</button>
                      <button onClick={() => setShowPreferences((v) => !v)} className="rounded-lg p-1.5 app-muted hover:app-surface-soft transition-colors" aria-label={t("common:notifications.preferencesAriaLabel")}>
                        <Settings className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {showPreferences && preferences && (
                    <div className="border-b app-border px-4 py-3">
                      <div className="mb-2 text-xs font-semibold app-muted">{t("common:notifications.preferences")}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(preferences).map(([key, value]) => (
                          <label key={key} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-2 py-1.5 text-xs app-muted">
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={(e) => updatePreference(key as keyof NotificationPreferences, e.target.checked)}
                              className="accent-purple-500"
                            />
                            {t(`common:notifications.preferenceLabels.${key}`, { defaultValue: key.replace("_", " ") })}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="max-h-[420px] overflow-y-auto p-2">
                    {notifications.length === 0 ? (
                      <div className="py-10 text-center text-sm app-muted">{t("common:notifications.empty")}</div>
                    ) : (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => openNotification(item)}
                          className={`mb-1 w-full rounded-xl border px-3 py-3 text-start transition-colors ${item.read_at ? "app-border app-surface-soft app-muted" : "border-purple-500/30 bg-purple-500/10 app-text font-medium"}`}
                        >
                          <div className="flex items-start gap-2">
                            {!item.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-purple-400" />}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{item.message}</div>
                              <div className="mt-1 flex items-center gap-2 text-[10px] app-subtle">
                                <span>{t(`common:notifications.preferenceLabels.${NOTIFICATION_TYPE_KEYS[item.notification_type] ?? ""}`, { defaultValue: item.notification_type.replace("_", " ") })}</span>
                                <span>{new Date(item.created_at).toLocaleDateString(language === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "short", day: "numeric" })}</span>
                              </div>
                            </div>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRead(item, !item.read_at);
                              }}
                              className="shrink-0 rounded-md border app-border px-2 py-1 text-[10px] app-muted hover:border-purple-500/40 hover:text-purple-600 transition-colors"
                            >
                              {item.read_at ? t("common:notifications.markUnread") : t("common:notifications.markRead")}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="h-full flex items-center" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 hover:app-surface-soft transition-colors duration-200"
            >
              <div className="h-8 w-8 rounded-full bg-linear-to-br from-purple-600 to-purple-900 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-purple-500/30 shrink-0 overflow-hidden">
                {avatarUrl ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" /> : initials}
              </div>
              <span className="hidden sm:block max-w-[120px] truncate text-sm font-medium app-muted">
                {displayName}
              </span>
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute end-0 top-full mt-2 w-64 rounded-2xl border app-border app-surface-elevated backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden"
                >
                  {/* User info */}
                  <div className="px-4 py-3 border-b app-border">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-linear-to-br from-purple-600 to-purple-900 flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden">
                        {avatarUrl ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" /> : initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold app-text">{displayName}</p>
                        <p className="truncate text-xs app-subtle">{email}</p>
                      </div>
                      {!editingProfile && (
                        <button
                          onClick={openEdit}
                          className="shrink-0 p-1.5 rounded-lg app-subtle hover:app-text hover:app-surface-soft transition-colors"
                          title={t("common:profile.editProfile")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline profile edit form */}
                  <AnimatePresence>
                    {editingProfile && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden border-b app-border"
                      >
                        <div className="px-4 py-3 space-y-2.5">
                          <div>
                            <label className="block text-[10px] app-subtle mb-1 uppercase tracking-wide">{t("common:profile.name")}</label>
                            <input
                              value={nameInput}
                              onChange={(e) => setNameInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleSaveProfile()}
                              placeholder={t("common:profile.namePlaceholder")}
                              className="w-full px-3 py-2 app-input border app-border rounded-lg text-sm app-text focus:outline-none focus:border-purple-500/60 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] app-subtle mb-1 uppercase tracking-wide">{t("common:profile.phone")}</label>
                            <input
                              value={phoneInput}
                              onChange={(e) => setPhoneInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleSaveProfile()}
                              placeholder={t("common:profile.phonePlaceholder")}
                              dir="ltr"
                              className="w-full px-3 py-2 app-input border app-border rounded-lg text-sm app-text text-end focus:outline-none focus:border-purple-500/60 transition-colors"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] app-subtle mb-1 uppercase tracking-wide">{t("common:profile.email")}</label>
                            <p dir="ltr" className="px-3 py-2 app-surface-soft border app-border rounded-lg text-sm app-subtle truncate text-end">{email}</p>
                          </div>
                          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                          <div className="flex gap-2 pt-0.5">
                            <button
                              onClick={() => setEditingProfile(false)}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border app-border text-xs app-muted hover:app-text transition-colors"
                            >
                              <X className="h-3 w-3" /> {t("common:actions.cancel")}
                            </button>
                            <button
                              onClick={handleSaveProfile}
                              disabled={saving}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs text-white font-semibold transition-colors disabled:opacity-50"
                            >
                              {saving ? (
                                <div className="h-3 w-3 border border-white/50 border-t-white rounded-full animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              {t("common:actions.save")}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Actions */}
                  <div className="p-1.5 flex flex-col">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/profile");
                      }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm app-muted hover:app-surface-soft hover:app-text transition-colors duration-150"
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      {t("common:profile.viewProfile")}
                    </button>
                    <div className="h-px w-full app-surface-soft my-1"></div>
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors duration-150"
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                      {t("common:profile.signOut")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Mobile backdrop — closes sidebar when tapped */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 app-surface-elevated backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — static on desktop, slide-in drawer on mobile */}
        <aside
          data-open={sidebarOpen ? "true" : "false"}
          className={`sidebar-shell
          fixed inset-y-0 start-0 z-50 w-64 flex flex-col app-sidebar backdrop-blur-xl border-e app-border
          transition-transform duration-300 ease-in-out md:relative md:backdrop-blur-none md:z-20
        `}
        >
          <div className="px-6 py-7 border-b app-border flex items-center justify-between">
            <Logo />
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg sidebar-muted hover:sidebar-foreground hover:app-surface-soft transition-colors md:hidden"
              aria-label={t("navigation:closeMenu")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <SpaceSwitcher />

          <nav className="flex-1 p-4 space-y-1">
            <NavLink
              to="/"
              end
              className={() =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isProjectsActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <FolderOpen className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:projects")}</span>
          </NavLink>

          <NavLink
            to="/search"
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${
                isActive ? "sidebar-active" : "sidebar-item"
              }`
            }
          >
            <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
            <Search className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
            <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:search")}</span>
          </NavLink>

          <NavLink
            to="/roadmap"
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${
                isActive ? "sidebar-active" : "sidebar-item"
              }`
            }
          >
            <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
            <Map className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
            <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:roadmap")}</span>
          </NavLink>

          <NavLink
            to="/board"
            className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <Calendar className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:board")}</span>
            </NavLink>

            <NavLink
              to="/team"
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <Users className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:team")}</span>
            </NavLink>

            <NavLink
              to="/create"
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <Plus className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:createProject")}</span>
            </NavLink>

            <NavLink
              to="/migrate"
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <ArrowLeftRight className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:migration")}</span>
            </NavLink>

            <NavLink
              to="/space"
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden group transition-colors ${isActive ? "sidebar-active" : "sidebar-item"
                }`
              }
            >
              <div className="absolute inset-0 rounded-lg bg-(--app-sidebar-active) opacity-0 scale-95 transition duration-300 ease-out group-hover:opacity-100 group-hover:scale-100" />
              <Settings className="w-4 h-4 relative z-10 group-hover:text-white transition-colors duration-200" />
              <span className="text-sm relative z-10 group-hover:text-white transition-colors duration-200">{t("navigation:space")}</span>
            </NavLink>
          </nav>
        </aside>

        <div className={`flex-1 min-w-0 min-h-0 flex flex-col relative z-20 ${isAIActive ? "app-main-ai backdrop-blur-sm" : "app-main"}`}>
          <main className="flex-1 min-h-0 overflow-y-auto pb-16 md:pb-0">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Bottom navigation — mobile only */}
      <nav className="fixed bottom-0 inset-x-0 z-30 md:hidden border-t app-border app-surface-elevated backdrop-blur-xl">
        <div className="flex items-center justify-around h-16 px-1">
          <NavLink
            to="/"
            end
            className={() =>
              `flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${isProjectsActive ? "bg-purple-600 text-white" : "app-muted"}`
            }
          >
            <FolderOpen className="h-5 w-5" />
            <span className="text-[10px]">{t("navigation:projects")}</span>
          </NavLink>

          <NavLink
            to="/board"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${isActive ? "bg-purple-600 text-white" : "app-muted"}`
            }
          >
            <Calendar className="h-5 w-5" />
            <span className="text-[10px]">{t("navigation:board")}</span>
          </NavLink>

          {/* Centre action — Create */}
          <NavLink
            to="/create"
            className={({ isActive }) =>
              `flex items-center justify-center h-11 w-11 rounded-2xl transition-colors shadow-lg ${isActive ? "bg-purple-500 shadow-purple-500/30" : "bg-purple-600 shadow-purple-600/20 hover:bg-purple-500"}`
            }
            aria-label={t("navigation:createProject")}
          >
            <Plus className="h-5 w-5 text-white" />
          </NavLink>

          <button
            onClick={() => { setNotificationsOpen((v) => !v); setMenuOpen(false); refreshNotifications(); }}
            className="relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl app-muted transition-colors"
            aria-label={t("common:notifications.ariaLabel")}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 end-2 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
            <span className="text-[10px]">{t("navigation:alerts")}</span>
          </button>

          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl app-muted transition-colors"
            aria-label={t("navigation:more")}
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px]">{t("navigation:more")}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
