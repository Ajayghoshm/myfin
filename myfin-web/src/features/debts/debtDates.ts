import dayjs, { Dayjs } from 'dayjs';

/** Noon of the picked day, so the date survives any time-zone shift. */
export const toEpoch = (d: Dayjs | null): number | null =>
  d === null || !d.isValid() ? null : d.startOf('day').add(12, 'hour').unix();

export const fromEpoch = (epoch: number | null | undefined): Dayjs | null =>
  epoch == null ? null : dayjs.unix(epoch);

export const formatDay = (epoch: number) =>
  dayjs.unix(epoch).format('DD/MM/YYYY');

/** "PAID TO RAHUL" → "RAHUL": the person behind a UPI description. */
export const personFromDescription = (description: string | undefined) =>
  (description ?? '')
    .trim()
    .replace(/^(paid to|received from|requested by|payment to)\s+/i, '');
