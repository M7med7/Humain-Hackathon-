import { durationToDays } from '../../../backend/src/services/aiManager';

jest.mock('../../../backend/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

describe('durationToDays', () => {
  it('converts weeks to days (×7)', () => {
    expect(durationToDays(1, 'Weeks')).toBe(7);
    expect(durationToDays(8, 'Weeks')).toBe(56);
  });

  it('converts months to days (×30)', () => {
    expect(durationToDays(1, 'Months')).toBe(30);
    expect(durationToDays(3, 'Months')).toBe(90);
    expect(durationToDays(12, 'Months')).toBe(360);
  });

  it('converts years to days (×365)', () => {
    expect(durationToDays(1, 'Years')).toBe(365);
    expect(durationToDays(2, 'Years')).toBe(730);
  });

  it('handles value of 0', () => {
    expect(durationToDays(0, 'Weeks')).toBe(0);
    expect(durationToDays(0, 'Months')).toBe(0);
    expect(durationToDays(0, 'Years')).toBe(0);
  });

  it('months produce more days than the same number of weeks', () => {
    expect(durationToDays(4, 'Months')).toBeGreaterThan(durationToDays(4, 'Weeks'));
  });

  it('years produce more days than the same number of months', () => {
    expect(durationToDays(1, 'Years')).toBeGreaterThan(durationToDays(1, 'Months'));
  });
});
