import { supabase } from '../lib/supabase';

export interface MemberCapacity {
  user_id: string;
  total_assigned_days: number;
  tasks_count: number;
}

export async function getTeamCapacity(projectId: string): Promise<MemberCapacity[]> {
  // Get all tasks for this project
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('assigned_to, estimated_days, status')
    .eq('project_id', projectId)
    .neq('status', 'Done');

  if (error) {
    throw new Error(`Failed to fetch tasks for capacity calculation: ${error.message}`);
  }

  const capacityMap = new Map<string, MemberCapacity>();

  tasks?.forEach(task => {
    if (task.assigned_to) {
      const existing = capacityMap.get(task.assigned_to) || {
        user_id: task.assigned_to,
        total_assigned_days: 0,
        tasks_count: 0
      };
      
      existing.total_assigned_days += Number(task.estimated_days || 0);
      existing.tasks_count += 1;
      
      capacityMap.set(task.assigned_to, existing);
    }
  });

  return Array.from(capacityMap.values());
}

export function checkCapacityWarnings(capacities: MemberCapacity[], maxDaysPerMember = 10) {
  return capacities.filter(c => c.total_assigned_days > maxDaysPerMember);
}
