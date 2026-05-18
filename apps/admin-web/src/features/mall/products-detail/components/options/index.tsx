'use client';

import { Suspense } from 'react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';

type Props = { masterId: string; versionId: string | null };

function ProductDetailOptionsContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const groups = data.optionGroups;

  if (groups.length === 0) {
    return <div className="p-3 text-sm text-gray-500">옵션 없음</div>;
  }

  return (
    <div className="divide-y">
      {groups.map((group) => (
        <div key={group.id} className="grid grid-cols-2 p-3">
          <div className="text-sm font-medium text-gray-500">
            {group.displayName}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.values.map((v) => (
              <Badge key={v.id} variant="outline">
                {v.displayName}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductDetailOptions({ masterId, versionId }: Props) {
  return (
    <Container>
      <Header title="옵션" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailOptionsContent masterId={masterId} versionId={versionId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
