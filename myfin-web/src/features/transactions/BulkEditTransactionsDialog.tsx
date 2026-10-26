import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Autocomplete from '@mui/material/Autocomplete';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import { useGetEntities } from '../../services/entity/entityHooks.ts';
import { BulkUpdateTransactionsRequest } from '../../services/trx/trxServices.ts';
import { IdLabelPair } from './AddEditTransactionDialog.tsx';
import {
  CreatableKind,
  useCreatableOptions,
} from '../../components/useCreatableOptions.ts';

const UNCHANGED = 'unchanged';

type Props = {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onApply: (changes: Omit<BulkUpdateTransactionsRequest, 'transaction_ids' | 'filter'>) => void;
};

// placeholder ids for the "leave unchanged" and "no category/entity" choices
const UNCHANGED_ID = -2n;
const NONE_ID = -3n;

const toIdChange = (option: IdLabelPair) =>
  option.id === UNCHANGED_ID ? undefined : option.id === NONE_ID ? null : option.id;

/** Type-to-search picker that can also create a missing category/entity. */
const CreatablePicker = ({
  kind,
  label,
  noneLabel,
  items,
  value,
  onChange,
}: {
  kind: CreatableKind;
  label: string;
  noneLabel: string;
  items: IdLabelPair[];
  value: IdLabelPair;
  onChange: (value: IdLabelPair) => void;
}) => {
  const { t } = useTranslation();
  const creatable = useCreatableOptions(kind);
  const unchanged = { id: UNCHANGED_ID, label: t('transactions.bulkEditLeaveUnchanged') };
  const none = { id: NONE_ID, label: noneLabel };
  return (
    <Autocomplete
      disableClearable
      options={[unchanged, none, ...creatable.withCreated(items)]}
      filterOptions={creatable.filterOptions}
      value={value}
      onChange={async (_event, picked) => {
        const resolved = await creatable.resolve(picked, items);
        if (resolved) onChange(resolved);
      }}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
};

const BulkEditTransactionsDialog = (props: Props) => {
  const { t } = useTranslation();
  const categoriesRequest = useGetCategories();
  const entitiesRequest = useGetEntities();
  const unchanged = { id: UNCHANGED_ID, label: t('transactions.bulkEditLeaveUnchanged') };
  const [category, setCategory] = useState<IdLabelPair>(unchanged);
  const [entity, setEntity] = useState<IdLabelPair>(unchanged);
  const [essential, setEssential] = useState(UNCHANGED);
  const [isConfirming, setConfirming] = useState(false);

  const nothingChosen =
    category.id === UNCHANGED_ID && entity.id === UNCHANGED_ID && essential === UNCHANGED;

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
            <CreatablePicker
              kind="category"
              label={t('transactions.category')}
              noneLabel={t('common.noCategory')}
              items={(categoriesRequest.data || []).map((cat) => ({
                id: cat.category_id,
                label: cat.name,
              }))}
              value={category}
              onChange={setCategory}
            />
            <CreatablePicker
              kind="entity"
              label={t('transactions.entity')}
              noneLabel={t('common.noEntity')}
              items={(entitiesRequest.data || []).map((ent) => ({
                id: ent.entity_id,
                label: ent.name,
              }))}
              value={entity}
              onChange={setEntity}
            />
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
