import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
  busy?: boolean | undefined;
  busyLabel?: string | undefined;
}
export function Button({ variant = 'secondary', busy = false, busyLabel = '処理中…',
  disabled, className = '', children, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`td-btn td-btn-${variant}${busy ? ' td-btn-busy' : ''} ${className}`}
    disabled={disabled || busy} aria-busy={busy}>{busy ? busyLabel : children}</button>;
}
