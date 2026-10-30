import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import userRoutes from './routes/users';
import aiRoutes from './routes/ai';
import notificationRoutes from './routes/notifications';
import templateRoutes from './routes/templates';
import githubRoutes from './routes/github';
import calendarRoutes from './routes/calendar';
import slackRoutes from './routes/slack';
import importsRoutes from './routes/imports';
import healthRoutes from './routes/health';
import reportRoutes from './routes/report';
import timeRoutes from './routes/time';
import portfolioRoutes from './routes/portfolio';
import clientRoutes from './routes/client';
import searchRoutes from './routes/search';
import { requireAuth } from './lib/auth';
import { requireSpace } from './lib/spaceAccess';
import spaceRoutes from './routes/spaces';

dotenv.config();

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] blocked origin: ${origin}`);
        callback(new Error(`CORS: origin "${origin}" not allowed`));
      }
    },
  })
);
app.use(express.json());

// Every /api route requires a verified Supabase session unless listed as public in lib/auth.
app.use('/api', requireAuth);
// Scopes every request to the caller's active space (X-Space-Id header).
app.use('/api', requireSpace);

app.use('/api/spaces', spaceRoutes);

app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/users', userRoutes);
import cvRoutes from './routes/cv';
app.use('/api/users', cvRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/search', searchRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
