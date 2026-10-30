import { KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material';
import {
  Autocomplete,
  Button,
  Checkbox,
  Collapse,
  FilterOptionsState,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Fragment, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreatableOption } from '../../../components/useCreatableOptions.ts';
import { TransactionType } from '../../../services/trx/trxServices.ts';
import { useFormatNumberAsCurrency } from '../../../utils/textHooks.ts';
import {
  groupCategory,
  groupEntity,
  groupEssential,
  GroupableTrx,
  PayeeGroup,
} from './payeeGroups.ts';

type OptionsFilter = (
  options: CreatableOption[],
  state: FilterOptionsState<CreatableOption>,
) => CreatableOption[];

export type Props = {
  groups: PayeeGroup[];
  transactions: GroupableTrx[];
  categoryOptions: CreatableOption[];
  entityOptions: CreatableOption[];
  filterCategoryOptions: OptionsFilter;
  filterEntityOptions: OptionsFilter;
  onCategoryChange: (group: PayeeGroup, value: CreatableOption | null) => void;
  onEntityChange: (group: PayeeGroup, value: CreatableOption | null) => void;
  onEssentialChange: (group: PayeeGroup, checked: boolean) => void;
  onApplyToAll: (group: PayeeGroup) => void;
  /** True when the group has a pending choice that some rows do not yet carry. */
  canApplyToAll: (group: PayeeGroup) => boolean;
  /** The group's individual rows, shown when the group is expanded. */
  renderRows: (group: PayeeGroup) => ReactNode;
};

const ImportTrxStep2PayeeGroups = (props: Props) => {
  const { t } = useTranslation();
  const formatNumberAsCurrency = useFormatNumberAsCurrency();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <TableContainer>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t('importTransactions.payeeGroupsHint')}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width={48} />
            <TableCell>{t('importTransactions.phonePePayee')}</TableCell>
            <TableCell sx={{ minWidth: 220 }}>
              {t('transactions.category')}
            </TableCell>
            <TableCell sx={{ minWidth: 220 }}>
              {t('transactions.entity')}
            </TableCell>
            <TableCell>{t('transactions.essential')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {props.groups.map((group) => {
            const category = groupCategory(props.transactions, group);
            const entity = groupEntity(props.transactions, group);
            const essential = groupEssential(props.transactions, group);
            const total = props.transactions
              .filter((trx) => group.rowIds.includes(trx.tempId))
              .reduce((sum, trx) => sum + trx.value, 0);
            const isOpen = !!expanded[group.key];
            return (
              <Fragment key={group.key}>
                <TableRow>
                  <TableCell>
                    <IconButton
                      size="small"
                      aria-label={group.payee}
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [group.key]: !prev[group.key],
                        }))
                      }
                    >
                      {isOpen ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">
                      {group.payee}
                      {group.type === TransactionType.Income ? ' ↓' : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('importTransactions.groupTransactionsCount', {
                        count: group.count,
                      })}{' '}
                      · {formatNumberAsCurrency.invoke(total)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      value={category.kind === 'single' ? category.value : null}
                      onChange={(_event, value) =>
                        props.onCategoryChange(group, value)
                      }
                      options={props.categoryOptions}
                      filterOptions={props.filterCategoryOptions}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('transactions.category')}
                          placeholder={
                            category.kind === 'mixed'
                              ? t('importTransactions.groupMixed')
                              : undefined
                          }
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      value={entity.kind === 'single' ? entity.value : null}
                      onChange={(_event, value) =>
                        props.onEntityChange(group, value)
                      }
                      options={props.entityOptions}
                      filterOptions={props.filterEntityOptions}
                      isOptionEqualToValue={(option, value) =>
                        option.id === value.id
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('transactions.entity')}
                          placeholder={
                            entity.kind === 'mixed'
                              ? t('importTransactions.groupMixed')
                              : undefined
                          }
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={essential.kind === 'single' && essential.value}
                      indeterminate={essential.kind === 'mixed'}
                      disabled={group.type === TransactionType.Income}
                      onChange={(_event, checked) =>
                        props.onEssentialChange(group, checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      disabled={!props.canApplyToAll(group)}
                      onClick={() => props.onApplyToAll(group)}
                    >
                      {t('importTransactions.applyToAllRows')}
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ py: 0, border: 0 }} colSpan={6}>
                    <Collapse in={isOpen} timeout="auto" unmountOnExit>
                      {props.renderRows(group)}
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ImportTrxStep2PayeeGroups;
