import { Delete } from '@mui/icons-material';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrxServices, {
  ShareDevice,
  SharePairingCode,
} from '../../../services/trx/trxServices.ts';

type Props = { open: boolean; onClose: () => void };

const PairPhoneDialog = ({ open, onClose }: Props) => {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState<SharePairingCode | null>(null);
  const [devices, setDevices] = useState<ShareDevice[]>([]);

  const loadDevices = useCallback(() => {
    TrxServices.listShareDevices()
      .then((res) => setDevices(res.data))
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    TrxServices.createSharePairingCode()
      .then((res) => setPairing(res.data))
      .catch(() => setPairing(null));
    loadDevices();
  }, [open, loadDevices]);

  const removeDevice = async (id: string) => {
    await TrxServices.deleteShareDevice(id).catch(() => undefined);
    loadDevices();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t('importTransactions.pairPhone')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          {t('importTransactions.pairPhoneText')}
        </Typography>
        {pairing && (
          <Box sx={{ textAlign: 'center', my: 2 }}>
            <QRCodeSVG value={pairing.url} size={200} />
            <Typography variant="h4" sx={{ letterSpacing: 6, mt: 1 }}>
              {pairing.code}
            </Typography>
          </Box>
        )}
        {devices.length > 0 && (
          <>
            <Typography variant="subtitle2">
              {t('importTransactions.pairedPhones')}
            </Typography>
            {devices.map((d) => (
              <Box
                key={d.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Typography sx={{ flexGrow: 1 }}>
                  {d.name} · {new Date(d.created_at).toLocaleDateString()}
                </Typography>
                <IconButton
                  aria-label={t('common.delete')}
                  onClick={() => void removeDevice(d.id)}
                >
                  <Delete />
                </IconButton>
              </Box>
            ))}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PairPhoneDialog;
