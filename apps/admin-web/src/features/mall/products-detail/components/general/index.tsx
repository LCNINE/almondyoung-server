'use client';

import { Suspense } from 'react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

function formatBool(v: boolean | null): string {
  if (v === null) return '-';
  return v ? '예' : '아니오';
}

function formatStatus(s: string | null): string {
  if (!s) return '-';
  return STATUS_LABELS[s] ?? s;
}

type Props = { masterId: string; versionId: string | null };

function ProductDetailGeneralContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);

  const rows: { key: string; value: string }[] = [
    { key: '이름', value: data.name },
    { key: '브랜드', value: data.brand ?? '-' },
    { key: '상태', value: formatStatus(data.status) },
    { key: '도매 전용', value: formatBool(data.isWholesaleOnly) },
    { key: '멤버십 전용', value: formatBool(data.isMembershipOnly) },
    { key: 'SEO 제목', value: data.seoTitle ?? '-' },
    { key: '등록일', value: data.createdAt },
    { key: '수정일', value: data.updatedAt },
  ];

  return (
    <div className="divide-y">
      {rows.map(({ key, value }) => (
        <div key={key} className="grid grid-cols-2 p-3">
          <div className="text-sm font-medium text-gray-500">{key}</div>
          <div className="text-sm">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function ProductDetailGeneral({ masterId, versionId }: Props) {
  return (
    <Container>
      <Header title="기본 정보" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailGeneralContent masterId={masterId} versionId={versionId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
