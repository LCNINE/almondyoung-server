'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { LocationsTable } from '../components/table';
import { WarehouseSelect } from '../components/warehouse-select';

export default function LocationsTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const warehouseId = searchParams.get('warehouseId') ?? '';

  const handleWarehouseChange = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('warehouseId', id);
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container className="divide-y-0">
      <div className="flex items-start justify-between">
        <Header
          title="로케이션 관리"
          subtitle="창고 내 위치(열/랙/구역)를 등록하고 관리합니다."
        />
        <div className="shrink-0 px-6 pt-5">
          <WarehouseSelect value={warehouseId} onValueChange={handleWarehouseChange} />
        </div>
      </div>
      {warehouseId ? (
        <LocationsTable warehouseId={warehouseId} />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          창고를 선택해 주세요.
        </p>
      )}
    </Container>
  );
}
