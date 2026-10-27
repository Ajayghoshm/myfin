import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserData } from '../../providers/UserProvider.tsx';
import {
  useConfirmPlannedMatch,
  useGetPlanned,
  useGetPlannedCandidates,
  useMarkPlannedDone,
  useSkipPlanned,
} from '../../services/planned/plannedHooks.ts';
import { convertUnixTimestampToDateString } from '../../utils/dateUtils.ts';
import { formatNumberAsCurrency } from '../../utils/textUtils.ts';

const CandidatesDialog = ({
  plannedId,
  onClose,
}: {
  plannedId: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const candidates = useGetPlannedCandidates(plannedId);
  const confirmMatch = useConfirmPlannedMatch();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('planned.matchDialogTitle')}</DialogTitle>
      <DialogContent>
        {candidates.data && candidates.data.length === 0 && (
          <Typography>{t('planned.noCandidates')}</Typography>
        )}
        <List>
          {candidates.data?.map((c) => (
            <ListItemButton
              key={c.transaction_id}
              onClick={() => {
                confirmMatch.mutate(
                  { plannedId, transactionId: c.transaction_id },
                  { onSuccess: onClose },
                );
              }}
            >
              <ListItemText
                primary={`${convertUnixTimestampToDateString(c.date_timestamp)} · ${formatNumberAsCurrency(c.amount)}`}
                secondary={c.description}
              />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

/** The Transactions grid's "Planned" view: future rows that move nothing until resolved. */
const PlannedTransactionsList = () => {
  const { t } = useTranslation();
  const { userAccounts } = useUserData();
  const planned = useGetPlanned();
  const markDone = useMarkPlannedDone();
  const skip = useSkipPlanned();
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const accountName = (id: string | null) =>
    id === null
      ? t('common.externalAccount')
      : (userAccounts?.find((a) => String(a.account_id) === id)?.name ?? id);

  if (!planned.data) return null;
  if (planned.data.length === 0) {
    return <Typography sx={{ p: 2 }}>{t('planned.empty')}</Typography>;
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      {matchingId !== null && (
        <CandidatesDialog
          plannedId={matchingId}
          onClose={() => setMatchingId(null)}
        />
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('transactions.dateOfTransaction')}</TableCell>
            <TableCell>{t('transactions.flow')}</TableCell>
            <TableCell>{t('common.description')}</TableCell>
            <TableCell align="right">{t('common.value')}</TableCell>
            <TableCell>{t('common.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {planned.data.map((row) => (
            <TableRow key={row.planned_id} sx={{ opacity: 0.6 }}>
              <TableCell>
                {convertUnixTimestampToDateString(row.date_timestamp)}
              </TableCell>
              <TableCell>
                {accountName(row.account_from_id)} {'→'}{' '}
                {accountName(row.account_to_id)}
              </TableCell>
              <TableCell>
                {row.description}
                <Chip
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1 }}
                  label={t('planned.chip')}
                />
              </TableCell>
              <TableCell align="right">
                {formatNumberAsCurrency(row.amount)}
              </TableCell>
              <TableCell>
                <Stack direction="row" gap={0.5} flexWrap="wrap">
                  <Button
                    size="small"
                    disabled={markDone.isPending}
                    onClick={() => markDone.mutate(row.planned_id)}
                  >
                    {t('planned.markDone')}
                  </Button>
                  <Button
                    size="small"
                    disabled={skip.isPending}
                    onClick={() => skip.mutate(row.planned_id)}
                  >
                    {t('planned.skip')}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setMatchingId(row.planned_id)}
                  >
                    {t('planned.match')}
                  </Button>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default PlannedTransactionsList;
