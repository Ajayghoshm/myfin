import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Category } from '../../services/category/categoryServices.ts';
import {
  useApplyRules,
  useRuleApplyPreview,
} from '../../services/rule/ruleHooks.tsx';
import { convertUnixTimestampToDateString } from '../../utils/dateUtils.ts';
import { formatNumberAsCurrency } from '../../utils/textUtils.ts';
import { selectedIds } from './ruleApplySelection.ts';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
};

const ApplyRulesDialog = (props: Props) => {
  const { t } = useTranslation();

  const previewRequest = useRuleApplyPreview(props.isOpen);
  const applyRequest = useApplyRules();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const changes = previewRequest.data?.changes ?? [];
  const ids = selectedIds(changes, excluded);
  const result = applyRequest.data;

  // The API returns ids; names come from the categories already loaded
  const categoryNames = useMemo(
    () =>
      new Map(
        props.categories.map((cat) => [String(cat.category_id), cat.name]),
      ),
    [props.categories],
  );
  const categoryName = (id: string | null) =>
    id == null ? '-' : (categoryNames.get(String(id)) ?? '-');

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog fullWidth maxWidth="lg" open={props.isOpen} onClose={props.onClose}>
      <DialogTitle>{t('rules.applyTitle')}</DialogTitle>
      <DialogContent>
        {previewRequest.isPending && <CircularProgress />}
        {previewRequest.isError && (
          <Alert severity="error">{t('common.somethingWentWrongTryAgain')}</Alert>
        )}
        {applyRequest.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('common.somethingWentWrongTryAgain')}
          </Alert>
        )}
        {result && (
          <Alert severity="success">
            {t('rules.applyResult', {
              updated: result.updated,
              skipped: result.skipped,
            })}
          </Alert>
        )}
        {!result && previewRequest.data && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t('rules.applyDescription')}
            </Typography>
            {previewRequest.data.truncated && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('rules.applyTruncated')}
              </Alert>
            )}
            {changes.length === 0 ? (
              <Typography>{t('rules.applyEmpty')}</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('rules.applyExclude')}</TableCell>
                    <TableCell>{t('common.date')}</TableCell>
                    <TableCell>{t('common.description')}</TableCell>
                    <TableCell align="right">{t('common.amount')}</TableCell>
                    <TableCell>{t('rules.applyCurrentCategory')}</TableCell>
                    <TableCell>{t('rules.applyNewCategory')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {changes.map((change) => (
                    <TableRow key={change.transaction_id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={excluded.has(change.transaction_id)}
                          onChange={() => toggle(change.transaction_id)}
                          slotProps={{
                            input: { 'aria-label': t('rules.applyExclude') },
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {convertUnixTimestampToDateString(change.date)}
                      </TableCell>
                      <TableCell>{change.description}</TableCell>
                      <TableCell align="right">
                        {formatNumberAsCurrency(change.amount)}
                      </TableCell>
                      <TableCell>
                        {categoryName(change.current_category_id)}
                      </TableCell>
                      <TableCell>
                        {categoryName(change.new_category_id)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ pr: 3 }}>
        <Button variant="outlined" onClick={props.onClose}>
          {t('common.close')}
        </Button>
        {!result && changes.length > 0 && (
          <Button
            variant="contained"
            disabled={ids.length === 0 || applyRequest.isPending}
            onClick={() => applyRequest.mutate(ids)}
          >
            {t('rules.applyConfirm', { count: ids.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ApplyRulesDialog;
