'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocationsTableColumns } from '@/hooks/table/columns/use-locations-table-columns';
import { useLocationsTableFilters } from '@/hooks/table/filters/use-locations-table-filters';
import { useLocationsTableQuery } from '@/hooks/table/query/use-locations-table-query';
import { useLocations } from '@/lib/services/inventory';
import type { LocationDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { LocationDetailDrawer } from '../location-detail-drawer';
import { RackFormDialog } from '../rack-form-dialog';
import { ZoneFormDialog } from '../zone-form-dialog';
import { CustomBinFormDialog } from '../custom-bin-form-dialog';
import { ColumnsManagementDialog } from '../columns-management-dialog';

const PAGE_SIZE = 20;

type Props = {
  warehouseId: string;
};

export function LocationsTable({ warehouseId }: Props) {
  const { searchParams: query } = useLocationsTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useLocations(warehouseId, query);
  const filters = useLocationsTableFilters({ warehouseId });

  const [detailRow, setDetailRow] = useState<LocationDto | null>(null);
  const [rackOpen, setRackOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [customBinOpen, setCustomBinOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const columns = useLocationsTableColumns({ onDetail: setDetailRow });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <Button size="sm" variant="outline" onClick={() => setColumnsOpen(true)}>
          열 관리
        </Button>
        <Button size="sm" onClick={() => setRackOpen(true)}>
          새 랙
        </Button>
        <Button size="sm" onClick={() => setZoneOpen(true)}>
          새 구역
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setCustomBinOpen(true)}>
          커스텀 빈 추가
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '로케이션이 없습니다. 창고를 선택하거나 열/랙을 먼저 생성하세요.' }}
      />

      <LocationDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => { if (!open) setDetailRow(null); }}
      />

      <RackFormDialog open={rackOpen} onOpenChange={setRackOpen} warehouseId={warehouseId} />
      <ZoneFormDialog open={zoneOpen} onOpenChange={setZoneOpen} warehouseId={warehouseId} />
      <CustomBinFormDialog open={customBinOpen} onOpenChange={setCustomBinOpen} warehouseId={warehouseId} />
      <ColumnsManagementDialog open={columnsOpen} onOpenChange={setColumnsOpen} warehouseId={warehouseId} />
    </>
  );
}
