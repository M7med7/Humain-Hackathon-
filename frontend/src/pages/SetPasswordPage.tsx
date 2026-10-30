import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo';
import { AuthControls } from '../components/AuthControls';
import { supabase } from '../lib/supabase';

export function SetPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Supabase v2 auto-processes the hash from the invite link on init.
    // getSession() returns the session created from those tokens.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
  }, []);

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t('shared.passwordMinLengthError'));
      return;
    }
    if (password !== confirm) {
      setError(t('shared.passwordMismatchError'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setPassword.genericError'));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg px-6">
        <AuthControls />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md text-center"
        >
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <div className="rounded-xl border border-red-500/40 bg-red-900/20 p-6">
            <p className="text-sm text-red-300">
              {t('setPassword.invalidLink')}
            </p>
          </div>
          <p className="mt-8 text-sm text-gray-500">
            <Link to="/login" className="font-semibold text-purple-400 hover:text-purple-300">
              {t('shared.backToSignIn')}
            </Link>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center app-bg px-6">
      <AuthControls />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-10 flex flex-col items-center gap-4">
          <Logo />
          <h1 className="text-3xl font-bold text-white">{t('setPassword.title')}</h1>
          <p className="text-center text-gray-400">
            {t('setPassword.subtitle')}
          </p>
        </div>

        {success ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-green-500/40 bg-green-900/20 p-5 text-center"
          >
            <p className="text-sm text-green-300">{t('setPassword.successMessage')}</p>
          </motion.div>
        ) : (
          <>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 rounded-xl border border-red-500/50 bg-red-900/30 p-4 text-sm text-red-300"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-300">
                  {t('shared.newPasswordLabel')}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('shared.passwordPlaceholder')}
                  className="w-full rounded-xl border border-white/15 bg-white/6 px-4 py-3 text-white placeholder-gray-600 outline-none transition-colors focus:border-purple-400/70"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-300">
                  {t('shared.confirmPasswordLabel')}
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('shared.confirmPasswordPlaceholder')}
                  className="w-full rounded-xl border border-white/15 bg-white/6 px-4 py-3 text-white placeholder-gray-600 outline-none transition-colors focus:border-purple-400/70"
                />
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={!loading ? { y: -1 } : {}}
                whileTap={!loading ? { scale: 0.98 } : {}}
                className="w-full rounded-xl bg-linear-to-r from-purple-600 to-purple-900 py-3 font-semibold text-white shadow-lg shadow-purple-500/20 transition-opacity disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('setPassword.submitting')}
                  </span>
                ) : (
                  t('setPassword.submit')
                )}
              </motion.button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
