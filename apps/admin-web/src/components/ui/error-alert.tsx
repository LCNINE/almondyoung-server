// src/components/ui/error-alert.tsx
import React from 'react';
import { Alert, AlertDescription } from './alert';

interface ErrorAlertProps {
  message: string;
  className?: string;
}

export function ErrorAlert({ message, className = '' }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>
        {message}
      </AlertDescription>
    </Alert>
  );
}
