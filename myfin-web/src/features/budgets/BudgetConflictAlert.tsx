import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { BudgetGroup, BudgetRowLike } from './budgetGroups.ts';

type Props = {
  conflicts: BudgetGroup<BudgetRowLike>[];
  onResolve: (
    group: BudgetGroup<BudgetRowLike>,
    keep: 'parent' | 'children',
  ) => void;
};

/** Warns about parents and subcategories that are both budgeted, with a one-click fix for each. */
const BudgetConflictAlert = ({ conflicts, onResolve }: Props) => {
  const { t } = useTranslation();
  if (conflicts.length === 0) return null;
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <Typography variant="body2">{t('budgetTemplate.conflictIntro')}</Typography>
      {conflicts.map((group) => (
        <Box
          key={String(group.parent.category_id)}
          display="flex"
          flexWrap="wrap"
          alignItems="center"
          gap={1}
          mt={1}
        >
          <Typography variant="body2" fontWeight="bold">
            {group.parent.name}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onResolve(group, 'parent')}
          >
            {t('budgetTemplate.keepParent', { name: group.parent.name })}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onResolve(group, 'children')}
          >
            {t('budgetTemplate.keepChildren', { name: group.parent.name })}
          </Button>
        </Box>
      ))}
    </Alert>
  );
};

export default BudgetConflictAlert;
