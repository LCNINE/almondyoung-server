'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AuthExpiredHandler() {
  const router = useRouter();

  useEffect(() => {
    const handler = () => {
      router.push('/login');
    };

    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [router]);

  return null;
}
