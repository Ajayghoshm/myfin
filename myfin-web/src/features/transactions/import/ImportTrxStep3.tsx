import { KeyboardDoubleArrowRight } from '@mui/icons-material';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import Typography from '@mui/material/Typography';
import { Alert, Box, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ROUTE_TRX } from '../../../providers/RoutesProvider.tsx';
import { SkippedFlag } from './importFlags.ts';

const MAX_LISTED_FLAGS = 20;

export type Props = {
  nrOfTrxImported: number;
  accountName: string;
  skippedFlags: SkippedFlag[];
  flagsRequestFailed: boolean;
};

const ImportTrxStep3 = (props: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const flagLabel = (flag: SkippedFlag['flag']) =>
    t(flag === 'loan' ? 'transactions.flags.loan' : 'transactions.flags.event');

  const goToTransactions = () => {
    navigate(ROUTE_TRX);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        mt: theme.spacing(8),
      }}
    >
      <Typography variant="h5" component="div" sx={{ mb: theme.spacing(2) }}>
        {t('importTransactions.step3Label')}
      </Typography>
      <Typography variant="body1" component="div">
        {props.accountName
          ? t('importTransactions.step3Text', {
              count: props.nrOfTrxImported,
              accountName: props.accountName,
            })
          : t('importTransactions.step3TextMulti', {
              count: props.nrOfTrxImported,
            })}
      </Typography>
      {props.flagsRequestFailed && (
        <Alert severity="warning" sx={{ mt: theme.spacing(2) }}>
          {t('importTransactions.step3FlagsRequestFailed')}
        </Alert>
      )}
      {props.skippedFlags.length > 0 && (
        <Alert severity="warning" sx={{ mt: theme.spacing(2) }}>
          <Typography variant="body2" component="div">
            {t('importTransactions.step3FlagsSkipped', {
              count: props.skippedFlags.length,
            })}
          </Typography>
          <ul>
            {props.skippedFlags.slice(0, MAX_LISTED_FLAGS).map((item, i) => (
              <li key={i}>
                {item.description
                  ? `${item.description} (${flagLabel(item.flag)}): ${item.message}`
                  : `${flagLabel(item.flag)}: ${item.message}`}
              </li>
            ))}
          </ul>
          {props.skippedFlags.length > MAX_LISTED_FLAGS && (
            <Typography variant="body2" component="div">
              {t('importTransactions.step3FlagsMore', {
                count: props.skippedFlags.length - MAX_LISTED_FLAGS,
              })}
            </Typography>
          )}
        </Alert>
      )}
      <Button
        variant="contained"
        color="primary"
        endIcon={<KeyboardDoubleArrowRight />}
        onClick={() => goToTransactions()}
        sx={{ width: 'fit-content', mt: theme.spacing(2) }}
      >
        {t('dashboard.seeTransactions')}
      </Button>
    </Box>
  );
};

export default ImportTrxStep3;
