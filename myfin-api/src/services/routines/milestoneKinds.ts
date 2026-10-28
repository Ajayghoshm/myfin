/** Milestone kinds (#21); pure so the backup manager can import it without the services. */
export const MILESTONE_KINDS = [
  'net_worth',
  'emergency_3m',
  'emergency_target',
  'goal_funded',
  'best_savings_month',
  'savings_streak',
  'health_all_pass',
  'review_streak',
  'debt_cleared',
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
