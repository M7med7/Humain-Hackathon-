import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';
import { AuthControls } from '../components/AuthControls';
import { JudgeDialog } from '../components/JudgeDialog';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { signIn, signInAsJudge } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [judgeLoading, setJudgeLoading] = useState(false);

  const enterAsJudge = async () => {
    setError(null);
    setJudgeLoading(true);
    try {
      await signInAsJudge();
      navigate('/');
    } catch {
      setJudgeOpen(false);
      setError(t('judge.unavailable'));
    } finally {
      setJudgeLoading(false);
    }
  };

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.genericError'));
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
          <h1 className="text-3xl font-bold text-white">{t('login.title')}</h1>
          <p className="text-gray-400">{t('login.subtitle')}</p>
        </div>

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

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-300">{t('login.passwordLabel')}</label>
              <Link to="/forgot-password" className="text-xs text-purple-400 hover:text-purple-300">
                {t('login.forgotPassword')}
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
                {t('login.submitting')}
              </span>
            ) : (
              t('login.submit')
            )}
          </motion.button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-gray-600">
          <span className="h-px flex-1 bg-white/10" />
          {t('judge.or')}
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <button
          type="button"
          onClick={() => setJudgeOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/6 py-3 font-semibold text-gray-200 transition-colors hover:bg-white/10"
        >
          <Eye className="h-4 w-4" aria-hidden />
          {t('judge.enter')}
        </button>

        <p className="mt-8 text-center text-sm text-gray-500">
          {t('login.noAccount')}{' '}
          <Link to="/signup" className="font-semibold text-purple-400 hover:text-purple-300">
            {t('shared.signUpLink')}
          </Link>
        </p>
      </motion.div>
      {judgeOpen && <JudgeDialog loading={judgeLoading} onContinue={() => void enterAsJudge()} onClose={() => setJudgeOpen(false)} />}
    </div>
  );
}
