import { axios } from '../../data/axios.ts';

export type MilestoneKind =
  | 'net_worth'
  | 'emergency_3m'
  | 'emergency_target'
  | 'goal_funded'
  | 'best_savings_month'
  | 'savings_streak'
  | 'health_all_pass'
  | 'review_streak'
  | 'debt_cleared';

export type Milestone = {
  milestone_id: string;
  kind: MilestoneKind;
  key: string;
  /** Epoch seconds. */
  achieved_at: number;
  dismissed: boolean;
  /** Label parameters: amounts in currency, months as YYYY-MM. */
  data: {
    amount?: number;
    months?: number;
    name?: string;
    month?: string;
    from?: string;
    rate?: number;
    kind?: string;
  } | null;
};

/** Inserts newly achieved milestones and returns every undismissed one (the banners). */
const evaluateMilestones = () =>
  axios.post<Milestone[]>('/milestones/evaluate');
const getMilestones = () => axios.get<Milestone[]>('/milestones');
const dismissMilestone = (id: string) =>
  axios.post<Milestone>(`/milestones/${id}/dismiss`);

export default { evaluateMilestones, getMilestones, dismissMilestone };
