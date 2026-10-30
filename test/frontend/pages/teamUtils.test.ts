import { computeCapacity, getInitials, computeLevelInfo } from '../../../frontend/src/lib/teamUtils';

describe('computeCapacity', () => {
  it('returns correct percentage', () => {
    expect(computeCapacity(20, 40)).toBe(50);
  });

  it('caps at 100 when storyPoints exceeds maxSP', () => {
    expect(computeCapacity(50, 40)).toBe(100);
  });

  it('returns 0 when storyPoints is 0', () => {
    expect(computeCapacity(0, 40)).toBe(0);
  });

  it('returns 100 when storyPoints equals maxSP', () => {
    expect(computeCapacity(40, 40)).toBe(100);
  });

  it('rounds fractional percentages', () => {
    expect(computeCapacity(1, 3)).toBe(33);
  });

  it('handles maxSP of 1', () => {
    expect(computeCapacity(1, 1)).toBe(100);
  });
});

describe('getInitials', () => {
  it('returns first two letters of first and last name', () => {
    expect(getInitials('Mohammed Alharbi', 'mo@test.com')).toBe('MA');
  });

  it('returns first letter for a single-word name', () => {
    expect(getInitials('Mohammed', 'mo@test.com')).toBe('M');
  });

  it('falls back to first two chars of email when name is null', () => {
    expect(getInitials(null, 'admin@test.com')).toBe('AD');
  });

  it('falls back to email when name is undefined', () => {
    expect(getInitials(undefined, 'zz@test.com')).toBe('ZZ');
  });

  it('returns uppercase', () => {
    expect(getInitials('alice bob', 'a@b.com')).toBe('AB');
  });

  it('handles three-word names by using first two chars across all words', () => {
    const result = getInitials('Ali Ahmed Saud', 'a@b.com');
    expect(result).toBe('AA');
  });
});

describe('computeLevelInfo', () => {
  it('starts at level 1 with 0 completed tasks', () => {
    const { level, progress } = computeLevelInfo(0);
    expect(level).toBe(1);
    expect(progress).toBe(0);
  });

  it('advances to level 2 at 5 completed tasks', () => {
    const { level, progress } = computeLevelInfo(5);
    expect(level).toBe(2);
    expect(progress).toBe(0);
  });

  it('shows 60% progress at 3 tasks into a level', () => {
    const { progress } = computeLevelInfo(3);
    expect(progress).toBe(60);
  });

  it('shows 80% progress at 4 tasks into a level', () => {
    const { progress } = computeLevelInfo(4);
    expect(progress).toBe(80);
  });

  it('advances level every 5 tasks', () => {
    expect(computeLevelInfo(10).level).toBe(3);
    expect(computeLevelInfo(15).level).toBe(4);
    expect(computeLevelInfo(20).level).toBe(5);
  });

  it('resets progress at each level boundary', () => {
    expect(computeLevelInfo(10).progress).toBe(0);
    expect(computeLevelInfo(15).progress).toBe(0);
  });

  it('correctly computes mid-level progress', () => {
    const { level, progress } = computeLevelInfo(7);
    expect(level).toBe(2);
    expect(progress).toBe(40);
  });
});
