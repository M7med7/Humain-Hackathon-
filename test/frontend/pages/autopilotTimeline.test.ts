import { timelineScale } from '../../../frontend/src/features/autopilot/format';

describe('timelineScale', () => {
  it('zooms in on the work when the deadline is far away', () => {
    const scale = timelineScale(2.5, 90, 'Day');
    expect(scale.deadlineInView).toBe(false);
    expect(scale.spanHours).toBe(8);
    expect(scale.ticks.map((tick) => tick.label)).toEqual(['9:00', '11:00', '13:00', '15:00']);
  });

  it('keeps a near deadline on the axis with a few readable day labels', () => {
    const scale = timelineScale(30, 10, 'Day');
    expect(scale.deadlineInView).toBe(true);
    expect(scale.spanHours).toBe(80);
    expect(scale.ticks.map((tick) => tick.label)).toEqual(['Day 1', '3', '5', '7', '9']);
  });

  it('never prints more than six day labels', () => {
    const scale = timelineScale(500, 90, 'Day');
    expect(scale.ticks.length).toBeLessThanOrEqual(6);
    expect(scale.ticks[0]?.label).toBe('Day 1');
  });
});
