import { SaveAlt } from '@mui/icons-material';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { ROUTE_BUDGET_TEMPLATE } from '../../providers/RoutesProvider.tsx';
import {
  useSaveBudgetTemplateFromMonth,
  useSaveBudgetTemplateFromTypical,
} from '../../services/budget/budgetHooks.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { getMonthsFullName } from '../../utils/dateUtils.ts';
import { parseYearMonth } from '../../utils/istMonth.ts';

type Source = 'typical' | 'month';

/** Saves what Insights shows (the typical month, or the viewed month's actuals) as a new named budget template. */
const SaveAsTemplateButton = ({ ym }: { ym: string }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [name, setName] = useState('');
  const fromTypical = useSaveBudgetTemplateFromTypical();
  const fromMonth = useSaveBudgetTemplateFromMonth();

  const { year, month } = parseYearMonth(ym);
  const monthLabel = `${getMonthsFullName(month)} ${year}`;

  const choose = (next: Source) => {
    setAnchor(null);
    setSource(next);
    setName(
      next === 'typical' ? t('insights.typicalTemplateName') : monthLabel,
    );
  };

  const onDone = () => {
    setSource(null);
    snackbar.showSnackbar(
      t('insights.savedAsTemplate', { name: name.trim() }),
      AlertSeverity.SUCCESS,
    );
    navigate(ROUTE_BUDGET_TEMPLATE);
  };
  const onError = (error: unknown) =>
    snackbar.showSnackbar(
      apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
      AlertSeverity.ERROR,
    );

  const submit = () => {
    const target = { name: name.trim() };
    if (!target.name) return;
    if (source === 'typical')
      fromTypical.mutate(target, { onSuccess: onDone, onError });
    else fromMonth.mutate({ month, year, target }, { onSuccess: onDone, onError });
  };

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<SaveAlt />}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ mb: 2 }}
      >
        {t('insights.saveAsTemplate')}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
      >
        <MenuItem onClick={() => choose('typical')}>
          <ListItemText
            primary={t('insights.templateFromTypical')}
            secondary={t('insights.templateFromTypicalHelp')}
          />
        </MenuItem>
        <MenuItem onClick={() => choose('month')}>
          <ListItemText
            primary={t('insights.templateFromMonth', { month: monthLabel })}
            secondary={t('insights.templateFromMonthHelp')}
          />
        </MenuItem>
      </Menu>
      <Dialog
        open={source !== null}
        onClose={() => setSource(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('insights.saveAsTemplate')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('insights.templateNameHelp')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label={t('budgetTemplate.templateName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSource(null)}>
            {t('budgetTemplate.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={
              !name.trim() || fromTypical.isPending || fromMonth.isPending
            }
            onClick={submit}
          >
            {t('budgetTemplate.ok')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SaveAsTemplateButton;
