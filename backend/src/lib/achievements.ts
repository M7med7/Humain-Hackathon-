export function computeAchievements(
  completedCount: number,
  projectCount: number,
  weeklyStreak: number,
): string[] {
  const achievements: string[] = [];
  if (completedCount >= 1)  achievements.push('First Task Completed');
  if (completedCount >= 10) achievements.push('Task Master (10+)');
  if (completedCount >= 50) achievements.push('Productivity Guru (50+)');
  if (projectCount >= 1)    achievements.push('Team Player (1+ Projects)');
  if (projectCount >= 5)    achievements.push('Veteran (5+ Projects)');
  if (weeklyStreak >= 4)    achievements.push('On Fire (4+ Week Streak)');
  return achievements;
}
