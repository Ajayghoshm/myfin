import { alpha, useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useGetDailySpend } from '../../services/insights/insightsHooks.ts';
import { parseYearMonth } from '../../utils/istMonth.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';

type Props = {
  ym: string;
};

type View = 'month' | 'year';

const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
const SHADE_ALPHAS = [0.2, 0.4, 0.6, 0.8, 1];
const YEAR_MONTHS = 12;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMs = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day);
/** Monday = 0 ... Sunday = 6 */
const weekdayOf = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

/** Shade 0..4 from the response's 4 cut points; `null` for a zero day. */
export function shadeFor(total: number, quantiles: number[]): number | null {
  if (total <= 0) return null;
  return quantiles.filter((q) => q < total).length;
}

/** Month view range for 'YYYY-MM', and the year view range ending at that month. */
export function calendarRange(ym: string, view: View) {
  const { year, month } = parseYearMonth(ym);
  const lastDay = utcMs(year, month + 1, 1) - DAY_MS;
  const firstMonthIdx =
    view === 'year'
      ? year * 12 + (month - 1) - (YEAR_MONTHS - 1)
      : year * 12 + (month - 1);
  const start = utcMs(
    Math.floor(firstMonthIdx / 12),
    (firstMonthIdx % 12) + 1,
    1,
  );
  return { fromMs: start, toMs: lastDay, from: iso(start), to: iso(lastDay) };
}

/** Spending calendar: each IST day shaded by its spending, a month grid or a 12-month strip. */
const SpendingCalendar = ({ ym }: Props) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const formatCurrency = useFormatNumberAsCurrency();
  const [view, setView] = useState<View>('month');
  const [flexibleOnly, setFlexibleOnly] = useState(false);

  const range = useMemo(() => calendarRange(ym, view), [ym, view]);
  const { data, isError } = useGetDailySpend(
    range.from,
    range.to,
    flexibleOnly,
  );

  const byDate = useMemo(
    () => new Map((data?.days ?? []).map((d) => [d.date, d])),
    [data?.days],
  );
  const weekdays = t('insights.calendar.weekdays', {
    returnObjects: true,
  }) as unknown as string[];
  const today = iso(Date.now() + IST_OFFSET_MS);

  // Only trust data that matches the current range and toggle (placeholder data may be stale).
  const ready =
    data &&
    data.from === range.from &&
    data.to === range.to &&
    data.flexible_only === flexibleOnly
      ? data
      : null;
  const quantiles = ready?.quantiles ?? [];

  const openDay = (date: string) =>
    navigate(
      buildTransactionsLink({
        day: date,
        type: 'E',
        cost: flexibleOnly ? 'flexible' : undefined,
      }),
    );

  const renderCell = (date: string, size: number, showNumber: boolean) => {
    const entry = byDate.get(date);
    const shade = entry ? shadeFor(entry.total, quantiles) : null;
    const isToday = date === today;
    const label = entry
      ? t('insights.calendar.tooltip', {
          amount: formatCurrency.invoke(entry.total),
          count: entry.count,
        })
      : t('insights.calendar.noSpend');
    const cell = (
      <Box
        component={entry ? 'button' : 'div'}
        type={entry ? 'button' : undefined}
        aria-label={`${date}: ${label}`}
        onClick={entry ? () => openDay(date) : undefined}
        data-date={date}
        data-shade={shade ?? ''}
        sx={{
          width: size,
          height: size,
          p: 0,
          border: 'none',
          borderRadius: '3px',
          cursor: entry ? 'pointer' : 'default',
          fontSize: 11,
          color:
            shade !== null && shade >= 3
              ? theme.palette.primary.contrastText
              : theme.palette.text.secondary,
          backgroundColor:
            shade === null
              ? alpha(theme.palette.text.primary, 0.04)
              : alpha(theme.palette.primary.main, SHADE_ALPHAS[shade]),
          outline: isToday ? `2px solid ${theme.palette.text.primary}` : 'none',
          outlineOffset: -1,
        }}
      >
        {showNumber ? Number(date.slice(8, 10)) : null}
      </Box>
    );
    return (
      <Tooltip key={date} title={`${date} · ${label}`} arrow>
        {cell}
      </Tooltip>
    );
  };

  const renderMonth = () => {
    const lead = weekdayOf(range.fromMs);
    const total = Math.round((range.toMs - range.fromMs) / DAY_MS) + 1;
    const cells: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: total }, (_, i) =>
        iso(range.fromMs + i * DAY_MS),
      ),
    ];
    return (
      <Box
        display="grid"
        gridTemplateColumns="repeat(7, minmax(0, 40px))"
        gap="4px"
      >
        {weekdays.map((w) => (
          <Typography key={w} variant="caption" color="text.secondary">
            {w}
          </Typography>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <Box key={`blank-${i}`} />
          ) : (
            renderCell(date, 40, true)
          ),
        )}
      </Box>
    );
  };

  const renderYear = () => {
    const gridStart = range.fromMs - weekdayOf(range.fromMs) * DAY_MS;
    const weeks = Math.ceil((range.toMs - gridStart) / DAY_MS / 7 + 1 / 7);
    const columns = Array.from({ length: weeks }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => gridStart + (w * 7 + d) * DAY_MS),
    );
    return (
      <Box sx={{ overflowX: 'auto', pb: 1 }}>
        <Box display="flex" gap="3px" width="max-content">
          {columns.map((col) => {
            const first = col.find(
              (ms) =>
                ms >= range.fromMs &&
                ms <= range.toMs &&
                new Date(ms).getUTCDate() === 1,
            );
            return (
              <Box key={col[0]} display="flex" flexDirection="column" gap="3px">
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ height: 14, lineHeight: '14px', whiteSpace: 'nowrap' }}
                >
                  {first === undefined
                    ? ''
                    : new Date(first).toLocaleDateString(i18n.language, {
                        month: 'short',
                        timeZone: 'UTC',
                      })}
                </Typography>
                {col.map((ms) =>
                  ms < range.fromMs || ms > range.toMs ? (
                    <Box key={ms} sx={{ width: 14, height: 14 }} />
                  ) : (
                    renderCell(iso(ms), 14, false)
                  ),
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={1}
        >
          <Typography variant="h6">{t('insights.calendar.title')}</Typography>
          <Stack direction="row" alignItems="center" gap={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={flexibleOnly}
                  onChange={(e) => setFlexibleOnly(e.target.checked)}
                />
              }
              label={t('insights.calendar.flexibleOnly')}
            />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, v: View | null) => v && setView(v)}
            >
              <ToggleButton value="month">
                {t('insights.calendar.monthView')}
              </ToggleButton>
              <ToggleButton value="year">
                {t('insights.calendar.yearView')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        {isError && !ready && (
          <Typography color="error" variant="body2" mt={2}>
            {t('insights.calendar.loadError')}
          </Typography>
        )}
        {ready && (
          <>
            <Box mt={2}>{view === 'month' ? renderMonth() : renderYear()}</Box>
            <Stack direction="row" alignItems="center" gap={0.5} mt={1}>
              <Typography variant="caption" color="text.secondary">
                {t('insights.calendar.less')}
              </Typography>
              {SHADE_ALPHAS.map((a) => (
                <Box
                  key={a}
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '2px',
                    backgroundColor: alpha(theme.palette.primary.main, a),
                  }}
                />
              ))}
              <Typography variant="caption" color="text.secondary">
                {t('insights.calendar.more')}
              </Typography>
            </Stack>
            <Typography variant="subtitle2" mt={2} mb={0.5}>
              {t('insights.calendar.weekdayAverages')}
            </Typography>
            <Box
              display="grid"
              gridTemplateColumns="repeat(7, minmax(0, 1fr))"
              gap={1}
              maxWidth={420}
            >
              {ready.weekday_avg.map((avg, i) => (
                <Box key={weekdays[i]}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    {weekdays[i]}
                  </Typography>
                  <Typography variant="body2">
                    {formatCurrency.invoke(avg)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SpendingCalendar;
