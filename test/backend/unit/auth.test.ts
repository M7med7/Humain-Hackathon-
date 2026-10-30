import type { NextFunction, Request, Response } from 'express';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getUser: jest.fn() } },
}));

import { clearAuthCache, requireAuth } from '../../../backend/src/lib/auth';
import { supabase } from '../../../backend/src/lib/supabase';

const mockGetUser = supabase.auth.getUser as jest.Mock;

function makeReq(overrides: Partial<Request> & { token?: string | null } = {}) {
  const { token = 'valid-token', ...rest } = overrides;
  return {
    method: 'GET',
    path: '/projects',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: {},
    query: {},
    ...rest,
  } as unknown as Request;
}

function makeRes() {
  const res = { locals: {} as Record<string, unknown>, statusCode: 200, body: undefined as unknown };
  const api = {
    ...res,
    status(code: number) { api.statusCode = code; return api; },
    json(payload: unknown) { api.body = payload; return api; },
  };
  return api;
}

async function run(req: Request) {
  const res = makeRes();
  const next = jest.fn() as NextFunction;
  await requireAuth(req, res as unknown as Response, next);
  return { res, next: next as jest.Mock };
}

beforeEach(() => {
  clearAuthCache();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('requireAuth', () => {
  it('rejects requests without a token', async () => {
    const { res, next } = await run(makeReq({ token: null }));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid or expired tokens', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const { res, next } = await run(makeReq({ token: 'bad' }));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token and exposes the caller id', async () => {
    const { res, next } = await run(makeReq());
    expect(next).toHaveBeenCalled();
    expect(res.locals.userId).toBe('user-1');
  });

  it('lets public client share links through without a token', async () => {
    const { next } = await run(makeReq({ token: null, path: '/client/share/abc123' }));
    expect(next).toHaveBeenCalled();
    const comment = await run(makeReq({ token: null, method: 'POST', path: '/client/share/abc123/comments' }));
    expect(comment.next).toHaveBeenCalled();
  });

  it('does not make client share management public', async () => {
    const { res } = await run(makeReq({ token: null, path: '/client/projects/p1/shares' }));
    expect(res.statusCode).toBe(401);
  });

  it('replaces client-supplied caller ids with the verified user', async () => {
    const req = makeReq({
      method: 'DELETE',
      path: '/projects/p1',
      query: { actor_id: 'attacker' } as Request['query'],
      body: { actor_id: 'attacker', user_id: 'attacker', created_by: 'attacker' },
    });
    await run(req);
    expect(req.query.actor_id).toBe('user-1');
    expect(req.body).toEqual({ actor_id: 'user-1', user_id: 'user-1', created_by: 'user-1' });
  });

  it('keeps user_id as the target when adding a project member', async () => {
    const req = makeReq({ method: 'POST', path: '/projects/p1/members', body: { user_id: 'new-member', actor_id: 'attacker' } });
    await run(req);
    expect(req.body).toEqual({ user_id: 'new-member', actor_id: 'user-1' });
  });

  it("blocks access to another user's personal routes", async () => {
    const cases: Array<[string, string]> = [
      ['GET', '/notifications/someone-else'],
      ['PATCH', '/notifications/someone-else/preferences'],
      ['PATCH', '/users/someone-else'],
      ['POST', '/users/someone-else/avatar'],
      ['DELETE', '/calendar/someone-else/google'],
    ];
    for (const [method, path] of cases) {
      const { res, next } = await run(makeReq({ method, path }));
      expect([method, path, res.statusCode]).toEqual([method, path, 403]);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('allows personal routes for the caller themselves', async () => {
    const { next } = await run(makeReq({ method: 'PATCH', path: '/users/user-1' }));
    expect(next).toHaveBeenCalled();
  });

  it('returns 503 when Supabase cannot be reached', async () => {
    mockGetUser.mockRejectedValue(new Error('network down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await run(makeReq());
    expect(res.statusCode).toBe(503);
  });
});
