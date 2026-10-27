/** 'YYYY-MM' to a localized "November 2026". */
export const monthLabel = (month: string, language: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(language, {
    month: 'long',
    year: 'numeric',
  });
};
