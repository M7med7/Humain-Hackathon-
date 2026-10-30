import { computeRecommendations, type MemberProfile } from '../../../backend/src/lib/assignmentEngine';
import type { GeneratedSchedule } from '../../../backend/src/services/aiManager';

function scheduleFor(task: Partial<GeneratedSchedule['tasks'][number]>): GeneratedSchedule {
  return {
    project_summary: 'Test project',
    tasks: [
      {
        id: 'task-1',
        title: 'Build React dashboard',
        description: 'Create charts and filters\nSteps:\n1. Build React components\n2. Connect API',
        estimated_days: 2,
        assigned_tech: ['React', 'TypeScript'],
        assigned_to: 'u1',
        acceptance_criteria: ['Dashboard displays expected data'],
        definition_of_done: ['Reviewed and tested'],
        ...task,
      },
    ],
    dependencies: [],
    technology_recommendations: [],
  };
}

const baseMembers: MemberProfile[] = [
  {
    userId: 'frontend',
    fullName: 'Frontend Dev',
    skills: ['React', 'TypeScript', 'UI'],
    experienceSummary: 'Built React dashboards and analytics UI.',
    activeDays: 4,
  },
  {
    userId: 'backend',
    fullName: 'Backend Dev',
    skills: ['Node.js', 'PostgreSQL', 'API'],
    experienceSummary: 'Built backend APIs and database services.',
    activeDays: 1,
  },
];

describe('computeRecommendations', () => {
  it('recommends the exact skill match over an unrelated member', () => {
    const result = computeRecommendations(scheduleFor({}), baseMembers);

    expect(result['task-1']?.userId).toBe('frontend');
    expect(result['task-1']?.skillMatches).toEqual(expect.arrayContaining(['react', 'typescript']));
    expect(result['task-1']?.confidence).toBeGreaterThanOrEqual(70);
  });

  it('can prefer a good lower-load match over an overloaded exact match', () => {
    const result = computeRecommendations(
      scheduleFor({ assigned_tech: ['React'] }),
      [
        { ...baseMembers[0]!, activeDays: 30 },
        {
          userId: 'fullstack',
          fullName: 'Fullstack Dev',
          skills: ['React', 'TypeScript', 'UI', 'Node.js'],
          experienceSummary: 'Works across frontend and backend features.',
          activeDays: 0,
        },
      ],
    );

    expect(result['task-1']?.userId).toBe('fullstack');
  });

  it('reports skill gaps and training help when no member clearly matches', () => {
    const result = computeRecommendations(
      scheduleFor({
        title: 'Train PyTorch model',
        description: 'Build an ML model\nSteps:\n1. Prepare dataset\n2. Train PyTorch pipeline',
        assigned_tech: ['PyTorch'],
      }),
      baseMembers,
    );

    expect(result['task-1']?.skillGaps).toContain('pytorch');
    expect(result['task-1']?.trainingSuggestion).toContain('pytorch');
    expect(result['task-1']?.reason.toLowerCase()).toContain('weak');
  });

  it('returns no recommendations when there are no members', () => {
    expect(computeRecommendations(scheduleFor({}), [])).toEqual({});
  });

  it('uses cautious low-confidence language when task skills are not detectable', () => {
    const result = computeRecommendations(
      scheduleFor({
        title: 'Coordinate launch prep',
        description: 'Prepare the team for launch.',
        assigned_tech: [],
      }),
      baseMembers,
    );

    expect(result['task-1']?.confidence).toBeLessThan(40);
    expect(result['task-1']?.reason).toContain('requirements are unclear');
  });
});
