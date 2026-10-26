import Link from '@mui/material/Link';
import { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

type Props = {
  to: string | null;
  children: ReactNode;
  color?: string;
};

/** A figure that drills down to its transactions; plain text when `to` is null. */
const FigureLink = ({ to, children, color }: Props) => {
  if (to == null) return <>{children}</>;
  return (
    <Link
      component={RouterLink}
      to={to}
      underline="hover"
      color={color ?? 'inherit'}
    >
      {children}
    </Link>
  );
};

export default FigureLink;
