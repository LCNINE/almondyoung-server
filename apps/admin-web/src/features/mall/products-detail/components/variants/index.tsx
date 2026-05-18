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
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import type { ProductVariantRow } from '@/lib/services/products/products-detail.types';

const PAGE_SIZE = 100;

type Props = { masterId: string; versionId: string | null };

function VariantsTable({
  rows,
  optionGroups,
}: {
  rows: ProductVariantRow[];
  optionGroups: ReturnType<typeof useProductDetailSuspense>['data']['optionGroups'];
}) {
  const columns = useProductVariantsTableColumns(optionGroups);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ao = a.displayOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.displayOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [rows]);

  const { table } = useDataTable({
    data: sorted,
    columns,
    count: sorted.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      count={sorted.length}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '품목이 없습니다.' }}
    />
  );
}

function VariantsFromMaster({ masterId }: { masterId: string }) {
  const { data: detail } = useProductDetailSuspense(masterId, null);
  const { data: variants } = useVariantsByMasterSuspense(masterId, PAGE_SIZE);
  return <VariantsTable rows={variants.data} optionGroups={detail.optionGroups} />;
}

function VariantsFromVersion({ masterId, versionId }: { masterId: string; versionId: string }) {
  const { data: detail } = useProductDetailSuspense(masterId, versionId);
  const rows = detail.variantsInline ?? [];
  return <VariantsTable rows={rows} optionGroups={detail.optionGroups} />;
}

function ProductDetailVariantsContent({ masterId, versionId }: Props) {
  if (versionId) {
    return <VariantsFromVersion masterId={masterId} versionId={versionId} />;
  }
  return <VariantsFromMaster masterId={masterId} />;
}

export function ProductDetailVariants({ masterId, versionId }: Props) {
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
          <ProductDetailVariantsContent masterId={masterId} versionId={versionId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
