import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo';
import { AuthControls } from '../components/AuthControls';
import { supabase } from '../lib/supabase';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('forgotPassword.genericError'));
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-3xl font-bold text-white">{t('forgotPassword.title')}</h1>
          <p className="text-center text-gray-400">
            {t('forgotPassword.subtitle')}
          </p>
        </div>

        {submitted ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-green-500/40 bg-green-900/20 p-5 text-center"
          >
            <p className="text-sm text-green-300">
              {t('forgotPassword.successMessage')}
            </p>
            <p className="mt-1 text-xs text-gray-500">{t('forgotPassword.checkSpam')}</p>
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
                <label className="mb-2 block text-sm font-semibold text-gray-300">{t('shared.emailLabel')}</label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('shared.emailPlaceholder')}
                  className="w-full rounded-xl border border-white/15 bg-white/6 px-4 py-3 text-start text-white placeholder-gray-600 outline-none transition-colors focus:border-purple-400/70"
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
                    {t('forgotPassword.submitting')}
                  </span>
                ) : (
                  t('forgotPassword.submit')
                )}
              </motion.button>
            </form>
          </>
        )}

        <p className="mt-8 text-center text-sm text-gray-500">
          {t('forgotPassword.rememberPassword')}{' '}
          <Link to="/login" className="font-semibold text-purple-400 hover:text-purple-300">
            {t('shared.signInLink')}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
