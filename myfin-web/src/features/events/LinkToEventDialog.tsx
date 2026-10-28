import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { isAxiosError } from 'axios';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useGetEvents,
  useLinkEventTransaction,
} from '../../services/events/eventHooks.ts';
import { addDays, istDate, occurrencesBetween } from './eventDates.ts';

/** How far from the payment date an occurrence may be picked. */
const PICK_WINDOW_DAYS = 90;

export type LinkableTransaction = {
  transactionId: string;
  description: string;
  date: number;
};

/** Transactions row action: link a payment to an event occurrence. */
const LinkToEventDialog = (props: {
  transaction: LinkableTransaction;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const { data: events } = useGetEvents();
  const link = useLinkEventTransaction();
  const [eventId, setEventId] = useState('');
  const [date, setDate] = useState('');
  const trxDay = istDate(props.transaction.date);

  const dates = useMemo(() => {
    const event = events?.find((e) => e.event_id === eventId);
    if (!event) return [];
    const list = occurrencesBetween(
      event,
      addDays(trxDay, -PICK_WINDOW_DAYS),
      addDays(trxDay, PICK_WINDOW_DAYS),
    );
    // closest to the payment first
    const gap = (d: string) =>
      Math.abs(
        Date.parse(`${d}T00:00:00Z`) - Date.parse(`${trxDay}T00:00:00Z`),
      );
    return [...list].sort((a, b) => gap(a) - gap(b));
  }, [events, eventId, trxDay]);

  const pickEvent = (id: string) => {
    setEventId(id);
    setDate('');
  };
  const selectedDate = date || dates[0] || '';

  const handleLink = () =>
    link.mutate(
      {
        eventId,
        date: selectedDate,
        transactionId: props.transaction.transactionId,
      },
      {
        onSuccess: () => {
          snackbar.showSnackbar(t('events.linked'), AlertSeverity.SUCCESS);
          props.onClose();
        },
        onError: (err) =>
          snackbar.showSnackbar(
            isAxiosError(err) && err.response?.status === 400
              ? t('events.alreadyLinked')
              : t('common.somethingWentWrongTryAgain'),
            AlertSeverity.ERROR,
          ),
      },
    );

  const activeEvents = (events ?? []).filter((e) => e.active);

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('events.linkTitle')}</DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          <Typography variant="body2" color="text.secondary">
            {`${props.transaction.description} · ${trxDay}`}
          </Typography>
          {activeEvents.length === 0 ? (
            <Typography variant="body2">
              {t('events.noEventsToLink')}
            </Typography>
          ) : (
            <TextField
              select
              label={t('events.event')}
              value={eventId}
              onChange={(e) => pickEvent(e.target.value)}
            >
              {activeEvents.map((e) => (
                <MenuItem key={e.event_id} value={e.event_id}>
                  {e.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {eventId && (
            <TextField
              select
              label={t('events.occurrence')}
              value={selectedDate}
              onChange={(e) => setDate(e.target.value)}
              helperText={
                dates.length === 0 ? t('events.noOccurrenceNear') : ''
              }
            >
              {dates.map((d) => (
                <MenuItem key={d} value={d}>
                  {d}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!eventId || !selectedDate || link.isPending}
          onClick={handleLink}
        >
          {t('events.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LinkToEventDialog;
