'use client';

import { Suspense, useMemo } from 'react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductVariantsTableColumns } from '@/hooks/table/columns/use-product-variants-table-columns';
import { useVariantsByMasterSuspense } from '@/lib/services/products/queries';

const PAGE_SIZE = 100;

function ProductDetailVariantsContent({ masterId }: { masterId: string }) {
  const { data } = useVariantsByMasterSuspense(masterId, PAGE_SIZE);
  const columns = useProductVariantsTableColumns();

  // 서버 정렬 미지원 — client 에서 displayOrder asc, tie-breaker createdAt asc.
  const rows = useMemo(() => {
    return [...data.data].sort((a, b) => {
      const ao = a.displayOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.displayOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [data.data]);

  const { table } = useDataTable({
    data: rows,
    columns,
    count: rows.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      count={rows.length}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '품목이 없습니다.' }}
    />
  );
}

export function ProductDetailVariants({ masterId }: { masterId: string }) {
  return (
    <Container>
      <Header title="품목 (Variants)" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailVariantsContent masterId={masterId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
