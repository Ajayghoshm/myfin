import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DataCard from '../../components/DataCard.tsx';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useUserData } from '../../providers/UserProvider.tsx';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import {
  useDeleteEvent,
  useDismissEventSuggestion,
  useGetEventSuggestions,
  useGetEvents,
  useSaveEvent,
  useSetOccurrenceDone,
  useUnlinkEventTransaction,
} from '../../services/events/eventHooks.ts';
import {
  EVENT_KINDS,
  EVENT_REPEATS,
  type EventKind,
  type EventOccurrence,
  type EventRepeat,
  type EventSuggestion,
  isPeopleKind,
  type MyFinEvent,
} from '../../services/events/eventServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

type Draft = {
  id: string | null;
  name: string;
  kind: EventKind;
  date: string;
  repeat: EventRepeat;
  amount: string;
  giftBudget: string;
  accountId: string;
  categoryId: string;
  payeeKey: string;
  active: boolean;
  sourceKey: string | null;
  /** Last occurrence's actual spend, offered as the gift budget. */
  suggestedBudget: number | null;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  kind: 'birthday',
  date: dayjs().format('YYYY-MM-DD'),
  repeat: 'yearly',
  amount: '',
  giftBudget: '',
  accountId: '',
  categoryId: '',
  payeeKey: '',
  active: true,
  sourceKey: null,
  suggestedBudget: null,
});

const fromEvent = (e: MyFinEvent): Draft => ({
  id: e.event_id,
  name: e.name,
  kind: e.kind,
  date: e.date,
  repeat: e.repeat,
  amount: e.amount != null ? String(e.amount) : '',
  giftBudget: e.gift_budget != null ? String(e.gift_budget) : '',
  accountId: e.account_id ?? '',
  categoryId: e.category_id ?? '',
  payeeKey: e.payee_key ?? '',
  active: e.active,
  sourceKey: null,
  suggestedBudget: e.suggested_gift_budget,
});

const fromSuggestion = (s: EventSuggestion): Draft => ({
  ...emptyDraft(),
  name: s.name,
  kind: s.kind,
  date: s.date,
  repeat: s.repeat,
  amount: s.amount != null ? String(s.amount) : '',
  accountId: s.account_id ?? '',
  categoryId: s.category_id ?? '',
  payeeKey: s.payee_key ?? '',
  sourceKey: s.key,
});

const toNumberOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

const Events = () => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const snackbar = useSnackbar();
  const { userAccounts } = useUserData();
  const eventsRequest = useGetEvents();
  const suggestionsRequest = useGetEventSuggestions();
  const categoriesRequest = useGetCategories();
  const save = useSaveEvent();
  const remove = useDeleteEvent();
  const dismiss = useDismissEventSuggestion();
  const setDone = useSetOccurrenceDone();
  const unlink = useUnlinkEventTransaction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<MyFinEvent | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = eventsRequest.data ?? [];
  const suggestions = suggestionsRequest.data ?? [];
  const expenseCategories = (categoriesRequest.data ?? []).filter(
    (c) => c.type === 'E',
  );

  const showError = () =>
    snackbar.showSnackbar(
      t('common.somethingWentWrongTryAgain'),
      AlertSeverity.ERROR,
    );

  const when = (o: EventOccurrence) =>
    o.days_until === 0
      ? t('events.today')
      : o.days_until > 0
        ? t('events.inDays', { count: o.days_until })
        : t('events.daysAgo', { count: -o.days_until });

  const statusLabel = (e: MyFinEvent, o: EventOccurrence) =>
    o.status === 'done'
      ? isPeopleKind(e.kind)
        ? t('events.doneMark')
        : t('events.paidMark')
      : t('events.pending');

  const handleSave = () => {
    if (!draft) return;
    const amount = toNumberOrNull(draft.amount);
    const giftBudget = toNumberOrNull(draft.giftBudget);
    if (
      !draft.name.trim() ||
      !draft.date ||
      (amount !== null && !(amount >= 0)) ||
      (giftBudget !== null && !(giftBudget >= 0))
    ) {
      snackbar.showSnackbar(
        t('common.fillAllFieldsTryAgain'),
        AlertSeverity.ERROR,
      );
      return;
    }
    const people = isPeopleKind(draft.kind);
    save.mutate(
      {
        id: draft.id,
        data: {
          name: draft.name.trim(),
          kind: draft.kind,
          date: draft.date,
          repeat: draft.repeat,
          amount,
          gift_budget: people ? giftBudget : null,
          account_id:
            !people && draft.accountId ? Number(draft.accountId) : null,
          category_id:
            !people && draft.categoryId ? Number(draft.categoryId) : null,
          payee_key: !people && draft.payeeKey.trim() ? draft.payeeKey : null,
          active: draft.active,
          ...(draft.id === null && draft.sourceKey
            ? { source_key: draft.sourceKey }
            : {}),
        },
      },
      {
        onSuccess: () => setDraft(null),
        onError: () =>
          snackbar.showSnackbar(t('events.saveFailed'), AlertSeverity.ERROR),
      },
    );
  };

  const toggleDone = (e: MyFinEvent, o: EventOccurrence) =>
    setDone.mutate(
      { eventId: e.event_id, date: o.date, done: o.status !== 'done' },
      { onError: showError },
    );

  const renderOccurrence = (e: MyFinEvent, o: EventOccurrence) => (
    <Box key={o.date} py={0.5}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Typography variant="body2">{`${o.date} · ${when(o)}`}</Typography>
        <Chip
          size="small"
          color={o.status === 'done' ? 'success' : 'default'}
          label={statusLabel(e, o)}
        />
        {o.gift_spent != null && (
          <Typography variant="body2" color="text.secondary">
            {t('events.spent', { amount: formatCurrency.invoke(o.gift_spent) })}
          </Typography>
        )}
        <Button
          size="small"
          disabled={setDone.isPending}
          onClick={() => toggleDone(e, o)}
        >
          {o.status === 'done' ? t('events.markPending') : t('events.markDone')}
        </Button>
      </Stack>
      {o.linked.map((l) => (
        <Stack
          key={l.transaction_id}
          direction="row"
          gap={1}
          alignItems="center"
          pl={2}
        >
          <Typography variant="body2" color="text.secondary">
            {`${l.description} · ${formatCurrency.invoke(l.amount)} · ${dayjs.unix(l.date).format('YYYY-MM-DD')}`}
          </Typography>
          <Link
            component="button"
            variant="body2"
            disabled={unlink.isPending}
            onClick={() =>
              unlink.mutate(
                {
                  eventId: e.event_id,
                  date: o.date,
                  transactionId: l.transaction_id,
                },
                { onError: showError },
              )
            }
          >
            {t('events.unlink')}
          </Link>
        </Stack>
      ))}
    </Box>
  );

  const detail = (e: MyFinEvent) => {
    const parts = [
      t(`events.repeat.${e.repeat}`),
      ...(e.amount != null ? [formatCurrency.invoke(e.amount)] : []),
      ...(e.gift_budget != null
        ? [t('events.budget', { amount: formatCurrency.invoke(e.gift_budget) })]
        : []),
      ...(e.tag_name ? [t('events.tagHint', { tag: e.tag_name })] : []),
    ];
    return parts.join(' · ');
  };

  const people = draft ? isPeopleKind(draft.kind) : false;

  return (
    <Box>
      <PageHeader title={t('events.title')} subtitle={t('events.subtitle')} />
      <Stack gap={3}>
        {suggestions.length > 0 && (
          <DataCard>
            <PanelTitle>{t('events.suggestionsTitle')}</PanelTitle>
            <Typography variant="body2" color="text.secondary">
              {t('events.suggestionsHelp')}
            </Typography>
            <List dense>
              {suggestions.map((s) => (
                <ListItem
                  key={s.key}
                  secondaryAction={
                    <Stack direction="row" gap={1}>
                      <Button
                        size="small"
                        onClick={() => setDraft(fromSuggestion(s))}
                      >
                        {t('events.accept')}
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          dismiss.mutate(s.key, { onError: showError })
                        }
                      >
                        {t('events.ignore')}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={`${s.name}${s.amount != null ? ` · ${formatCurrency.invoke(s.amount)}` : ''}`}
                    secondary={`${t(`events.kind.${s.kind}`)} · ${t(`events.repeat.${s.repeat}`)} · ${s.date}`}
                  />
                </ListItem>
              ))}
            </List>
          </DataCard>
        )}

        <DataCard>
          <Stack direction="row" justifyContent="space-between" mb={1}>
            <PanelTitle>{t('events.listTitle')}</PanelTitle>
            <Button variant="contained" onClick={() => setDraft(emptyDraft())}>
              {t('events.add')}
            </Button>
          </Stack>
          {eventsRequest.isSuccess && events.length === 0 && (
            <Alert severity="info">{t('events.empty')}</Alert>
          )}
          <List>
            {events.map((e) => (
              <Box key={e.event_id}>
                <ListItem
                  secondaryAction={
                    <Stack direction="row" gap={1}>
                      <Button
                        size="small"
                        onClick={() =>
                          setExpanded(
                            expanded === e.event_id ? null : e.event_id,
                          )
                        }
                      >
                        {t('events.history')}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setDraft(fromEvent(e))}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => setToDelete(e)}
                      >
                        {t('common.delete')}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" gap={1} alignItems="center">
                        <span>{e.name}</span>
                        <Chip size="small" label={t(`events.kind.${e.kind}`)} />
                        {!e.active && (
                          <Chip size="small" label={t('events.inactive')} />
                        )}
                      </Stack>
                    }
                    secondary={
                      <>
                        {detail(e)}
                        {e.next_occurrence && (
                          <>
                            <br />
                            {t('events.next', {
                              date: e.next_occurrence.date,
                              when: when(e.next_occurrence),
                              status: statusLabel(e, e.next_occurrence),
                            })}
                          </>
                        )}
                      </>
                    }
                  />
                </ListItem>
                <Collapse in={expanded === e.event_id} unmountOnExit>
                  <Box pl={2} pb={1}>
                    {e.next_occurrence &&
                      renderOccurrence(e, e.next_occurrence)}
                    {e.history.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('events.noHistory')}
                      </Typography>
                    ) : (
                      e.history.map((o) => renderOccurrence(e, o))
                    )}
                  </Box>
                </Collapse>
              </Box>
            ))}
          </List>
        </DataCard>
      </Stack>

      <Dialog open={draft !== null} onClose={() => setDraft(null)} fullWidth>
        <DialogTitle>
          {draft?.id ? t('events.edit') : t('events.add')}
        </DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            <TextField
              label={t('events.name')}
              value={draft?.name ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, name: e.target.value })
              }
              autoFocus
            />
            <TextField
              select
              label={t('events.kindLabel')}
              value={draft?.kind ?? 'birthday'}
              onChange={(e) =>
                draft &&
                setDraft({ ...draft, kind: e.target.value as EventKind })
              }
            >
              {EVENT_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`events.kind.${k}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="date"
              label={t('events.date')}
              value={draft?.date ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, date: e.target.value })
              }
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label={t('events.repeatLabel')}
              value={draft?.repeat ?? 'yearly'}
              onChange={(e) =>
                draft &&
                setDraft({ ...draft, repeat: e.target.value as EventRepeat })
              }
            >
              {EVENT_REPEATS.map((r) => (
                <MenuItem key={r} value={r}>
                  {t(`events.repeat.${r}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('events.amount')}
              type="number"
              value={draft?.amount ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, amount: e.target.value })
              }
            />
            {people ? (
              <TextField
                label={t('events.giftBudget')}
                type="number"
                value={draft?.giftBudget ?? ''}
                onChange={(e) =>
                  draft && setDraft({ ...draft, giftBudget: e.target.value })
                }
                helperText={
                  draft?.suggestedBudget != null ? (
                    <Link
                      component="button"
                      type="button"
                      variant="caption"
                      onClick={() =>
                        draft &&
                        setDraft({
                          ...draft,
                          giftBudget: String(draft.suggestedBudget),
                        })
                      }
                    >
                      {t('events.useLastSpend', {
                        amount: formatCurrency.invoke(draft.suggestedBudget),
                      })}
                    </Link>
                  ) : (
                    t('events.giftBudgetHelp')
                  )
                }
              />
            ) : (
              <>
                <TextField
                  label={t('events.payee')}
                  value={draft?.payeeKey ?? ''}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, payeeKey: e.target.value })
                  }
                  helperText={t('events.payeeHelp')}
                />
                <TextField
                  select
                  label={t('events.category')}
                  value={draft?.categoryId ?? ''}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, categoryId: e.target.value })
                  }
                >
                  <MenuItem value="">{t('events.none')}</MenuItem>
                  {expenseCategories.map((c) => (
                    <MenuItem
                      key={String(c.category_id)}
                      value={String(c.category_id)}
                    >
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label={t('events.account')}
                  value={draft?.accountId ?? ''}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, accountId: e.target.value })
                  }
                  helperText={t('events.accountHelp')}
                >
                  <MenuItem value="">{t('events.none')}</MenuItem>
                  {(userAccounts ?? []).map((a) => (
                    <MenuItem
                      key={String(a.account_id)}
                      value={String(a.account_id)}
                    >
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={draft?.active ?? true}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, active: e.target.checked })
                  }
                />
              }
              label={t('events.active')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={save.isPending}
            onClick={handleSave}
          >
            {t('events.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <GenericConfirmationDialog
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onNegativeClick={() => setToDelete(null)}
        onPositiveClick={() => {
          if (toDelete)
            remove.mutate(toDelete.event_id, {
              onSuccess: () => setToDelete(null),
              onError: showError,
            });
        }}
        titleText={t('events.deleteTitle')}
        descriptionText={t('events.deleteDescription', {
          name: toDelete?.name ?? '',
        })}
        alert={t('events.deleteAlert')}
        positiveText={t('common.delete')}
      />
    </Box>
  );
};

export default Events;
