import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import GlobalStyles from '@mui/material/GlobalStyles';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ROUTE_PROFILE } from '../../providers/RoutesProvider.tsx';
import { useGetLegacy } from '../../services/legacy/legacyHooks.ts';
import type {
  LegacyEntry,
  LegacyKind,
} from '../../services/legacy/legacyServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { LEGACY_FIELDS } from './LegacyEntryDialog.tsx';

// Hides the app chrome and lets the content flow over as many pages as it needs
const printStyles = {
  '@media print': {
    '.MuiDrawer-root, .MuiAppBar-root, .legacy-no-print': {
      display: 'none !important',
    },
    main: {
      height: 'auto !important',
      overflow: 'visible !important',
      width: '100% !important',
    },
    body: { background: '#fff !important', color: '#000 !important' },
    '.legacy-footer': {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: '10pt',
    },
    '.legacy-sheet': { paddingBottom: '48px' },
    '.legacy-block': { breakInside: 'avoid' },
  },
};

const LegacyPrint = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetLegacy();
  const generatedOn = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
  }).format(new Date());

  const fieldLines = (entry: LegacyEntry) =>
    LEGACY_FIELDS[entry.kind]
      .filter((f) => entry.data[f] !== null && entry.data[f] !== undefined)
      .filter((f) => String(entry.data[f]) !== '')
      .map((f) => (
        <Typography key={f} variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {entry.kind !== 'instruction' &&
            `${t(`profile.legacy.field.${f}`)}: `}
          {f === 'sum_assured'
            ? formatCurrency.invoke(Number(entry.data[f]))
            : String(entry.data[f])}
        </Typography>
      ));

  const section = (title: string, children: React.ReactNode) => (
    <Box className="legacy-block" sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ borderBottom: 1, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );

  const entries = (kind: LegacyKind) =>
    (data?.entries ?? []).filter((e) => e.kind === kind);

  return (
    <Box className="legacy-sheet" sx={{ p: 3, maxWidth: 800 }}>
      <GlobalStyles styles={printStyles} />
      <Stack className="legacy-no-print" direction="row" gap={1} sx={{ mb: 2 }}>
        <Button onClick={() => navigate(ROUTE_PROFILE)}>
          {t('common.goBack')}
        </Button>
        <Button variant="contained" onClick={() => window.print()}>
          {t('profile.legacy.saveAsPdf')}
        </Button>
      </Stack>
      <Typography variant="h4" sx={{ mb: 1 }}>
        {t('profile.legacy.title')}
      </Typography>
      <Typography variant="body2" sx={{ mb: 3 }}>
        {t('profile.legacy.generatedOn', { date: generatedOn })}
      </Typography>

      {data && (
        <>
          {section(
            t('profile.legacy.accounts'),
            data.accounts.map((a) => {
              const entry = entries('account').find(
                (e) => e.account_id === a.account_id,
              );
              return (
                <Box key={a.account_id} className="legacy-block" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    {a.name} ({formatCurrency.invoke(a.balance)})
                  </Typography>
                  {entry && fieldLines(entry)}
                </Box>
              );
            }),
          )}
          {section(
            t('profile.legacy.policies'),
            entries('policy').map((e) => (
              <Box key={e.entry_id} className="legacy-block" sx={{ mb: 1 }}>
                {fieldLines(e)}
              </Box>
            )),
          )}
          {section(
            t('profile.legacy.loans'),
            data.debts.loans.map((l) => (
              <Typography key={l.debt_id} variant="body2">
                {l.lender}: {formatCurrency.invoke(l.outstanding_principal)} ·{' '}
                {t('profile.legacy.emi')} {formatCurrency.invoke(l.emi)} ·{' '}
                {t('profile.legacy.endsOn')} {l.end_date}
              </Typography>
            )),
          )}
          {section(
            t('profile.legacy.people'),
            data.debts.people.map((d) => (
              <Typography key={d.debt_id} variant="body2">
                {d.counterparty_name}:{' '}
                {t(
                  `profile.legacy.${d.kind === 'lent' ? 'owesYou' : 'youOwe'}`,
                )}{' '}
                {formatCurrency.invoke(d.outstanding)}
              </Typography>
            )),
          )}
          {section(
            t('profile.legacy.contacts'),
            entries('contact').map((e) => (
              <Box key={e.entry_id} className="legacy-block" sx={{ mb: 1 }}>
                {fieldLines(e)}
              </Box>
            )),
          )}
          {section(
            t('profile.legacy.instructions'),
            entries('instruction').map((e) => (
              <Box key={e.entry_id} className="legacy-block" sx={{ mb: 1 }}>
                {fieldLines(e)}
              </Box>
            )),
          )}
        </>
      )}

      <Box className="legacy-footer">
        {t('profile.legacy.generatedOn', { date: generatedOn })} ·{' '}
        {t('profile.legacy.regenerate')}
      </Box>
    </Box>
  );
};

export default LegacyPrint;
