/** 0.123 -> '12%' */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 0.123 -> '+12%', -0.05 -> '-5%' */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function formatMonthLabel(
  year: number,
  month: number,
  language: string,
): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(language, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}
