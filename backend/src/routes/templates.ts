import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { BUILT_IN_TEMPLATES, findBuiltInTemplate, type ProjectTemplate } from '../lib/projectTemplates';

const router = Router();

function mapCustomTemplate(row: any): ProjectTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category ?? 'Custom',
    phases: row.phases ?? [],
    recommended_technologies: row.recommended_technologies ?? [],
    task_blueprints: row.task_blueprints ?? [],
    source_project_id: row.source_project_id ?? null,
    is_custom: true,
  };
}

export async function resolveTemplate(templateId?: string | null): Promise<ProjectTemplate | null> {
  const builtIn = findBuiltInTemplate(templateId);
  if (builtIn) return builtIn;
  if (!templateId || templateId === 'blank') return null;

  const { data, error } = await withTimeout(
    supabase.from('project_templates').select('*').eq('id', templateId).maybeSingle(),
  );
  if (error) throw error;
  return data ? mapCustomTemplate(data) : null;
}

router.get('/', async (_req, res) => {
  const builtIns = [
    { id: 'blank', name: 'Blank Project', description: 'Start from your own description without template guidance.', category: 'Blank', phases: [], recommended_technologies: [], is_custom: false },
    ...BUILT_IN_TEMPLATES.map((template) => ({ ...template, is_custom: false })),
  ];

  try {
    const { data, error } = await withTimeout(supabase.from('project_templates').select('*').eq('space_id', res.locals.spaceId).order('created_at', { ascending: false }));
    if (error) throw error;
    res.json({
      templates: [
        ...builtIns,
        ...(data ?? []).map(mapCustomTemplate),
      ],
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return res.json({ templates: builtIns });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/from-project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, created_by } = req.body as { name?: string; created_by?: string | null };
    const [{ data: project, error: projectError }, { data: tasks, error: tasksError }] = await Promise.all([
      withTimeout(supabase.from('projects').select('*').eq('id', projectId).single()),
      withTimeout(supabase.from('tasks').select('title, description, priority, estimated_days, assigned_tech').eq('project_id', projectId).order('created_at')),
    ]);
    if (projectError) throw projectError;
    if (tasksError) throw tasksError;

    const tech = new Set<string>();
    const blueprints = (tasks ?? []).map((task: any) => {
      for (const item of task.assigned_tech ?? []) tech.add(item);
      return {
        title: task.title,
        description: task.description,
        priority: task.priority,
        estimated_days: Number(task.estimated_days) || 1,
        assigned_tech: task.assigned_tech ?? [],
      };
    });

    const { data: template, error } = await withTimeout(
      supabase.from('project_templates').insert({
        space_id: res.locals.spaceId,
        name: name?.trim() || `${project.name} Template`,
        description: project.description,
        category: 'Custom',
        phases: ['Planning', 'Build', 'Review', 'Launch'],
        recommended_technologies: Array.from(tech),
        task_blueprints: blueprints,
        source_project_id: projectId,
        created_by: created_by ?? null,
      }).select().single(),
    );
    if (error) throw error;
    res.json({ template: mapCustomTemplate(template) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { created_by } = req.body as { created_by?: string | null };
    const original = await resolveTemplate(id);
    if (!original) return res.status(404).json({ error: 'Template not found' });

    const { data, error } = await withTimeout(
      supabase.from('project_templates').insert({
        space_id: res.locals.spaceId,
        name: `${original.name} Copy`,
        description: original.description,
        category: original.category,
        phases: original.phases,
        recommended_technologies: original.recommended_technologies,
        task_blueprints: original.task_blueprints ?? [],
        source_project_id: original.source_project_id ?? null,
        created_by: created_by ?? null,
      }).select().single(),
    );
    if (error) throw error;
    res.json({ template: mapCustomTemplate(data) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
