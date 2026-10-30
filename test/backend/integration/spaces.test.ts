import request from 'supertest';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      admin: { inviteUserByEmail: jest.fn().mockResolvedValue({ error: null }) },
    },
  },
}));

import app from '../../../backend/src/app';
import { supabase } from '../../../backend/src/lib/supabase';

const SPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OUTSIDER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const mockFrom = supabase.from as jest.Mock;
const as = (spaceId = SPACE_A) => request.agent(app).set('Authorization', 'Bearer test-token').set('X-Space-Id', spaceId);

type Call = [string, unknown[]];
type Resolver = (calls: Call[]) => unknown;

/** Chainable query-builder stub whose awaited result is computed from the calls made on it. */
function chain(resolve: Resolver, log?: Call[]) {
  const calls: Call[] = [];
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(resolve(calls)).then(ok, fail);
        }
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          log?.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const eqValue = (calls: Call[], column: string) => calls.find(([m, a]) => m === 'eq' && a[0] === column)?.[1][1];
const selected = (calls: Call[]) => String(calls.find(([m]) => m === 'select')?.[1][0] ?? '');

/**
 * World: user-1 is in SPACE_A with `role`; user-2 is a Developer in SPACE_A.
 * PROJECT_B lives in SPACE_B; TASK_A lives in a SPACE_A project.
 */
function world(role: string | null, extra: Record<string, Resolver> = {}, log: Record<string, Call[]> = {}) {
  const members: Record<string, Record<string, string>> = {
    [SPACE_A]: { ...(role ? { 'user-1': role } : {}), 'user-2': 'Developer' },
    [SPACE_B]: {},
  };
  mockFrom.mockImplementation((table: string) => {
    const tableLog = (log[table] ??= []);
    if (extra[table]) return chain(extra[table], tableLog);
    if (table === 'space_members') {
      return chain((calls) => {
        const space = members[String(eqValue(calls, 'space_id'))] ?? {};
        if (selected(calls).startsWith('role')) {
          const userRole = space[String(eqValue(calls, 'user_id'))];
          return { data: userRole ? { role: userRole } : null, error: null };
        }
        if (calls.some(([m]) => m === 'select' && (calls.find(([x]) => x === 'select')?.[1][1] as any)?.count)) {
          const admins = Object.values(space).filter((r) => r === 'Admin').length;
          return { count: admins, error: null };
        }
        const ids = (calls.find(([m]) => m === 'in')?.[1][1] as string[]) ?? Object.keys(space);
        return { data: ids.filter((id) => id in space).map((user_id) => ({ user_id })), error: null };
      }, tableLog);
    }
    if (table === 'projects') {
      return chain((calls) => {
        const id = eqValue(calls, 'id');
        if (id === PROJECT_B) return { data: { space_id: SPACE_B, created_by: null }, error: null };
        return { data: id ? null : [], error: null };
      }, tableLog);
    }
    if (table === 'tasks') {
      return chain((calls) =>
        eqValue(calls, 'id') === TASK_A
          ? { data: { project_id: 'pa', projects: { space_id: SPACE_A } }, error: null }
          : { data: [], error: null },
      tableLog);
    }
    return chain(() => ({ data: [], error: null }), tableLog);
  });
}

beforeEach(() => mockFrom.mockReset());

describe('space isolation', () => {
  it('rejects requests for a space the caller does not belong to', async () => {
    world('Admin');
    const res = await as(SPACE_B).get('/api/projects');
    expect(res.status).toBe(403);
  });

  it('hides projects that belong to another space', async () => {
    world('Admin');
    const res = await as().get(`/api/projects/${PROJECT_B}`);
    expect(res.status).toBe(404);
  });

  it('hides projects from another space when referenced in the body', async () => {
    world('Admin');
    const res = await as().post('/api/tasks').send({ project_id: PROJECT_B, title: 'x' });
    expect(res.status).toBe(404);
  });

  it('refuses to assign work to someone outside the space', async () => {
    world('Admin');
    const res = await as().patch(`/api/tasks/${TASK_A}/assign`).send({ assigned_to: OUTSIDER });
    expect(res.status).toBe(400);
  });

  it('lets only admins and developers create projects', async () => {
    world('Member');
    expect((await as().post('/api/projects').send({ name: 'x', description: 'y' })).status).toBe(403);
    world('Guest');
    expect((await as().post('/api/ai/save').send({ projectId: 'x' })).status).toBe(403);
  });

  it('never deletes user accounts through the API', async () => {
    world('Admin');
    const res = await as().delete('/api/users/user-2');
    expect(res.status).toBe(403);
  });
});

describe('space administration', () => {
  it('only admins can invite people', async () => {
    world('Developer');
    const res = await as().post(`/api/spaces/${SPACE_A}/invitations`).send({ email: 'new@example.com', role: 'Member' });
    expect(res.status).toBe(403);
  });

  it('only admins can remove members', async () => {
    world('Member');
    const res = await as().delete(`/api/spaces/${SPACE_A}/members/user-2`);
    expect(res.status).toBe(403);
  });

  it('admins can remove a member, which also drops their project access in this space', async () => {
    const log: Record<string, Call[]> = {};
    world('Admin', {
      projects: () => ({ data: [{ id: 'pa' }], error: null }),
    }, log);
    const res = await as().delete(`/api/spaces/${SPACE_A}/members/user-2`);
    expect(res.status).toBe(200);
    expect(log.space_members).toContainEqual(['delete', []]);
    expect(log.team_assignments).toContainEqual(['in', ['project_id', ['pa']]]);
  });

  it('keeps at least one admin in the space', async () => {
    world('Admin');
    const res = await as().patch(`/api/spaces/${SPACE_A}/members/user-1`).send({ role: 'Developer' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown roles', async () => {
    world('Admin');
    const res = await as().patch(`/api/spaces/${SPACE_A}/members/user-2`).send({ role: 'Owner' });
    expect(res.status).toBe(400);
  });

  it('invites new people by email and records a pending invitation', async () => {
    const log: Record<string, Call[]> = {};
    world('Admin', {
      users: () => ({ data: null, error: null }),
      space_invitations: () => ({ data: { id: 'inv-1', email: 'new@example.com', role: 'Developer' }, error: null }),
    }, log);
    const res = await as().post(`/api/spaces/${SPACE_A}/invitations`).send({ email: 'New@Example.com', role: 'Developer' });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(false);
    expect(supabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('new@example.com', expect.any(Object));
  });

  it('creating a space makes the creator its admin', async () => {
    const log: Record<string, Call[]> = {};
    world(null, { spaces: () => ({ data: { id: 'new-space', name: 'Acme', key: 'ACME' }, error: null }) }, log);
    const res = await as().post('/api/spaces').send({ name: '  Acme  ', key: ' acme ', description: '  We build rockets. ' });
    expect(res.status).toBe(201);
    expect(res.body.space.role).toBe('Admin');
    expect(log.spaces).toContainEqual([
      'insert',
      [{ name: 'Acme', key: 'ACME', description: 'We build rockets.', created_by: 'user-1' }],
    ]);
    expect(log.space_members).toContainEqual(['insert', [{ space_id: 'new-space', user_id: 'user-1', role: 'Admin' }]]);
  });

  it('accepts pending invitations when listing spaces', async () => {
    const log: Record<string, Call[]> = {};
    world(null, {
      users: () => ({ data: { email: 'me@example.com' }, error: null }),
      space_invitations: (calls) =>
        calls.some(([m]) => m === 'update')
          ? { error: null }
          : { data: [{ id: 'inv-1', space_id: SPACE_A, role: 'Member' }], error: null },
    }, log);
    const res = await as().get('/api/spaces');
    expect(res.status).toBe(200);
    expect(log.space_members).toContainEqual([
      'upsert',
      [[{ space_id: SPACE_A, user_id: 'user-1', role: 'Member' }], { onConflict: 'space_id,user_id', ignoreDuplicates: true }],
    ]);
  });
});

describe('space keys and descriptions', () => {
  it.each([
    ['missing', undefined],
    ['too short', 'A'],
    ['too long', 'ABCDEFGHIJK'],
    ['starting with a digit', '1ACME'],
    ['with symbols', 'AC-ME'],
  ])('rejects a key that is %s', async (_label, key) => {
    const log: Record<string, Call[]> = {};
    world(null, {}, log);
    const res = await as().post('/api/spaces').send({ name: 'Acme', key });
    expect(res.status).toBe(400);
    expect(log.spaces).toBeUndefined();
  });

  it('rejects descriptions over 500 characters', async () => {
    world(null);
    const res = await as().post('/api/spaces').send({ name: 'Acme', key: 'ACME', description: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('reports a taken key as a conflict', async () => {
    world(null, { spaces: () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } }) });
    const res = await as().post('/api/spaces').send({ name: 'Acme', key: 'ZEROONE' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken/);
  });

  it('checks whether a key is free, case-insensitively', async () => {
    const log: Record<string, Call[]> = {};
    world(null, { spaces: (calls) => ({ data: eqValue(calls, 'key') === 'ZEROONE' ? { id: 'x' } : null, error: null }) }, log);
    const taken = await as().get('/api/spaces/keys/zeroone');
    expect(taken.body).toEqual({ key: 'ZEROONE', available: false });
    const free = await as().get('/api/spaces/keys/ACME');
    expect(free.body).toEqual({ key: 'ACME', available: true });
  });

  it('never changes the key of an existing space', async () => {
    const log: Record<string, Call[]> = {};
    world('Admin', {}, log);
    const res = await as().patch(`/api/spaces/${SPACE_A}`).send({ name: 'Acme', key: 'NEWKEY' });
    expect(res.status).toBe(400);
    expect(log.spaces).toBeUndefined();
  });

  it('lets admins update the description without touching the name', async () => {
    const log: Record<string, Call[]> = {};
    world('Admin', { spaces: () => ({ data: { id: SPACE_A, description: 'HR and finance team' }, error: null }) }, log);
    const res = await as().patch(`/api/spaces/${SPACE_A}`).send({ description: ' HR and finance team ' });
    expect(res.status).toBe(200);
    expect(log.spaces).toContainEqual(['update', [{ description: 'HR and finance team' }]]);
  });

  it('only admins can change the description', async () => {
    world('Developer');
    const res = await as().patch(`/api/spaces/${SPACE_A}`).send({ description: 'x' });
    expect(res.status).toBe(403);
  });
});
