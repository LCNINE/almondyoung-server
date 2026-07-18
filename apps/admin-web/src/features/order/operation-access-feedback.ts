import { createElement, type ReactNode } from 'react';
import { getServerDenyMessage } from '../../lib/api/server-error';

export function PermissionAction({
  allowed,
  children,
}: {
  allowed: boolean;
  children?: ReactNode;
}) {
  return allowed ? children : null;
}

export function ServerDenyFeedback({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;
  return createElement(
    'p',
    { role: 'alert', className: 'text-destructive' },
    getServerDenyMessage(error, fallback)
  );
}
