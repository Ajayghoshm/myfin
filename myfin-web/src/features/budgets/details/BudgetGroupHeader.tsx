import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFormatNumberAsCurrency } from '../../../utils/textHooks.ts';

type Props = {
  name: string;
  planned: number;
  current: number;
};

const BudgetGroupHeader = ({ name, planned, current }: Props) => {
  const { t } = useTranslation();
  const format = useFormatNumberAsCurrency();
  return (
    <Stack
      direction="row"
      alignItems="baseline"
      justifyContent="space-between"
      gap={2}
      sx={{ width: '100%', px: 0.5, pt: 1 }}
    >
      <Typography
        component="h3"
        sx={{ fontSize: 15, fontWeight: 650, minWidth: 0 }}
        noWrap
      >
        {name}
      </Typography>
      <Box
        sx={{
          fontSize: 12,
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
        }}
      >
        {t('budgetDetails.estimated')}: {format.invoke(planned)}
        {' | '}
        {t('budgetDetails.current')}: {format.invoke(current)}
      </Box>
    </Stack>
  );
};

export default BudgetGroupHeader;
