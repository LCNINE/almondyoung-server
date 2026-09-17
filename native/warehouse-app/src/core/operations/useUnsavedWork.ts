import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

/** Keep unsaved manual input visible until it is saved or explicitly discarded. */
export function useUnsavedWork(pending: boolean) {
  const router = useRouter({ warn: false });
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    const unblock = router?.history.block({
      blockerFn: () => true,
      enableBeforeUnload: true,
    });
    return () => {
      window.removeEventListener('beforeunload', guard);
      unblock?.();
    };
  }, [router, pending]);
}
