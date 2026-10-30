import { checkCapacityWarnings, MemberCapacity } from '../../../backend/src/services/capacity';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

describe('checkCapacityWarnings', () => {
  it('returns empty array when all members are under threshold', () => {
    const capacities: MemberCapacity[] = [
      { user_id: 'u1', total_assigned_days: 5, tasks_count: 2 },
      { user_id: 'u2', total_assigned_days: 8, tasks_count: 3 },
    ];
    expect(checkCapacityWarnings(capacities)).toEqual([]);
  });

  it('returns members that exceed the default threshold of 10 days', () => {
    const capacities: MemberCapacity[] = [
      { user_id: 'u1', total_assigned_days: 11, tasks_count: 4 },
      { user_id: 'u2', total_assigned_days: 5, tasks_count: 2 },
    ];
    const result = checkCapacityWarnings(capacities);
    expect(result).toHaveLength(1);
    expect(result[0]?.user_id).toBe('u1');
  });

  it('respects a custom maxDays threshold', () => {
    const capacities: MemberCapacity[] = [
      { user_id: 'u1', total_assigned_days: 6, tasks_count: 2 },
      { user_id: 'u2', total_assigned_days: 3, tasks_count: 1 },
    ];
    const result = checkCapacityWarnings(capacities, 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.user_id).toBe('u1');
  });

  it('returns empty array for empty input', () => {
    expect(checkCapacityWarnings([])).toEqual([]);
  });

  it('returns all members when all exceed the threshold', () => {
    const capacities: MemberCapacity[] = [
      { user_id: 'u1', total_assigned_days: 15, tasks_count: 5 },
      { user_id: 'u2', total_assigned_days: 12, tasks_count: 4 },
    ];
    expect(checkCapacityWarnings(capacities)).toHaveLength(2);
  });

  it('does not flag members exactly at the threshold', () => {
    const capacities: MemberCapacity[] = [
      { user_id: 'u1', total_assigned_days: 10, tasks_count: 3 },
    ];
    expect(checkCapacityWarnings(capacities)).toEqual([]);
  });
});
