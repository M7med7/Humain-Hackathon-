import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Copy, KeyRound, Mail, Pencil, Trash2, UserPlus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSpaces } from '../contexts/SpaceContext';
import { api, SPACE_DESCRIPTION_MAX_LENGTH, SPACE_ROLES, type Space, type SpaceInvitation, type SpaceMember, type SpaceRole } from '../lib/api';
import { getInitials } from '../lib/teamUtils';

const ROLE_STYLES: Record<SpaceRole, string> = {
  Admin: 'border-purple-500/40 bg-purple-500/15 text-purple-300',
  Developer: 'border-blue-500/40 bg-blue-500/15 text-blue-300',
  Member: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  Guest: 'border-white/15 bg-white/6 text-gray-300',
};

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 app-surface-soft p-4 sm:p-6 ${className}`}>{children}</section>;
}

function RoleBadge({ role }: { role: SpaceRole }) {
  const { t } = useTranslation('spaces');
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLES[role]}`}>
      {t(`roles.${role}`)}
    </span>
  );
}

function RoleSelect({ value, onChange, label, disabled }: { value: SpaceRole; onChange: (role: SpaceRole) => void; label: string; disabled?: boolean }) {
  const { t } = useTranslation('spaces');
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as SpaceRole)}
      className="rounded-lg border app-border app-input px-2.5 py-1.5 text-sm outline-none focus:border-purple-500/60 disabled:opacity-50"
    >
      {SPACE_ROLES.map((role) => (
        <option key={role} value={role}>{t(`roles.${role}`)}</option>
      ))}
    </select>
  );
}

type Notice = { kind: 'success' | 'warning' | 'error'; text: string } | null;

const COPIED_RESET_MS = 2000;

interface SpaceDetailsProps {
  space: Space;
  canEdit: boolean;
  onSaveDescription: (description: string) => Promise<void>;
}

// Key (permanent, copyable) and the description of the organization.
function SpaceDetails({ space, canEdit, onSaveDescription }: SpaceDetailsProps) {
  const { t } = useTranslation('spaces');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(space.key);
      setCopied(true);
    } catch {
      // Clipboard access can be blocked; the key stays selectable on screen.
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveDescription(draft.trim());
      setEditing(false);
    } catch {
      // The page shows the error; keep the draft so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <h3 className="mb-5 text-lg font-semibold">{t('settings.details.title')}</h3>
      <dl className="space-y-6">
        <div>
          <dt className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{t('settings.details.key')}</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 font-mono text-sm tracking-[0.2em] text-purple-300 select-all" dir="ltr">
              <KeyRound className="h-3.5 w-3.5" />
              {space.key}
            </span>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="inline-flex items-center gap-1.5 rounded-lg border app-border px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('settings.details.copied') : t('settings.details.copy')}
            </button>
          </dd>
          <p className="mt-2 text-xs text-gray-500">{t('settings.details.keyHelp')}</p>
        </div>

        <div>
          <dt className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            {t('settings.details.description')}
            {canEdit && !editing && (
              <button
                type="button"
                onClick={() => { setDraft(space.description ?? ''); setEditing(true); }}
                aria-label={t('settings.details.editDescription')}
                className="rounded-lg p-1.5 normal-case tracking-normal text-gray-500 hover:bg-white/5 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </dt>
          <dd>
            {editing ? (
              <div className="space-y-3">
                <textarea
                  aria-label={t('settings.details.description')}
                  rows={4}
                  autoFocus
                  maxLength={SPACE_DESCRIPTION_MAX_LENGTH}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full resize-none rounded-xl border app-border app-input px-4 py-3 text-sm leading-relaxed outline-none focus:border-purple-500/60"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs tabular-nums text-gray-500">{draft.length}/{SPACE_DESCRIPTION_MAX_LENGTH}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-lg border app-border px-3 py-1.5 text-xs text-gray-400 hover:bg-white/5 disabled:opacity-50">
                      {t('settings.cancel')}
                    </button>
                    <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50">
                      {t('settings.save')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className={`text-sm leading-relaxed wrap-break-word whitespace-pre-line ${space.description ? 'text-gray-300' : 'text-gray-500 italic'}`}>
                {space.description || t('settings.details.noDescription')}
              </p>
            )}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

export function SpaceSettings() {
  const { t } = useTranslation('spaces');
  const { session } = useAuth();
  const { activeSpace, isAdmin, refresh } = useSpaces();
  const currentUserId = session?.user.id;
  const spaceId = activeSpace?.id ?? '';

  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [invitations, setInvitations] = useState<SpaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<SpaceRole>('Developer');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<SpaceMember | null>(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoadError(null);
    try {
      const data = await api.spaces.members(spaceId);
      setMembers(data.members);
      setInvitations(data.invitations);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('settings.members.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [spaceId, t]);

  useEffect(() => {
    // Fetching members is the intended reaction to opening the page or switching space.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!activeSpace) return null;

  const displayName = (m: SpaceMember) => m.full_name || m.email;

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || name === activeSpace.name) return setEditingName(false);
    try {
      await api.spaces.update(spaceId, { name });
      await refresh();
      setEditingName(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.renameFailed') });
    }
  };

  const saveDescription = async (description: string) => {
    try {
      await api.spaces.update(spaceId, { description });
      await refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.details.saveFailed') });
      throw err;
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    setNotice(null);
    try {
      const result = await api.spaces.invite(spaceId, email, inviteRole);
      if (result.added) {
        setNotice({ kind: 'success', text: t('settings.invite.added', { email }) });
      } else if (result.email_sent) {
        setNotice({ kind: 'success', text: t('settings.invite.sent', { email }) });
      } else {
        setNotice({ kind: 'warning', text: t('settings.invite.emailFailed', { email, reason: result.email_error ?? '' }) });
      }
      setInviteEmail('');
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.invite.failed') });
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (member: SpaceMember, role: SpaceRole) => {
    setBusyId(member.id);
    setNotice(null);
    try {
      await api.spaces.updateMemberRole(spaceId, member.id, role);
      setMembers((current) => current.map((m) => (m.id === member.id ? { ...m, role } : m)));
      if (member.id === currentUserId) await refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.members.roleFailed') });
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async () => {
    if (!confirmRemove) return;
    setBusyId(confirmRemove.id);
    try {
      await api.spaces.removeMember(spaceId, confirmRemove.id);
      setMembers((current) => current.filter((m) => m.id !== confirmRemove.id));
      setConfirmRemove(null);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.members.removeFailed') });
      setConfirmRemove(null);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (invitation: SpaceInvitation) => {
    setBusyId(invitation.id);
    try {
      await api.spaces.revokeInvitation(spaceId, invitation.id);
      setInvitations((current) => current.filter((inv) => inv.id !== invitation.id));
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : t('settings.pending.revokeFailed') });
    } finally {
      setBusyId(null);
    }
  };

  const noticeStyles = {
    success: 'border-green-500/40 bg-green-900/20 text-green-300',
    warning: 'border-yellow-500/40 bg-yellow-900/20 text-yellow-300',
    error: 'border-red-500/50 bg-red-900/30 text-red-300',
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-gray-500">{t('settings.title')}</p>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                aria-label={t('settings.name')}
                value={nameDraft}
                maxLength={80}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEditingName(false); }}
                className="rounded-xl border app-border app-input px-3 py-2 text-2xl font-semibold outline-none focus:border-purple-500/60"
              />
              <button type="button" onClick={() => void saveName()} aria-label={t('settings.save')} className="rounded-lg border app-border p-2 text-green-400 hover:bg-white/5">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditingName(false)} aria-label={t('settings.cancel')} className="rounded-lg border app-border p-2 text-gray-400 hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h2 className="truncate text-2xl md:text-3xl font-light">{activeSpace.name}</h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { setNameDraft(activeSpace.name); setEditingName(true); }}
                  aria-label={t('settings.rename')}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <p className="mt-1 text-sm text-gray-500">{t('settings.subtitle', { name: activeSpace.name })}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          {t('settings.yourRole')} <RoleBadge role={activeSpace.role} />
        </div>
      </header>

      {notice && (
        <div role="status" className={`mb-6 rounded-xl border p-4 text-sm ${noticeStyles[notice.kind]}`}>{notice.text}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <SpaceDetails space={activeSpace} canEdit={isAdmin} onSaveDescription={saveDescription} />

          {isAdmin && (
            <SectionCard>
              <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold"><UserPlus className="h-5 w-5 text-purple-400" />{t('settings.invite.title')}</h3>
              <p className="mb-4 text-sm text-gray-500">{t('settings.invite.help')}</p>
              <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="invite-email">{t('settings.invite.email')}</label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  dir="ltr"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('settings.invite.emailPlaceholder')}
                  className="flex-1 rounded-xl border app-border app-input px-4 py-2.5 text-sm outline-none focus:border-purple-500/60"
                />
                <RoleSelect value={inviteRole} onChange={setInviteRole} label={t('settings.invite.role')} />
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                  {inviting ? t('settings.invite.sending') : t('settings.invite.submit')}
                </button>
              </form>
            </SectionCard>
          )}

          <SectionCard>
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-lg font-semibold">{t('settings.members.title')}</h3>
              <span className="text-sm text-gray-500">{t('settings.members.count', { count: members.length })}</span>
            </div>
            {loading ? (
              <div className="py-8 text-center"><div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" /></div>
            ) : loadError ? (
              <p className="text-sm text-red-300">{loadError}</p>
            ) : (
              <ul className="divide-y divide-white/8">
                {members.map((member) => {
                  const isMe = member.id === currentUserId;
                  return (
                    <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-purple-600 to-purple-900 text-xs font-bold text-white">
                        {member.avatar_url ? <img src={member.avatar_url} alt="" className="h-full w-full object-cover" /> : getInitials(member.full_name, member.email)}
                      </div>
                      {/* min width makes the role controls wrap below the name on phones */}
                      <div className="min-w-40 flex-1">
                        <p className="truncate text-sm font-medium">
                          {displayName(member)}
                          {isMe && <span className="ms-2 text-xs text-gray-500">({t('settings.members.you')})</span>}
                        </p>
                        <p className="truncate text-xs text-gray-500" dir="ltr">{member.email}</p>
                      </div>
                      {isAdmin ? (
                        <RoleSelect
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(role) => void changeRole(member, role)}
                          label={t('settings.members.changeRole', { name: displayName(member) })}
                        />
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                      {isAdmin && !isMe && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(member)}
                          aria-label={`${t('settings.members.remove')} ${displayName(member)}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 text-gray-500 transition-colors hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {isAdmin && (
            <SectionCard>
              <h3 className="mb-4 text-lg font-semibold">{t('settings.pending.title')}</h3>
              {invitations.length === 0 ? (
                <p className="text-sm text-gray-500">{t('settings.pending.empty')}</p>
              ) : (
                <ul className="divide-y divide-white/8">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="flex items-center gap-3 py-3">
                      <Mail className="h-4 w-4 shrink-0 text-gray-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" dir="ltr">{inv.email}</p>
                        <p className="text-xs text-gray-500">{t('settings.pending.invitedAs', { role: t(`roles.${inv.role}`) })}</p>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => void revoke(inv)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
                      >
                        {t('settings.pending.revoke')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </div>

        <aside>
          <SectionCard>
            <h3 className="mb-4 text-sm font-semibold text-gray-300">{t('settings.rolesTitle')}</h3>
            <dl className="space-y-4">
              {SPACE_ROLES.map((role) => (
                <div key={role}>
                  <dt><RoleBadge role={role} /></dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-gray-500">{t(`roleHelp.${role}`)}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </aside>
      </div>

      <AnimatePresence>
        {confirmRemove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="remove-member-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-md rounded-2xl border border-red-500/40 app-surface-elevated p-6 shadow-2xl shadow-red-500/20"
            >
              <div className="mb-5 flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/40 bg-red-900/50">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h3 id="remove-member-title" className="text-lg font-semibold text-white">{t('settings.members.removeTitle', { name: displayName(confirmRemove) })}</h3>
                  <p className="mt-1 text-sm text-gray-400">{t('settings.members.removeBody')}</p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(null)}
                  disabled={busyId !== null}
                  className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
                >
                  {t('settings.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void removeMember()}
                  disabled={busyId !== null}
                  className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-500 disabled:opacity-40"
                >
                  {busyId ? t('settings.members.removing') : t('settings.members.remove')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
