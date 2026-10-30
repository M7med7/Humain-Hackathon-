import request from 'supertest';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
  },
}));

jest.mock('../../../backend/src/services/aiManager', () => ({
  durationToDays: jest.fn((value: number, unit: string) => {
    if (unit === 'Months') return value * 30;
    if (unit === 'Years') return value * 365;
    return value * 7;
  }),
  generateSchedule: jest.fn().mockResolvedValue({
    tasks: [
      { id: 't1', title: 'Database Schema', description: 'D1', estimated_days: 2, assigned_tech: ['PostgreSQL'], assigned_to: 'u1' },
      { id: 't2', title: 'API Setup', description: 'D2', estimated_days: 3, assigned_tech: ['Node.js'], assigned_to: 'u2' },
    ],
    dependencies: [
      { task_id: 't2', depends_on_task_id: 't1', dependency_type: 'Finish-to-Start' },
    ],
    technology_recommendations: [
      { tech_name: 'React', category: 'Frontend', reasoning: 'Fast UI' },
    ],
  }),
}));

// Space membership is covered in spaces.test.ts; here the caller is an admin of the space.
jest.mock('../../../backend/src/lib/spaces', () => ({
  ...jest.requireActual('../../../backend/src/lib/spaces'),
  getSpaceRole: jest.fn().mockResolvedValue('Admin'),
  assertInSpace: jest.fn().mockResolvedValue(undefined),
  assertUsersInSpace: jest.fn().mockResolvedValue(undefined),
}));

import app from '../../../backend/src/app';

const authed = () =>
  request.agent(app).set('Authorization', 'Bearer test-token').set('X-Space-Id', '11111111-1111-4111-8111-111111111111');

describe('POST /api/ai/generate', () => {
  it('returns 200 with success flag', async () => {
    const res = await authed()
      .post('/api/ai/generate')
      .send({ name: 'My App', description: 'A project', duration: 4, headcount: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns a schedule object with tasks and dependencies', async () => {
    const res = await authed()
      .post('/api/ai/generate')
      .send({ name: 'My App', description: 'A project', duration: 4, headcount: 2 });

    expect(res.body.schedule).toHaveProperty('tasks');
    expect(res.body.schedule).toHaveProperty('dependencies');
    expect(res.body.schedule).toHaveProperty('technology_recommendations');
  });

  it('returns the expected number of tasks from the schedule', async () => {
    const res = await authed()
      .post('/api/ai/generate')
      .send({ name: 'My App', description: 'A project', duration: 4, headcount: 2 });

    expect(res.body.schedule.tasks).toHaveLength(2);
  });

  it('returns 500 when generateSchedule throws', async () => {
    const { generateSchedule } = require('../../../backend/src/services/aiManager');
    (generateSchedule as jest.Mock).mockRejectedValueOnce(new Error('AI service down'));

    const res = await authed()
      .post('/api/ai/generate')
      .send({ name: 'My App', description: 'Fail case', duration: 2, headcount: 1 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('AI service down');
  });
});
