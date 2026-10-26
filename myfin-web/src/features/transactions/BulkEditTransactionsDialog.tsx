import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import { useGetEntities } from '../../services/entity/entityHooks.ts';
import { BulkUpdateTransactionsRequest } from '../../services/trx/trxServices.ts';

const UNCHANGED = 'unchanged';
const NONE = 'none';

type Props = {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onApply: (changes: Omit<BulkUpdateTransactionsRequest, 'transaction_ids' | 'filter'>) => void;
};

const toIdChange = (value: string) =>
  value === UNCHANGED ? undefined : value === NONE ? null : BigInt(value);

const BulkEditTransactionsDialog = (props: Props) => {
  const { t } = useTranslation();
  const categoriesRequest = useGetCategories();
  const entitiesRequest = useGetEntities();
  const [category, setCategory] = useState(UNCHANGED);
  const [entity, setEntity] = useState(UNCHANGED);
  const [essential, setEssential] = useState(UNCHANGED);
  const [isConfirming, setConfirming] = useState(false);

  const nothingChosen =
    category === UNCHANGED && entity === UNCHANGED && essential === UNCHANGED;

  const apply = () => {
    props.onApply({
      category_id: toIdChange(category),
      entity_id: toIdChange(entity),
      is_essential: essential === UNCHANGED ? undefined : essential === 'yes',
    });
  };

  return (
    <Dialog open={props.isOpen} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isConfirming
          ? t('transactions.bulkEditConfirmTitle', { count: props.selectedCount })
          : t('transactions.bulkEditTitle', { count: props.selectedCount })}
      </DialogTitle>
      <DialogContent>
        {isConfirming ? (
          <DialogContentText>{t('transactions.bulkEditConfirmText')}</DialogContentText>
        ) : (
          <Stack gap={2} sx={{ mt: 1 }}>
            <TextField
              select
              label={t('transactions.category')}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <MenuItem value={UNCHANGED}>{t('transactions.bulkEditLeaveUnchanged')}</MenuItem>
              <MenuItem value={NONE}>{t('common.noCategory')}</MenuItem>
              {(categoriesRequest.data || []).map((cat) => (
                <MenuItem key={String(cat.category_id)} value={String(cat.category_id)}>
                  {cat.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('transactions.entity')}
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            >
              <MenuItem value={UNCHANGED}>{t('transactions.bulkEditLeaveUnchanged')}</MenuItem>
              <MenuItem value={NONE}>{t('common.noEntity')}</MenuItem>
              {(entitiesRequest.data || []).map((ent) => (
                <MenuItem key={String(ent.entity_id)} value={String(ent.entity_id)}>
                  {ent.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('transactions.essential')}
              value={essential}
              onChange={(event) => setEssential(event.target.value)}
            >
              <MenuItem value={UNCHANGED}>{t('transactions.bulkEditLeaveUnchanged')}</MenuItem>
              <MenuItem value="yes">{t('common.yes')}</MenuItem>
              <MenuItem value="no">{t('common.no')}</MenuItem>
            </TextField>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={isConfirming ? () => setConfirming(false) : props.onClose}>
          {isConfirming ? t('common.goBack') : t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={nothingChosen}
          onClick={isConfirming ? apply : () => setConfirming(true)}
        >
          {isConfirming
            ? t('transactions.bulkEditApply', { count: props.selectedCount })
            : t('transactions.continueImport')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BulkEditTransactionsDialog;
