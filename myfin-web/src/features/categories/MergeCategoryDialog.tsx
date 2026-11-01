import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useMergeCategories } from '../../services/category/CategoryHooks.tsx';
import { Category } from '../../services/category/categoryServices.ts';
import { categoryLabel } from '../../services/category/categoryTree.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  source: Category;
  categories: Category[];
};

const MergeCategoryDialog = (props: Props) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const mergeRequest = useMergeCategories();
  const [targetId, setTargetId] = useState('');

  const options = useMemo(
    () =>
      props.categories
        .filter(
          (c) => String(c.category_id) !== String(props.source.category_id),
        )
        .map((c) => ({
          id: String(c.category_id),
          label: categoryLabel(c, props.categories),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [props.categories, props.source],
  );

  const confirm = () => {
    const target = props.categories.find(
      (c) => String(c.category_id) === targetId,
    );
    if (!target) return;
    mergeRequest.mutate(
      {
        sourceId: props.source.category_id,
        targetId: target.category_id,
      },
      {
        onSuccess: () => {
          snackbar.showSnackbar(
            t('categories.categoriesSuccessfullyMerged'),
            AlertSeverity.SUCCESS,
          );
          props.onClose();
        },
        onError: (error) => {
          snackbar.showSnackbar(
            apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
            AlertSeverity.ERROR,
          );
        },
      },
    );
  };

  return (
    <Dialog open={props.isOpen} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('categories.mergeDialogTitle', { name: props.source.name })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('categories.mergeWarning', { name: props.source.name })}
        </DialogContentText>
        <TextField
          select
          fullWidth
          margin="dense"
          id="merge-target-select"
          label={t('categories.mergeTarget')}
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {options.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!targetId || mergeRequest.isPending}
          onClick={confirm}
        >
          {t('categories.mergeConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MergeCategoryDialog;
