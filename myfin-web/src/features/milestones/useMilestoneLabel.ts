import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { Milestone } from '../../services/milestones/milestoneServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

/** Localised one-line label of a milestone (amounts in the user's currency, month names localised). */
export function useMilestoneLabel() {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const monthName = (ym: string | undefined) =>
    ym
      ? dayjs(`${ym}-01`).toDate().toLocaleString(i18n.language, {
          month: 'long',
          year: 'numeric',
        })
      : '';

  return (m: Milestone): string => {
    const d = m.data ?? {};
    switch (m.kind) {
      case 'net_worth':
        return t('milestones.label.net_worth', {
          amount: formatCurrency.invoke(d.amount ?? Number(m.key)),
        });
      case 'emergency_3m':
        return t('milestones.label.emergency_3m');
      case 'emergency_target':
        return t('milestones.label.emergency_target', {
          count: d.months ?? Number(m.key),
        });
      case 'goal_funded':
        return t('milestones.label.goal_funded', { name: d.name ?? '' });
      case 'best_savings_month':
        return t('milestones.label.best_savings_month', {
          month: monthName(d.month ?? m.key),
          pct: Math.round((d.rate ?? 0) * 100),
        });
      case 'savings_streak':
        return t('milestones.label.savings_streak', {
          from: monthName(d.from),
          month: monthName(d.month ?? m.key),
        });
      case 'health_all_pass':
        return t('milestones.label.health_all_pass', {
          month: monthName(d.month ?? m.key),
        });
      case 'review_streak':
        return t('milestones.label.review_streak', {
          from: monthName(d.from),
          month: monthName(d.month ?? m.key),
        });
      case 'debt_cleared':
        if (d.kind === 'lent')
          return t('milestones.label.debt_cleared_lent', {
            name: d.name ?? '',
          });
        if (d.kind === 'borrowed')
          return t('milestones.label.debt_cleared_borrowed', {
            name: d.name ?? '',
          });
        return t('milestones.label.debt_cleared_loan', { name: d.name ?? '' });
      default:
        return m.kind;
    }
  };
}
