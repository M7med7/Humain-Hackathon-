export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  phases: string[];
  recommended_technologies: string[];
  task_blueprints?: Array<{
    title: string;
    description: string | null;
    priority: string;
    estimated_days: number;
    assigned_tech: string[];
  }>;
  is_custom?: boolean;
  source_project_id?: string | null;
}

export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'web-app',
    name: 'Web App',
    description: 'Full-stack browser application with auth, UI, API, data, testing, and deployment.',
    category: 'Software',
    phases: ['Discovery', 'UX/UI', 'Frontend', 'Backend', 'Integration', 'Testing', 'Deployment'],
    recommended_technologies: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Supabase', 'Tailwind CSS'],
  },
  {
    id: 'mobile-app',
    name: 'Mobile App',
    description: 'iOS/Android app with mobile UX, APIs, device testing, and store-ready delivery.',
    category: 'Software',
    phases: ['Product Flow', 'Mobile UI', 'App Core', 'API Integration', 'Device Testing', 'Release Prep'],
    recommended_technologies: ['React Native', 'Expo', 'TypeScript', 'Supabase', 'Push Notifications'],
  },
  {
    id: 'ai-app',
    name: 'AI App',
    description: 'AI-powered product with prompts, model integration, evaluation, and safeguards.',
    category: 'AI',
    phases: ['Use Case Design', 'Data/Context', 'Prompting', 'Model Integration', 'Evaluation', 'Safety', 'Launch'],
    recommended_technologies: ['OpenAI API', 'Python', 'Node.js', 'Vector Database', 'PostgreSQL', 'React'],
  },
  {
    id: 'data-dashboard',
    name: 'Data Dashboard',
    description: 'Analytics dashboard with data ingestion, metrics, charts, filters, and reporting.',
    category: 'Data',
    phases: ['Metric Definition', 'Data Modeling', 'ETL', 'Dashboard UI', 'Charts', 'QA', 'Publishing'],
    recommended_technologies: ['React', 'TypeScript', 'PostgreSQL', 'Supabase', 'Recharts', 'dbt'],
  },
  {
    id: 'ecommerce-website',
    name: 'E-commerce Website',
    description: 'Online store with catalog, cart, checkout, orders, payments, and admin basics.',
    category: 'Commerce',
    phases: ['Store Planning', 'Catalog', 'Cart/Checkout', 'Payments', 'Orders', 'Admin', 'Testing', 'Launch'],
    recommended_technologies: ['Next.js', 'Stripe', 'PostgreSQL', 'Supabase', 'Tailwind CSS'],
  },
  {
    id: 'game-project',
    name: 'Game Project',
    description: 'Playable game project with core loop, assets, mechanics, levels, and playtesting.',
    category: 'Game',
    phases: ['Game Design', 'Prototype', 'Core Mechanics', 'Assets', 'Levels', 'Playtesting', 'Polish'],
    recommended_technologies: ['Unity', 'C#', 'Godot', 'GDScript', 'Three.js', 'Blender'],
  },
  {
    id: 'saas-mvp',
    name: 'SaaS MVP',
    description: 'Lean SaaS product with tenant-ready core features, billing, onboarding, and feedback loops.',
    category: 'SaaS',
    phases: ['MVP Scope', 'Auth/Accounts', 'Core Workflow', 'Billing', 'Admin', 'Analytics', 'Beta Launch'],
    recommended_technologies: ['Next.js', 'Stripe', 'Supabase', 'PostgreSQL', 'Resend', 'Vercel'],
  },
  {
    id: 'marketing-website',
    name: 'Marketing Website',
    description: 'Public website with content structure, conversion sections, SEO, and launch checks.',
    category: 'Website',
    phases: ['Messaging', 'Content', 'Design', 'Implementation', 'SEO', 'Analytics', 'Launch'],
    recommended_technologies: ['Astro', 'Next.js', 'Tailwind CSS', 'Framer Motion', 'Plausible'],
  },
  {
    id: 'api-backend-service',
    name: 'API / Backend Service',
    description: 'Backend service with API design, database, auth, integrations, tests, and deployment.',
    category: 'Backend',
    phases: ['API Design', 'Database', 'Auth', 'Business Logic', 'Integrations', 'Testing', 'Deployment'],
    recommended_technologies: ['Node.js', 'Express', 'PostgreSQL', 'Redis', 'Docker', 'OpenAPI'],
  },
  {
    id: 'hackathon-project',
    name: 'Hackathon Project',
    description: 'Fast build plan optimized for demo value, tight scope, and presentation readiness.',
    category: 'Fast Build',
    phases: ['Idea Lock', 'Prototype', 'Core Demo Flow', 'Integration', 'Polish', 'Pitch Prep'],
    recommended_technologies: ['React', 'Supabase', 'OpenAI API', 'Vercel', 'Tailwind CSS'],
  },
];

export function formatTemplateForPrompt(template?: ProjectTemplate | null): string {
  if (!template) return '';
  const blueprints = template.task_blueprints?.length
    ? `\nReusable task patterns:\n${template.task_blueprints.slice(0, 20).map((task) => `- ${task.title}: ${task.description ?? ''} (${task.priority}, ${task.estimated_days}d, tech: ${(task.assigned_tech ?? []).join(', ')})`).join('\n')}`
    : '';

  return `\nSelected template: ${template.name}
Template description: ${template.description}
Default phases: ${template.phases.join(' -> ')}
Recommended technologies: ${template.recommended_technologies.join(', ')}
Use this template to shape the plan, task ordering, dependencies, phases, and technology recommendations. Do not blindly copy phases if the user's description says otherwise.${blueprints}\n`;
}

export function findBuiltInTemplate(id?: string | null): ProjectTemplate | null {
  if (!id || id === 'blank') return null;
  return BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null;
}
