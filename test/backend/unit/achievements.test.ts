import { computeAchievements } from '../../../backend/src/lib/achievements';

describe('computeAchievements', () => {
  it('returns empty array for a brand-new user', () => {
    expect(computeAchievements(0, 0, 0)).toEqual([]);
  });

  it('awards "First Task Completed" at 1 completed task', () => {
    expect(computeAchievements(1, 0, 0)).toContain('First Task Completed');
  });

  it('does not award "Task Master" below 10 tasks', () => {
    expect(computeAchievements(9, 0, 0)).not.toContain('Task Master (10+)');
  });

  it('awards "Task Master" at exactly 10 completed tasks', () => {
    expect(computeAchievements(10, 0, 0)).toContain('Task Master (10+)');
  });

  it('awards "Productivity Guru" at exactly 50 completed tasks', () => {
    const result = computeAchievements(50, 0, 0);
    expect(result).toContain('Productivity Guru (50+)');
  });

  it('does not award "Productivity Guru" below 50 tasks', () => {
    expect(computeAchievements(49, 0, 0)).not.toContain('Productivity Guru (50+)');
  });

  it('awards "Team Player" at 1 project', () => {
    expect(computeAchievements(0, 1, 0)).toContain('Team Player (1+ Projects)');
  });

  it('awards "Veteran" at exactly 5 projects', () => {
    expect(computeAchievements(0, 5, 0)).toContain('Veteran (5+ Projects)');
  });

  it('does not award "Veteran" below 5 projects', () => {
    expect(computeAchievements(0, 4, 0)).not.toContain('Veteran (5+ Projects)');
  });

  it('awards "On Fire" at exactly 4-week streak', () => {
    expect(computeAchievements(0, 0, 4)).toContain('On Fire (4+ Week Streak)');
  });

  it('does not award "On Fire" below 4-week streak', () => {
    expect(computeAchievements(0, 0, 3)).not.toContain('On Fire (4+ Week Streak)');
  });

  it('awards all achievements for a high-performing user', () => {
    const result = computeAchievements(50, 5, 4);
    expect(result).toEqual([
      'First Task Completed',
      'Task Master (10+)',
      'Productivity Guru (50+)',
      'Team Player (1+ Projects)',
      'Veteran (5+ Projects)',
      'On Fire (4+ Week Streak)',
    ]);
  });

  it('preserves achievement order', () => {
    const result = computeAchievements(10, 1, 0);
    expect(result.indexOf('First Task Completed')).toBeLessThan(result.indexOf('Task Master (10+)'));
  });
});
