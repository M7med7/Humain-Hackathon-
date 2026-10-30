# 01 Manager

01 Manager is an AI-assisted project management platform for planning software projects, assigning work, tracking delivery risk, and keeping teams and clients informed. It turns a project description into a reviewable task plan, recommends assignments from team skills and capacity, and then supports execution through boards, schedules, health dashboards, reports, notifications, and integrations.

The application is a TypeScript monorepo with a React frontend, an Express API, Supabase authentication and PostgreSQL storage, and optional Gemini-powered planning features.

## What the application does

- **AI project planning:** generates project summaries, tasks, estimates, dependencies, acceptance criteria, definitions of done, and technology recommendations from a project brief.
- **Plan review and refinement:** scores plan quality, identifies timeline and workload issues, previews changes, and supports conversational refinement before saving.
- **Smart assignment:** recommends team members using skills, experience, availability, workload, and project requirements.
- **Task execution:** provides project boards, task details, dependencies, schedules, checklists, comments, attachments, activity history, and time tracking.
- **Delivery intelligence:** calculates project health, workload, blocked work, overdue tasks, risk signals, burndown data, achievements, and AI-generated summaries.
- **Portfolio visibility:** displays a cross-project roadmap, workload information, milestones, and deadline conflicts.
- **Team collaboration:** supports project roles, invitations, notifications, notification preferences, profiles, CV-based skill extraction, and local availability settings.
- **Reporting and sharing:** creates editable weekly reports, sends reports to Slack, and exposes token-based read-only client project views with comments.
- **Migration and export:** previews and imports CSV data, analyzes imports, exports project data, and supports Jira and Linear migration formats.
- **Integrations:** connects projects and tasks to GitHub, Google Calendar, and Slack. Outlook Calendar is represented in the API but is not implemented yet.
- **User experience:** includes authentication flows, responsive layouts, dark/light themes, and English/Arabic localization with RTL support.

## Architecture

```text
Browser
  |
  v
React 19 + Vite frontend
  |-- Supabase client -> authentication
  |-- REST requests
  v
Express 5 API
  |-- Supabase service client -> PostgreSQL data and storage
  |-- Gemini API -> planning, refinement, analysis, and summaries
  |-- GitHub API -> repositories and issues
  |-- Google Calendar API -> task calendar events
  `-- Slack webhooks -> notifications and reports
```

### Main directories

```text
01Manager/
├── frontend/                 React application, routes, UI, and API client
│   └── src/
│       ├── components/       Reusable project and task components
│       ├── contexts/         Authentication, theme, and language state
│       ├── lib/              API client, scheduling, risk, and export logic
│       ├── locales/          English and Arabic translations
│       └── pages/            Application screens
├── backend/                  Express REST API
│   └── src/
│       ├── lib/              Permissions, notifications, integrations, and scoring
│       ├── routes/           API endpoints grouped by feature
│       └── services/         AI planning and capacity services
├── test/                     Backend Jest and frontend Vitest tests
├── schema.sql                Supabase/PostgreSQL schema, policies, and triggers
├── render.yaml               Render backend deployment definition
└── docs/                     Additional QA documentation
```

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, Tailwind CSS, Motion |
| Localization | i18next and react-i18next |
| Backend | Node.js, Express 5, TypeScript, Zod |
| Data and auth | Supabase, PostgreSQL, Supabase Auth and Storage |
| AI | Google Gemini through `@google/generative-ai` |
| Testing | Jest, Supertest, Vitest, Testing Library |
| Deployment | Vercel for the frontend, Render for the backend |

## Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- A Gemini API key if AI features are required

## Local setup

### 1. Create the database

Create a Supabase project, open its SQL editor, and run [`schema.sql`](./schema.sql), then [`migrations/add_spaces.sql`](./migrations/add_spaces.sql). Together they create the application tables, relationships, update triggers, and the trigger that copies new Supabase Auth users into `public.users`.

`add_spaces.sql` adds spaces (each organization's isolated workspace, with Admin, Developer, Member and Guest roles) and locks down row-level security. Each space has a name, an optional description and a **space key**: a unique, permanent code such as `ZEROONE` (2–10 capital letters or digits, starting with a letter) reserved for API and MCP integrations. Existing data moves into a `ZeroOne` space with the key `ZEROONE`. With row-level security on, browsers can only manage their own `public.users` row, and all other data goes through the backend, which checks the signed-in user and their space on every request.

In Supabase **Authentication → URL Configuration**, add `<frontend URL>/set-password` to the redirect URLs so space invitation emails open the app.

### 2. Configure the backend

Create `backend/.env`:

```env
PORT=5001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOWED_ORIGIN=http://localhost:5173
# Frontend URL used in space invitation emails (defaults to the first ALLOWED_ORIGIN)
APP_URL=http://localhost:5173

# Required for AI planning, refinement, import analysis, and AI summaries
GEMINI_API_KEY=your-gemini-api-key
AI_MODEL=gemini-2.5-flash

# Optional integrations
GITHUB_TOKEN=your-github-token
GOOGLE_CALENDAR_CLIENT_ID=your-google-client-id
GOOGLE_CALENDAR_CLIENT_SECRET=your-google-client-secret
APP_URL=http://localhost:5173
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in the frontend or commit either `.env` file.

### 3. Configure the frontend

Create `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:5001
```

For Google Calendar, add this authorized redirect URI to the Google OAuth client:

```text
http://localhost:5173/calendar/callback
```

### 4. Install dependencies and run both applications

In one terminal:

```bash
cd backend
npm install
npm run dev
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `5001`, and its health endpoint is available at [http://localhost:5001/health](http://localhost:5001/health).

## Typical workflow

1. Sign up and complete a profile with skills and availability.
2. Add team members or invite existing users.
3. Create a project from a description or template.
4. Review the AI-generated plan, quality findings, dependencies, and assignment recommendations.
5. Refine the plan, preview the diff, and save it.
6. Manage delivery from the board, calendar, task detail, team capacity, and health views.
7. Generate a weekly report or share a restricted client link.

AI plan generation has an offline fallback when Gemini is unavailable, but generative summaries and deeper AI analysis require a valid Gemini key.

## Available scripts

### Frontend

```bash
cd frontend
npm run dev       # start the Vite development server
npm run build     # type-check and create a production build
npm run lint      # run ESLint
npm test          # run frontend tests once
npm run preview   # serve the production build locally
```

### Backend

```bash
cd backend
npm run dev       # start Express with nodemon and ts-node
npm test          # run backend unit and integration tests
```

## Deployment

### Backend on Render

[`render.yaml`](./render.yaml) defines the backend web service. Configure its secret environment variables in Render. For production, set `ALLOWED_ORIGIN` to the deployed frontend URL (multiple origins can be supplied as a comma-separated list) and `APP_URL` to the frontend URL used in invitation emails.

Optional production variables include `GITHUB_TOKEN`, the Google Calendar credentials, and `APP_URL`. Render supplies `RENDER_EXTERNAL_URL`, which the server currently uses for a periodic health ping.

### Frontend on Vercel

Deploy `frontend/` as the Vercel project root and configure the three `VITE_*` variables for the production Supabase project and API URL. [`frontend/vercel.json`](./frontend/vercel.json) rewrites application routes to `index.html` for client-side routing.

Update Supabase Auth redirect URLs and the Google OAuth redirect URI to include the deployed frontend domain.

## Security and current limitations

- The Express API uses the Supabase service-role key but does not currently authenticate incoming API requests itself. CORS is not authorization. Add token verification and enforce project permissions server-side before a public production launch.
- The SQL row-level security policies are broad development policies, not tenant-isolated production policies.
- Client share links are bearer tokens. Treat them as secrets and revoke them when no longer needed.
- Slack is connected through a webhook URL stored for the project. Store and expose integration credentials carefully.
- File uploads are limited by the application routes, but production storage policies, malware scanning, retention, and quotas should be reviewed.
- Outlook Calendar endpoints currently report that the integration is not implemented.

## Project status

The repository contains a substantial working application and automated coverage for core AI, assignment, capacity, health, project, achievement, and team utility behavior. It should still be treated as a pre-production system until API authentication, tenant-scoped authorization, database policy hardening, and production integration testing are completed.

## Maintaining code context

The repository includes Graphify output in `graphify-out/` and generated structural notes in `context-vault/`. After major structural changes, refresh the graph and regenerate the vault so those references do not drift from the source code.
