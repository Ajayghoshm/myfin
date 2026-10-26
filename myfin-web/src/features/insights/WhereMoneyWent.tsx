import { PersonOffOutlined, PersonOutlined, Undo } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyView from '../../components/EmptyView.tsx';
import { AlertSeverity, useSnackbar } from '../../providers/SnackbarProvider.tsx';
import { useSetPayeeClassification } from '../../services/insights/insightsHooks.ts';
import {
  MonthInsights,
  PayeeKind,
} from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';

type Props = {
  ym: string;
  data: MonthInsights;
};

type View = 'category' | 'merchant' | 'person';

const EMPTY_HEIGHT = 200;

const WhereMoneyWent = ({ ym, data }: Props) => {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('category');

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          gap={1}
          mb={2}
        >
          <Typography variant="h6">{t('insights.whereMoneyWent')}</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, value: View | null) => value && setView(value)}
          >
            <ToggleButton value="category">{t('insights.byCategory')}</ToggleButton>
            <ToggleButton value="merchant">{t('insights.byMerchant')}</ToggleButton>
            <ToggleButton value="person">{t('insights.byPerson')}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {view === 'category' && <ByCategory ym={ym} data={data} />}
        {view === 'merchant' && <ByMerchant ym={ym} data={data} />}
        {view === 'person' && <ByPerson ym={ym} data={data} />}
      </CardContent>
    </Card>
  );
};

const Empty = () => (
  <Box height={EMPTY_HEIGHT} display="flex">
    <EmptyView />
  </Box>
);

/** Link for a payee figure; an empty key is never linked. */
const payeeLink = (ym: string, payeeKey: string, type?: 'E' | 'I') =>
  payeeKey === ''
    ? null
    : buildTransactionsLink({ month: ym, payee: payeeKey, type });

const ByCategory = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();

  const rows = [...data.by_category]
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (rows.length === 0) return <Empty />;
  const max = rows[0].amount;

  return (
    <Stack gap={1.5}>
      {rows.map((row) => {
        const link = buildTransactionsLink({
          month: ym,
          type: 'E',
          category: row.category_id ?? 'none',
        });
        const label =
          row.category_id === null
            ? t('insights.uncategorised')
            : (row.name ?? t('insights.uncategorised'));
        return (
          <Box key={row.category_id ?? 'none'}>
            <Stack direction="row" justifyContent="space-between" gap={2}>
              <Typography variant="body2" noWrap>
                <FigureLink to={link}>{label}</FigureLink>
              </Typography>
              <Typography variant="body2" fontWeight="bold" noWrap>
                <FigureLink to={link}>{formatCurrency.invoke(row.amount)}</FigureLink>
              </Typography>
            </Stack>
            <Box
              sx={{
                mt: 0.5,
                height: 8,
                borderRadius: 1,
                background: theme.palette.action.hover,
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  borderRadius: 1,
                  width: `${Math.max((row.amount / max) * 100, 1)}%`,
                  background:
                    row.category_id === null
                      ? theme.palette.text.disabled
                      : theme.palette.primary.main,
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
};

function useClassify() {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const mutation = useSetPayeeClassification();

  return {
    isPending: mutation.isPending,
    classify: (payeeKey: string, kind: PayeeKind | null) => {
      mutation.mutate(
        { payee_key: payeeKey, kind },
        {
          onError: () =>
            snackbar.showSnackbar(
              t('common.somethingWentWrongTryAgain'),
              AlertSeverity.ERROR,
            ),
        },
      );
    },
  };
}

const ByMerchant = ({ ym, data }: Props) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const { classify, isPending } = useClassify();

  const rows = data.merchants.top.filter((row) => row.payee_key !== '');
  if (rows.length === 0 && data.merchants.other_amount === 0) return <Empty />;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('insights.merchant')}</TableCell>
            <TableCell align="right">{t('insights.total')}</TableCell>
            <TableCell align="right">{t('insights.payments')}</TableCell>
            <TableCell align="right">{t('insights.average')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const link = payeeLink(ym, row.payee_key, 'E');
            return (
              <TableRow key={row.payee_key}>
                <TableCell>
                  <FigureLink to={link}>{row.payee_key}</FigureLink>
                </TableCell>
                <TableCell align="right">
                  <FigureLink to={link}>{formatCurrency.invoke(row.amount)}</FigureLink>
                </TableCell>
                <TableCell align="right">
                  <FigureLink to={link}>{row.count}</FigureLink>
                </TableCell>
                <TableCell align="right">
                  {formatCurrency.invoke(row.average)}
                </TableCell>
                <TableCell align="right" padding="checkbox">
                  <Tooltip title={t('insights.thisIsAPerson')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={isPending}
                        aria-label={t('insights.thisIsAPerson')}
                        onClick={() => classify(row.payee_key, 'person')}
                      >
                        <PersonOutlined fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
          {data.merchants.other_amount > 0 && (
            <TableRow>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {t('insights.otherMerchants')}
                </Typography>
              </TableCell>
              <TableCell align="right">
                {formatCurrency.invoke(data.merchants.other_amount)}
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
};

const ByPerson = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const { classify, isPending } = useClassify();

  const rows = data.people.filter((row) => row.payee_key !== '');
  if (rows.length === 0) return <Empty />;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('insights.person')}</TableCell>
            <TableCell align="right">{t('insights.sent')}</TableCell>
            <TableCell align="right">{t('insights.received')}</TableCell>
            <TableCell align="right">{t('insights.net')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.payee_key}>
              <TableCell>
                <FigureLink to={payeeLink(ym, row.payee_key)}>
                  {row.payee_key}
                </FigureLink>
              </TableCell>
              <TableCell align="right">
                <FigureLink to={payeeLink(ym, row.payee_key, 'E')}>
                  {formatCurrency.invoke(row.sent)}
                </FigureLink>
              </TableCell>
              <TableCell align="right">
                <FigureLink to={payeeLink(ym, row.payee_key, 'I')}>
                  {formatCurrency.invoke(row.received)}
                </FigureLink>
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  color:
                    row.net < 0
                      ? theme.palette.error.main
                      : theme.palette.success.main,
                }}
              >
                <FigureLink to={payeeLink(ym, row.payee_key)}>
                  {formatCurrency.invoke(row.net)}
                </FigureLink>
              </TableCell>
              <TableCell align="right" padding="checkbox">
                <Stack direction="row" justifyContent="flex-end">
                  {row.source === 'user' && (
                    <Tooltip title={t('insights.resetClassification')}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={isPending}
                          aria-label={t('insights.resetClassification')}
                          onClick={() => classify(row.payee_key, null)}
                        >
                          <Undo fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title={t('insights.notAPerson')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={isPending}
                        aria-label={t('insights.notAPerson')}
                        onClick={() => classify(row.payee_key, 'merchant')}
                      >
                        <PersonOffOutlined fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default WhereMoneyWent;
