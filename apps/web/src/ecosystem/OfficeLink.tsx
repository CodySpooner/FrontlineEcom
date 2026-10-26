import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function OfficeLink({ to, onPreview, children, className }: { to: string; onPreview?: () => void; children: ReactNode; className?: string }) {
  return onPreview ? <button type="button" className={className} onClick={onPreview}>{children}</button> : <Link to={to} className={className}>{children}</Link>;
}
