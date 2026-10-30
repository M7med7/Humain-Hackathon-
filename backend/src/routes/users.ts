import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { demoUsers } from '../lib/demoData';
import { isConnectivityError, withTimeout } from '../lib/timeout';
import { computeAchievements } from '../lib/achievements';
import { spaceProjectIds } from '../lib/spaces';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', async (_req, res) => {
  try {
    const spaceId = res.locals.spaceId as string;
    const [{ data: memberships, error: membersError }, projectIds] = await Promise.all([
      withTimeout(supabase.from('space_members').select('role, users(*)').eq('space_id', spaceId)),
      spaceProjectIds(spaceId),
    ]);
    if (membersError) throw membersError;

    const users = (memberships ?? [])
      .filter((m: any) => m.users)
      .map((m: any) => ({ ...m.users, space_role: m.role }))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const [{ data: tasks }, { data: assignments }] = projectIds.length
      ? await Promise.all([
          withTimeout(supabase.from('tasks').select('id, title, assigned_to, status, project_id, estimated_days, projects(name)').in('project_id', projectIds)),
          withTimeout(supabase.from('team_assignments').select('user_id').in('project_id', projectIds)),
        ])
      : [{ data: [] }, { data: [] }];

    const enriched = users.map((user: any) => {
      const userTasks = (tasks ?? []).filter((t) => t.assigned_to === user.id);
      const completedTasks = (tasks ?? []).filter((t: any) => t.assigned_to === user.id && t.status === 'Done');
      const totalEstimatedDays = userTasks.reduce((sum, t: any) => sum + (Number(t.estimated_days) || 0), 0);

      return {
        ...user,
        skills: user.skills ?? [],
        experience_summary: user.experience_summary ?? null,
        cv_parsed_at: user.cv_parsed_at ?? null,
        task_count: userTasks.length,
        total_estimated_days: totalEstimatedDays,
        project_count: (assignments ?? []).filter((a) => a.user_id === user.id).length,
        completed_count: completedTasks.length,
        completed_tasks: completedTasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          project_name: (t.projects as { name: string } | null)?.name ?? null,
        })),
      };
    });

    res.json({ users: enriched });
  } catch (error: any) {
    if (isConnectivityError(error)) {
      return res.json({ users: demoUsers, source: 'demo' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, phone, github_url, linkedin_url, x_url, experience_summary, skills, job_title } = req.body as any;

    const updateData: Record<string, unknown> = {};
    if (full_name !== undefined) updateData.full_name = full_name?.trim() || null;
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (github_url !== undefined) updateData.github_url = github_url?.trim() || null;
    if (linkedin_url !== undefined) updateData.linkedin_url = linkedin_url?.trim() || null;
    if (x_url !== undefined) updateData.x_url = x_url?.trim() || null;
    if (job_title !== undefined) updateData.job_title = job_title?.trim() || null;
    if (experience_summary !== undefined) updateData.experience_summary = experience_summary?.trim() || null;
    if (skills !== undefined) updateData.skills = skills || [];

    const { error } = await withTimeout(
      supabase.from('users').update(updateData).eq('id', id)
    );
    if (error) throw error;

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Accounts are never deleted through the API; admins remove people from a space instead.
router.delete('/:id', (_req, res) => {
  res.status(403).json({ error: 'Remove members from the space in Space settings.' });
});

router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    // Task history and project counts only cover the active space.
    const projectIds = await spaceProjectIds(res.locals.spaceId as string);

    const [
      { data: user, error: userError },
      { data: tasks, error: tasksError },
      { data: assignments }
    ] = await Promise.all([
      withTimeout(supabase.from('users').select('*').eq('id', id).single()),
      withTimeout(supabase.from('tasks').select('id, title, status, project_id, estimated_days, completed_at, projects(name)').eq('assigned_to', id).in('project_id', projectIds)),
      withTimeout(supabase.from('team_assignments').select('project_id').eq('user_id', id).in('project_id', projectIds))
    ]);

    if (userError) throw userError;

    const userTasks = tasks ?? [];
    const completedTasks = userTasks.filter((t: any) => t.status === 'Done');
    const totalEstimatedDays = userTasks.reduce((sum, t: any) => sum + (Number(t.estimated_days) || 0), 0);

    // Calculate Weekly Streak
    let weeklyStreak = 0;
    if (completedTasks.length > 0) {
      const dates: Date[] = completedTasks.reduce((acc: Date[], t: any) => {
        if (t.completed_at) acc.push(new Date(t.completed_at));
        return acc;
      }, []);
      
      dates.sort((a, b) => b.getTime() - a.getTime());

      if (dates.length > 0) {
        const firstDate = dates[0]!;
        let currentWeekStr = getWeekString(new Date());
        let previousWeekStr = getWeekString(firstDate);

        // If the most recent task was completed this week or last week, the streak is alive
        if (firstDate.getTime() > new Date().getTime() - 14 * 24 * 60 * 60 * 1000) {
           let streak = 1;
           let lastWeekStr = getWeekString(firstDate);
           
           for (let i = 1; i < dates.length; i++) {
             const currentDate = dates[i]!;
             const prevDate = dates[i-1]!;
             const weekStr = getWeekString(currentDate);
             if (weekStr === lastWeekStr) continue;
             
             // Check if it's exactly the previous week (simplified logic by subtracting 7 days)
             const expectedPrevWeek = new Date(prevDate.getTime());
             expectedPrevWeek.setDate(expectedPrevWeek.getDate() - 7);
             if (weekStr === getWeekString(expectedPrevWeek)) {
               streak++;
               lastWeekStr = weekStr;
             } else {
               break;
             }
           }
           weeklyStreak = streak;
        }
      }
    }

    const achievements = computeAchievements(
      completedTasks.length,
      assignments?.length ?? 0,
      weeklyStreak,
    );

    const profileData = {
      ...user,
      skills: user.skills ?? [],
      experience_summary: user.experience_summary ?? null,
      github_url: user.github_url ?? null,
      linkedin_url: user.linkedin_url ?? null,
      x_url: user.x_url ?? null,
      job_title: user.job_title ?? null,
      cv_parsed_at: user.cv_parsed_at ?? null,
      task_count: userTasks.length,
      total_estimated_days: totalEstimatedDays,
      project_count: assignments?.length ?? 0,
      completed_count: completedTasks.length,
      completed_tasks: completedTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        project_name: (t.projects as { name: string } | null)?.name ?? null,
      })),
      weekly_streak: weeklyStreak,
      achievements: achievements
    };

    res.json({ profile: profileData });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No avatar file provided' });
    }

    const fileExt = file.originalname.split('.').pop();
    const fileName = `${id}-${Date.now()}.${fileExt}`;
    const filePath = `${id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    
    // Update user record
    await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', id);

    res.json({ success: true, avatar_url: data.publicUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function getWeekString(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

export default router;
