/** @format */

import { cn } from '@/lib/utils/cn';
import { FieldErrors } from 'react-hook-form';

interface FormErrorMessageProps<T extends Record<string, any>> {
  errors: FieldErrors<T>;
  errorFields?: (keyof T)[];
  className?: string;
}

export default function FormErrorMessage<T extends Record<string, any>>({
  errors,
  errorFields,
  className,
}: FormErrorMessageProps<T>) {
  if (!errorFields || errorFields.length === 0) return null;

  const errorMessage = errorFields.reduce<string | null>((acc, field) => {
    if (acc) return acc;
    const error = errors[field];
    return error?.message?.toString() ?? null;
  }, null);

  if (!errorMessage) return null;

  return (
    <p className={cn('text-sm text-red-600 text-center ', className)}>
      {errorMessage}
    </p>
  );
}
