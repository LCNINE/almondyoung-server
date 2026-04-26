'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useReservationsTableColumns } from '@/hooks/table/columns/use-reservations-table-columns';
import type { ReservationDto } from '@/lib/types/dto/inventory';
import { ReleaseReservationDialog } from '../release-reservation-dialog';

const PAGE_SIZE = 20;

type Props = {
  data: ReservationDto[];
  isLoading: boolean;
};

export function ReservationsTable({ data, isLoading }: Props) {
  const [releaseRow, setReleaseRow] = useState<ReservationDto | null>(null);

  const columns = useReservationsTableColumns({ onRelease: setReleaseRow });

  const { table } = useDataTable({
    data,
    columns,
    count: data.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        count={data.length}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '예약 데이터가 없습니다.' }}
      />

      <ReleaseReservationDialog
        row={releaseRow}
        open={!!releaseRow}
        onOpenChange={(open) => { if (!open) setReleaseRow(null); }}
      />
    </>
  );
}
