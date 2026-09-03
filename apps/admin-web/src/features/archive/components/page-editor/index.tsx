'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 편집기는 무겁고 브라우저 API 에 붙어 있어 서버에서 그릴 수 없다.
 * 아카이브 화면에서만 내려받게 잘라 두면 다른 관리자 화면 번들은 그대로다.
 */
export const PageEditor = dynamic(() => import('./block-editor'), {
  ssr: false,
  loading: () => (
    <div className="space-y-3 py-4" aria-hidden>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-5/6" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  ),
});
