import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_MS = 2000;

export function useSaveToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: string) => {
    clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, show };
}

export function SaveToast({
  message,
  station = false,
}: {
  message: string | null;
  station?: boolean;
}) {
  if (!message) {
    return null;
  }

  return (
    <div
      role="status"
      className={`pointer-events-none fixed ${station ? 'top-16' : 'top-4'} left-1/2 z-50 -translate-x-1/2 rounded-xl border border-gray-200 bg-gray-800 px-4 py-2 text-sm font-medium text-white shadow-lg`}
    >
      {message}
    </div>
  );
}
