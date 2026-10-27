import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import type { TransactionRef } from '../../services/debts/debtServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { formatDay } from './debtDates.ts';

/** Lists candidate transactions with a Link button each. */
const TransactionPickerDialog = (props: {
  title: string;
  help: string;
  candidates: TransactionRef[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  onPick: (transactionId: number) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {props.help}
        </Typography>
        {props.isLoading && (
          <Typography color="text.secondary">{t('debts.loading')}</Typography>
        )}
        {props.candidates && props.candidates.length === 0 && (
          <Typography color="text.secondary">
            {t('debts.loans.noCandidates')}
          </Typography>
        )}
        <List dense disablePadding>
          {(props.candidates ?? []).map((c) => (
            <ListItem
              key={c.transaction_id}
              disableGutters
              secondaryAction={
                <Button
                  size="small"
                  disabled={props.isPending}
                  onClick={() => props.onPick(Number(c.transaction_id))}
                >
                  {t('debts.loans.link')}
                </Button>
              }
            >
              <ListItemText
                primary={c.description}
                secondary={`${formatCurrency.invoke(c.amount)} · ${formatDay(c.date)}`}
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default TransactionPickerDialog;
