'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { CustomerReturnsTable } from '../components/customer-returns-table';
import type { CustomerReturnBucket } from '@/lib/types/dto/customer-returns';

/**
 * 반품·교환 관리 — 새 반품 기록(K8 PR 7) 목록. 교환도 같은 기록이다(K8 PR11b — 종류 칸으로 가른다).
 * 옛 링크의 `tab`·`status`·`createdAt` 은 읽지 않는다 — 반품 목록으로 열린다.
 */
export default function ReturnExchangeTemplate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const bucketParam = searchParams.get('bucket');
  const bucket: CustomerReturnBucket =
    bucketParam === 'attention' || bucketParam === 'closed' ? bucketParam : 'open';
  const q = searchParams.get('q') ?? '';

  return (
    <Container>
      <Header title="반품·교환 관리" />
      <div className="space-y-3">
        <CustomerReturnsTable
          bucket={bucket}
          q={q}
          onBucketChange={(next) => updateParams({ bucket: next === 'open' ? undefined : next })}
          onSearch={(next) => updateParams({ q: next || undefined })}
        />
      </div>
    </Container>
  );
}
