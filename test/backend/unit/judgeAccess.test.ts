jest.mock('../../../backend/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { judgeRole, judgeSpaceId } from '../../../backend/src/lib/spaces';

const JUDGE_SPACE = '1cf3123a-f45f-4f95-b449-d38fb6adabcb';

describe('judge access', () => {
  const original = process.env.JUDGE_SPACE_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.JUDGE_SPACE_ID;
    else process.env.JUDGE_SPACE_ID = original;
  });

  it('makes a judge a read-only guest of the judge space and of no other', () => {
    process.env.JUDGE_SPACE_ID = JUDGE_SPACE;
    expect(judgeRole(JUDGE_SPACE)).toBe('Guest');
    expect(judgeRole('22222222-2222-4222-8222-222222222222')).toBeNull();
  });

  it('is off when the judge space is missing or malformed', () => {
    delete process.env.JUDGE_SPACE_ID;
    expect(judgeSpaceId()).toBeNull();
    expect(judgeRole(JUDGE_SPACE)).toBeNull();
    process.env.JUDGE_SPACE_ID = 'not-a-uuid';
    expect(judgeSpaceId()).toBeNull();
  });
});
