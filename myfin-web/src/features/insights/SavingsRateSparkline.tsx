import { useTheme } from '@mui/material';

type Props = { values: (number | null)[]; color: string; label: string };

const W = 160;
const H = 40;
const PAD = 4;

/** Small inline line chart; null values break the line (gaps). */
const SavingsRateSparkline = ({ values, color, label }: Props) => {
  const theme = useTheme();
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 0);
  const span = max - min || 1;
  const x = (i: number) =>
    values.length > 1 ? PAD + (i * (W - 2 * PAD)) / (values.length - 1) : W / 2;
  const y = (v: number) => PAD + ((max - v) * (H - 2 * PAD)) / span;

  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push([x(i), y(v)]);
    }
  });
  if (current.length) segments.push(current);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
    >
      <line
        x1={PAD}
        x2={W - PAD}
        y1={y(0)}
        y2={y(0)}
        stroke={theme.palette.divider}
        strokeDasharray="2 2"
      />
      {segments.map((seg) =>
        seg.length === 1 ? (
          <circle
            key={`${seg[0][0]}`}
            cx={seg[0][0]}
            cy={seg[0][1]}
            r={2}
            fill={color}
          />
        ) : (
          <polyline
            key={`${seg[0][0]}`}
            points={seg.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
};

export default SavingsRateSparkline;
