import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import { useSaveBudgetTemplateFromBudget } from '../../../services/budget/budgetHooks.ts';
import { apiErrorMessage } from '../../../utils/apiErrorMessage.ts';

const NEW_TEMPLATE = 'new';

type Props = {
  open: boolean;
  onClose: () => void;
  budgetId: bigint;
  /** E.g. "March 2026"; used as the suggested name of a new template. */
  monthLabel: string;
  templates: { template_id: number | string | bigint; name: string }[];
};

/** Saves the budget as last saved as a new template, or over an existing one. */
const SaveBudgetAsTemplateDialog = (props: Props) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const request = useSaveBudgetTemplateFromBudget();
  const [target, setTarget] = useState(NEW_TEMPLATE);
  const [name, setName] = useState(props.monthLabel);
  const isNew = target === NEW_TEMPLATE;

  const submit = () => {
    const trimmed = name.trim();
    if (isNew && !trimmed) return;
    request.mutate(
      {
        budgetId: props.budgetId,
        target: isNew ? { name: trimmed } : { template_id: target },
      },
      {
        onSuccess: () => {
          props.onClose();
          snackbar.showSnackbar(
            isNew
              ? t('budgetTemplate.savedAsNew', { name: trimmed })
              : t('budgetTemplate.savedFromBudget'),
            AlertSeverity.SUCCESS,
          );
        },
        onError: (error) =>
          snackbar.showSnackbar(
            apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('budgetDetails.saveAsTemplate')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          {t('budgetDetails.saveAsTemplateHelp', { month: props.monthLabel })}
        </Typography>
        <TextField
          select
          fullWidth
          label={t('budgetTemplate.template')}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <MenuItem value={NEW_TEMPLATE}>
            {t('budgetDetails.saveAsNewTemplate')}
          </MenuItem>
          {props.templates.map((tpl) => (
            <MenuItem
              key={String(tpl.template_id)}
              value={String(tpl.template_id)}
            >
              {t('budgetDetails.replaceNamedTemplate', { name: tpl.name })}
            </MenuItem>
          ))}
        </TextField>
        {isNew && (
          <TextField
            fullWidth
            autoFocus
            sx={{ mt: 2 }}
            label={t('budgetDetails.newTemplateName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('budgetTemplate.cancel')}</Button>
        <Button
          variant="contained"
          disabled={(isNew && !name.trim()) || request.isPending}
          onClick={submit}
        >
          {isNew
            ? t('budgetTemplate.saveAsNew')
            : t('budgetTemplate.replaceTemplate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SaveBudgetAsTemplateDialog;
