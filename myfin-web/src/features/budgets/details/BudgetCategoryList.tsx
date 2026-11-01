import { List, ListItem, Typography } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { rolledUp } from '../budgetGroups.ts';
import BudgetCategoryRow, {
  type BudgetCategoryRowProps,
} from './BudgetCategoryRow.tsx';
import BudgetGroupHeader from './BudgetGroupHeader.tsx';
import type { BudgetView, DirectionRow } from './budgetView.ts';

type Props = {
  view: BudgetView;
  isDebit: boolean;
  keyPrefix: string;
  matches: (name: string) => boolean;
  rowProps: Omit<
    BudgetCategoryRowProps,
    'category' | 'isDebit' | 'lockHint' | 'displayPlanned'
  >;
};

const BudgetCategoryList = ({
  view,
  isDebit,
  keyPrefix,
  matches,
  rowProps,
}: Props) => {
  const { t } = useTranslation();
  const plannedField = isDebit ? 'planned_debit' : 'planned_credit';
  const currentField = isDebit ? 'current_debit' : 'current_credit';

  const renderRow = (
    row: DirectionRow,
    visible: boolean,
    extra?: { indent?: boolean; lockHint?: string; displayPlanned?: number },
  ) => (
    <React.Fragment key={`${keyPrefix}:${row.category_id}`}>
      <ListItem
        alignItems="flex-start"
        sx={{
          p: 0,
          pl: extra?.indent ? { xs: 2, sm: 4 } : 0,
          display: visible ? 'flex' : 'none',
        }}
      >
        <BudgetCategoryRow
          {...rowProps}
          category={row.source}
          isDebit={isDebit}
          lockHint={extra?.lockHint}
          displayPlanned={extra?.displayPlanned}
        />
      </ListItem>
    </React.Fragment>
  );

  return (
    <List
      disablePadding
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      {view.groups.map((group) => {
        const parentMatches = matches(group.parent.name);
        const childVisible = (name: string) => parentMatches || matches(name);
        const groupVisible =
          parentMatches || group.children.some((c) => matches(c.name));
        return (
          <React.Fragment
            key={`${keyPrefix}:group:${group.parent.category_id}`}
          >
            {groupVisible && (
              <BudgetGroupHeader
                name={group.parent.name}
                planned={rolledUp(group, plannedField)}
                current={rolledUp(group, currentField)}
              />
            )}
            {group.showParent &&
              renderRow(group.parent, parentMatches, {
                lockHint:
                  rowProps.isOpen && group.mode === 'split'
                    ? t('budgetDetails.budgetedPerSubcategory')
                    : undefined,
                displayPlanned:
                  group.mode === 'split'
                    ? rolledUp(group, plannedField)
                    : undefined,
              })}
            {group.children.map((child) =>
              renderRow(child, childVisible(child.name), {
                indent: true,
                lockHint:
                  rowProps.isOpen && group.mode === 'lump'
                    ? t('budgetDetails.budgetedOnWholeCategory')
                    : undefined,
              }),
            )}
          </React.Fragment>
        );
      })}
      {view.groups.length > 0 && view.unassigned.length > 0 && (
        <Typography
          component="h3"
          sx={{ fontSize: 15, fontWeight: 650, px: 0.5, pt: 1 }}
        >
          {t('budgetDetails.unassignedCategories')}
        </Typography>
      )}
      {view.unassigned.map((row) => renderRow(row, matches(row.name)))}
    </List>
  );
};

export default BudgetCategoryList;
