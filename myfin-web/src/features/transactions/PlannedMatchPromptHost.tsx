import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import {
  useConfirmPlannedMatch,
  useGetPlannedMatches,
} from '../../services/planned/plannedHooks.ts';
import { subscribeToCreatedTransactions } from '../../services/planned/plannedMatchBus.ts';
import { convertUnixTimestampToDateString } from '../../utils/dateUtils.ts';
import { formatNumberAsCurrency } from '../../utils/textUtils.ts';

/** Offers, one at a time, to match newly created transactions to planned ones. Never applies a match by itself. */
const MatchQueue = ({
  transactionIds,
  onDone,
}: {
  transactionIds: string[];
  onDone: () => void;
}) => {
  const { t } = useTranslation();
  const matchesRequest = useGetPlannedMatches(transactionIds);
  const confirmMatch = useConfirmPlannedMatch();
  const [index, setIndex] = useState(0);
  const matches = matchesRequest.data ?? [];

  useEffect(() => {
    if (matchesRequest.isSuccess && index >= matches.length) onDone();
  }, [matchesRequest.isSuccess, index, matches.length]);

  const current = matches[index];
  if (!current) return null;
  const next = () => setIndex((i) => i + 1);

  return (
    <GenericConfirmationDialog
      isOpen
      onClose={next}
      onNegativeClick={next}
      onPositiveClick={() => {
        confirmMatch.mutate({
          plannedId: current.planned.planned_id,
          transactionId: current.transaction_id,
        });
        next();
      }}
      titleText={t('planned.confirmTitle')}
      descriptionText={t('planned.confirmText', {
        description: current.planned.description,
        amount: formatNumberAsCurrency(current.planned.amount),
        date: convertUnixTimestampToDateString(current.planned.date_timestamp),
      })}
      alert={t('planned.confirmAlert')}
      positiveText={t('planned.confirmYes')}
      negativeText={t('planned.notNow')}
    />
  );
};

const PlannedMatchPromptHost = () => {
  const [batch, setBatch] = useState<{ key: number; ids: string[] } | null>(
    null,
  );

  useEffect(
    () =>
      subscribeToCreatedTransactions((ids) =>
        setBatch((prev) => ({ key: (prev?.key ?? 0) + 1, ids })),
      ),
    [],
  );

  if (!batch) return null;
  return (
    <MatchQueue
      key={batch.key}
      transactionIds={batch.ids}
      onDone={() => setBatch(null)}
    />
  );
};

export default PlannedMatchPromptHost;
