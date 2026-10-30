import { computeTaskDiff, type GeneratedSchedule, type GeneratedTask } from '../../../frontend/src/lib/api';

const task = (id: string, title: string): GeneratedTask => ({ id, title, description: '', estimated_days: 2, assigned_tech: [], assigned_to: 'u1', acceptance_criteria: [], definition_of_done: [] });

const schedule = (dependencies: GeneratedSchedule['dependencies']): GeneratedSchedule => ({
  project_summary: 'Plan',
  tasks: [task('a', 'Testing'), task('b', 'Deployment')],
  dependencies,
  technology_recommendations: [],
});

describe('computeTaskDiff', () => {
  it('reports dependency changes even when no task changed', () => {
    const diff = computeTaskDiff(schedule([]), schedule([{ task_id: 'b', depends_on_task_id: 'a', dependency_type: 'Finish-to-Start' }]));
    expect(diff.modified).toHaveLength(0);
    expect(diff.dependenciesAdded).toEqual([{ task: 'Deployment', dependsOn: 'Testing' }]);
    expect(diff.dependenciesRemoved).toHaveLength(0);
  });
});
