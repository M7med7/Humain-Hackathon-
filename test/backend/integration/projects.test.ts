import request from 'supertest';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
  },
}));

// Space membership is covered in spaces.test.ts; here the caller is an admin of SPACE_ID.
jest.mock('../../../backend/src/lib/spaces', () => ({
  ...jest.requireActual('../../../backend/src/lib/spaces'),
  getSpaceRole: jest.fn().mockResolvedValue('Admin'),
  assertInSpace: jest.fn().mockResolvedValue(undefined),
  assertUsersInSpace: jest.fn().mockResolvedValue(undefined),
}));

import app from '../../../backend/src/app';
import { supabase } from '../../../backend/src/lib/supabase';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const authed = () => request.agent(app).set('Authorization', 'Bearer test-token').set('X-Space-Id', SPACE_ID);
const mockFrom = supabase.from as jest.Mock;

/** Chainable query-builder stub: every method returns itself; awaiting it yields `result`. */
function chain(result: unknown, calls: Array<[string, unknown[]]> = []) {
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe('GET /api/projects', () => {
  it('returns only projects from the active space', async () => {
    const fakeProjects = [{ id: 'p1', name: 'Alpha' }];
    const projectCalls: Array<[string, unknown[]]> = [];
    mockFrom.mockImplementation((table: string) =>
      table === 'projects' ? chain({ data: fakeProjects, error: null }, projectCalls) : chain({ data: [], error: null }),
    );

    const res = await authed().get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0]).toMatchObject(fakeProjects[0]);
    expect(projectCalls).toContainEqual(['eq', ['space_id', SPACE_ID]]);
  });

  it('returns 500 when the database returns an error', async () => {
    mockFrom.mockImplementation(() => chain({ data: null, error: { message: 'Connection lost' } }));

    const res = await authed().get('/api/projects');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Connection lost');
  });

  it('requires an active space', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/projects', () => {
  it('creates the project in the active space with the caller as owner', async () => {
    const fakeProject = { id: 'p1', name: 'New App', description: 'Desc' };
    const projectCalls: Array<[string, unknown[]]> = [];
    mockFrom.mockImplementation((table: string) =>
      table === 'projects' ? chain({ data: fakeProject, error: null }, projectCalls) : chain({ error: null }),
    );

    const res = await authed()
      .post('/api/projects')
      .send({ name: 'New App', description: 'Desc', team_members: ['u1'] });

    expect(res.status).toBe(200);
    expect(res.body.project).toEqual(fakeProject);
    expect(projectCalls).toContainEqual([
      'insert',
      [{ name: 'New App', description: 'Desc', created_by: 'user-1', space_id: SPACE_ID }],
    ]);
  });

  it('returns 500 when the project insert fails', async () => {
    mockFrom.mockImplementation(() => chain({ data: null, error: { message: 'Duplicate name' } }));

    const res = await authed()
      .post('/api/projects')
      .send({ name: 'Duplicate', description: 'Desc' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Duplicate name');
  });

  it('only adds the owner assignment when team_members is empty', async () => {
    mockFrom.mockImplementation(() => chain({ data: { id: 'p2', name: 'Solo App' }, error: null }));

    const res = await authed()
      .post('/api/projects')
      .send({ name: 'Solo App', description: 'No team', team_members: [] });

    expect(res.status).toBe(200);
    expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['projects', 'team_assignments']);
  });
});
