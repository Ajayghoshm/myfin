import { describe, expect, it } from 'vitest';
import { meetsSavingsTarget, targetPercent } from '../../src/services/insights/analyticsRules.js';

describe('meetsSavingsTarget (ruling E9: rounded rate ≥ rounded target)', () => {
  it('19.6 % meets a 20 % target; 19.4 % does not', () => {
    expect(meetsSavingsTarget(0.196, 20)).toBe(true);
    expect(meetsSavingsTarget(0.194, 20)).toBe(false);
    expect(meetsSavingsTarget(0.2, 20)).toBe(true);
  });

  it('rounds an amount-mode target too', () => {
    // 25,400 of 1,00,000 income is a 25.4 % target: a 25 % rate meets it as displayed
    const target = targetPercent('amount', 25400, 100000, null)!;
    expect(meetsSavingsTarget(0.25, target)).toBe(true);
    expect(meetsSavingsTarget(0.244, target)).toBe(false);
  });
});
