import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
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
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import {
  useDeleteYearlyCost,
  useDismissYearlyCostSuggestion,
  useGetYearlyCostCandidates,
  useGetYearlyCostSuggestions,
  useGetYearlyCosts,
  useLinkYearlyCostTransaction,
  useSaveYearlyCost,
} from '../../services/yearlyCosts/yearlyCostHooks.ts';
import type { YearlyCost } from '../../services/yearlyCosts/yearlyCostServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

type Draft = {
  id: string | null;
  name: string;
  amount: string;
  dueMonth: number;
  categoryId: string;
  linkTransactionId: string | null;
};

const emptyDraft: Draft = {
  id: null,
  name: '',
  amount: '',
  dueMonth: new Date().getMonth() + 1,
  categoryId: '',
  linkTransactionId: null,
};

const useMonthName = () => {
  const { i18n } = useTranslation();
  return (month: number) =>
    new Date(2000, month - 1, 1).toLocaleString(i18n.language, {
      month: 'long',
    });
};

const CandidatesDialog = (props: { cost: YearlyCost; onClose: () => void }) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const snackbar = useSnackbar();
  const { data } = useGetYearlyCostCandidates(props.cost.yearly_cost_id);
  const link = useLinkYearlyCostTransaction();

  const handleLink = (transactionId: string) =>
    link.mutate(
      { transactionId, yearlyCostId: props.cost.yearly_cost_id },
      {
        onError: () =>
          snackbar.showSnackbar(
            t('common.somethingWentWrongTryAgain'),
            AlertSeverity.ERROR,
          ),
      },
    );

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('yearlyCosts.candidatesTitle', { name: props.cost.name })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {t('yearlyCosts.candidatesHelp')}
        </Typography>
        {data?.length === 0 && (
          <Typography variant="body2">
            {t('yearlyCosts.noCandidates')}
          </Typography>
        )}
        <List dense>
          {data?.map((c) => (
            <ListItem
              key={c.transaction_id}
              disablePadding
              secondaryAction={
                <Button
                  size="small"
                  disabled={link.isPending}
                  onClick={() => handleLink(c.transaction_id)}
                >
                  {t('yearlyCosts.link')}
                </Button>
              }
            >
              <ListItemText
                primary={`${c.description} · ${formatCurrency.invoke(c.amount)}`}
                secondary={dayjs.unix(c.date).format('YYYY-MM-DD')}
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

const YearlyCosts = () => {
  const { t } = useTranslation();
  const monthName = useMonthName();
  const formatCurrency = useFormatNumberAsCurrency();
  const snackbar = useSnackbar();
  const costsRequest = useGetYearlyCosts();
  const suggestionsRequest = useGetYearlyCostSuggestions();
  const categoriesRequest = useGetCategories();
  const save = useSaveYearlyCost();
  const remove = useDeleteYearlyCost();
  const dismiss = useDismissYearlyCostSuggestion();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<YearlyCost | null>(null);
  const [linking, setLinking] = useState<YearlyCost | null>(null);

  const status = costsRequest.data?.status;
  const costs = costsRequest.data?.costs ?? [];
  const expenseCategories = (categoriesRequest.data ?? []).filter(
    (c) => c.type === 'E',
  );

  const showError = () =>
    snackbar.showSnackbar(
      t('common.somethingWentWrongTryAgain'),
      AlertSeverity.ERROR,
    );

  const handleSave = () => {
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!draft.name.trim() || !(amount > 0)) {
      snackbar.showSnackbar(
        t('common.fillAllFieldsTryAgain'),
        AlertSeverity.ERROR,
      );
      return;
    }
    save.mutate(
      {
        id: draft.id,
        data: {
          name: draft.name.trim(),
          amount,
          due_month: draft.dueMonth,
          category_id: draft.categoryId ? Number(draft.categoryId) : null,
          ...(draft.id === null && draft.linkTransactionId
            ? { link_transaction_id: Number(draft.linkTransactionId) }
            : {}),
        },
      },
      { onSuccess: () => setDraft(null), onError: showError },
    );
  };

  const renderStatus = () => {
    if (!status) return null;
    if (costs.length === 0)
      return (
        <Typography variant="body2" color="text.secondary">
          {t('yearlyCosts.statusEmpty')}
        </Typography>
      );
    if (!status.account)
      return (
        <Typography variant="body2" color="text.secondary">
          {t('yearlyCosts.noAccount', {
            monthly: formatCurrency.invoke(status.monthly_total),
          })}
        </Typography>
      );
    return (
      <Stack gap={1}>
        <Typography variant="h6">
          {status.on_track
            ? t('yearlyCosts.onTrack', {
                monthly: formatCurrency.invoke(status.monthly_total),
              })
            : t('yearlyCosts.behind', {
                behind: formatCurrency.invoke(status.behind_by),
                transfer: formatCurrency.invoke(status.catch_up_this_month),
              })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('yearlyCosts.statusDetail', {
            account: status.account.name,
            balance: formatCurrency.invoke(status.account.balance),
            shouldHave: formatCurrency.invoke(status.should_have),
          })}
        </Typography>
        {status.upcoming.length > 0 && (
          <Typography variant="body2">
            {t('yearlyCosts.upcoming', {
              list: status.upcoming
                .map(
                  (u) =>
                    `${u.name} (${monthName(u.due_month)}, ${formatCurrency.invoke(u.amount)})`,
                )
                .join(', '),
            })}
          </Typography>
        )}
      </Stack>
    );
  };

  return (
    <Box>
      <PageHeader
        title={t('yearlyCosts.title')}
        subtitle={t('yearlyCosts.subtitle')}
      />
      <Stack gap={3}>
        <DataCard>
          <PanelTitle>{t('yearlyCosts.statusTitle')}</PanelTitle>
          {renderStatus()}
        </DataCard>

        {(suggestionsRequest.data?.length ?? 0) > 0 && (
          <DataCard>
            <PanelTitle>{t('yearlyCosts.suggestionsTitle')}</PanelTitle>
            <Typography variant="body2" color="text.secondary">
              {t('yearlyCosts.suggestionsHelp')}
            </Typography>
            <List dense>
              {suggestionsRequest.data?.map((s) => (
                <ListItem
                  key={s.payee_key}
                  secondaryAction={
                    <Stack direction="row" gap={1}>
                      <Button
                        size="small"
                        onClick={() =>
                          setDraft({
                            id: null,
                            name: s.description || s.payee_key,
                            amount: String(s.amount),
                            dueMonth: s.suggested_due_month,
                            categoryId: s.category_id ?? '',
                            linkTransactionId: s.transaction_id,
                          })
                        }
                      >
                        {t('yearlyCosts.accept')}
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          dismiss.mutate(s.payee_key, { onError: showError })
                        }
                      >
                        {t('yearlyCosts.ignore')}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={`${s.description} · ${formatCurrency.invoke(s.amount)}`}
                    secondary={dayjs.unix(s.date).format('YYYY-MM-DD')}
                  />
                </ListItem>
              ))}
            </List>
          </DataCard>
        )}

        <DataCard>
          <Stack direction="row" justifyContent="space-between" mb={1}>
            <PanelTitle>{t('yearlyCosts.listTitle')}</PanelTitle>
            <Button variant="contained" onClick={() => setDraft(emptyDraft)}>
              {t('yearlyCosts.add')}
            </Button>
          </Stack>
          {costs.length === 0 && (
            <Alert severity="info">{t('yearlyCosts.empty')}</Alert>
          )}
          <List>
            {costs.map((c) => (
              <ListItem
                key={c.yearly_cost_id}
                secondaryAction={
                  <Stack direction="row" gap={1}>
                    <Button size="small" onClick={() => setLinking(c)}>
                      {t('yearlyCosts.linkPayments')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        setDraft({
                          id: c.yearly_cost_id,
                          name: c.name,
                          amount: String(c.amount),
                          dueMonth: c.due_month,
                          categoryId: c.category_id ?? '',
                          linkTransactionId: null,
                        })
                      }
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setToDelete(c)}
                    >
                      {t('common.delete')}
                    </Button>
                  </Stack>
                }
              >
                <ListItemText
                  primary={`${c.name} · ${formatCurrency.invoke(c.amount)}`}
                  secondary={t('yearlyCosts.rowDetail', {
                    month: monthName(c.due_month),
                    monthly: formatCurrency.invoke(c.amount / 12),
                    count: c.linked_count,
                  })}
                />
              </ListItem>
            ))}
          </List>
        </DataCard>
      </Stack>

      <Dialog open={draft !== null} onClose={() => setDraft(null)} fullWidth>
        <DialogTitle>
          {draft?.id ? t('yearlyCosts.edit') : t('yearlyCosts.add')}
        </DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            <TextField
              label={t('yearlyCosts.name')}
              value={draft?.name ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, name: e.target.value })
              }
              autoFocus
            />
            <TextField
              label={t('yearlyCosts.yearlyAmount')}
              type="number"
              value={draft?.amount ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, amount: e.target.value })
              }
            />
            <TextField
              select
              label={t('yearlyCosts.dueMonth')}
              value={draft?.dueMonth ?? 1}
              onChange={(e) =>
                draft &&
                setDraft({ ...draft, dueMonth: Number(e.target.value) })
              }
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <MenuItem key={m} value={m}>
                  {monthName(m)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('yearlyCosts.category')}
              value={draft?.categoryId ?? ''}
              onChange={(e) =>
                draft && setDraft({ ...draft, categoryId: e.target.value })
              }
            >
              <MenuItem value="">{t('yearlyCosts.noCategory')}</MenuItem>
              {expenseCategories.map((c) => (
                <MenuItem
                  key={String(c.category_id)}
                  value={String(c.category_id)}
                >
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={save.isPending}
            onClick={handleSave}
          >
            {t('yearlyCosts.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {linking && (
        <CandidatesDialog cost={linking} onClose={() => setLinking(null)} />
      )}

      <GenericConfirmationDialog
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onNegativeClick={() => setToDelete(null)}
        onPositiveClick={() => {
          if (toDelete)
            remove.mutate(toDelete.yearly_cost_id, {
              onSuccess: () => setToDelete(null),
              onError: showError,
            });
        }}
        titleText={t('yearlyCosts.deleteTitle')}
        descriptionText={t('yearlyCosts.deleteDescription', {
          name: toDelete?.name ?? '',
        })}
        alert={t('yearlyCosts.deleteAlert')}
        positiveText={t('common.delete')}
      />
    </Box>
  );
};

export default YearlyCosts;
