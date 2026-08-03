'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/data-table';
import { DateCell } from '@/components/table/table-cells/common';
import { useDataTable } from '@/hooks/use-data-table';
import { useQueryParams } from '@/hooks/use-query-params';
import { products } from '@/lib/api/domains';
import { parseServerError } from '@/lib/api/server-error';
import { useBulkSessionList } from '@/lib/services/products/bulk-session';
import type { BulkSessionSummary } from '@/lib/types/dto/bulk-session';
import { downloadBlob } from '@/lib/utils/download-blob';
import { phaseBadgeVariant, phaseLabel } from '../lib/session-labels';
import { UploadModal } from './upload-modal';

const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<BulkSessionSummary>();

const columns = [
  columnHelper.accessor('name', {
    header: '이름',
    cell: ({ getValue }) => (
      <span className="text-sm font-medium">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('fileName', {
    header: '파일명',
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('phase', {
    header: '상태',
    cell: ({ getValue }) => {
      const phase = getValue();
      return (
        <Badge variant={phaseBadgeVariant(phase)}>{phaseLabel(phase)}</Badge>
      );
    },
  }),
  columnHelper.accessor('totalRows', {
    header: '행 수',
    cell: ({ getValue }) => getValue(),
  }),
  columnHelper.accessor('createdAt', {
    header: '생성일',
    cell: ({ getValue }) => <DateCell value={getValue()} />,
  }),
];

export default function BulkSessionListTemplate() {
  const { page: pageParam } = useQueryParams(['page']);
  const page = pageParam ? Number(pageParam) : 1;

  const { data, isLoading, isFetching, isError, error } = useBulkSessionList(
    page,
    PAGE_SIZE
  );

  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  // RouteGuard 가 클라이언트 롤 클레임을 먼저 걸러내지만, 서버 토큰의 roles 클레임이
  // 그 판정과 어긋나면(배포 선행조건인 MD 계정 롤 실측이 안 됐을 때) 가드를 통과한
  // 뒤 조회가 403 으로 거부된다. 빈 화면 대신 원인을 그대로 알려준다.
  const forbidden = useMemo(
    () => isError && parseServerError(error).status === 403,
    [isError, error]
  );

  async function handleBlankForm() {
    setDownloading(true);
    try {
      const blob = await products.formExport.downloadBlank();
      downloadBlob(blob, '상품일괄등록_빈양식.xlsx');
    } catch (error) {
      // downloadBlank() 는 실패 사유를 status 코드까지 메시지에 실어 던진다
      // (form-export.client.ts) — 여기서 뭉개면 403 과 500 이 화면에서 똑같이
      // "내려받지 못했습니다"로만 보여 작업자가 원인을 구분할 수 없다.
      const message =
        error instanceof Error
          ? error.message
          : '빈 양식을 내려받지 못했습니다.';
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Container>
      <Header
        title="엑셀 일괄 등록/수정"
        subtitle="엑셀 양식을 올려 여러 상품을 한 번에 등록하거나 수정합니다."
        right={
          <>
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              양식 업로드
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleBlankForm()}
              disabled={downloading}
            >
              {downloading ? '내려받는 중…' : '빈 양식 다운로드'}
            </Button>
          </>
        }
      />

      {forbidden ? (
        <p role="alert" className="px-6 pb-6 text-sm text-destructive">
          이 기능은 admin·master 권한이 필요합니다.
        </p>
      ) : (
        <DataTable
          table={table}
          isLoading={isLoading}
          isFetching={isFetching}
          count={data?.total ?? 0}
          pageSize={PAGE_SIZE}
          navigateTo={(row) => `/mall/bulk-sessions/${row.original.id}`}
          noRecords={{
            message:
              '아직 세션이 없습니다. 상품 목록에서 양식을 받아 작성한 뒤 올리거나, 빈 양식으로 신규 상품만 등록할 수 있습니다.',
          }}
        />
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </Container>
  );
}
