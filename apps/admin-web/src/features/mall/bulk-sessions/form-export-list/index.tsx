'use client';

import { useMemo } from 'react';
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
import { useFormExportList, useRetryFormExport } from '@/lib/services/products/form-export';
import { formExportRowState } from '@/lib/services/products/form-export-model';
import type { FormExportSummary } from '@/lib/types/dto/form-export';
import { downloadBlob } from '@/lib/utils/download-blob';

const PAGE_SIZE = 20;

const TONE_VARIANT = {
  pending: 'secondary',
  progress: 'default',
  error: 'destructive',
  done: 'outline',
} as const;

function ActionCell({ item }: { item: FormExportSummary }) {
  const retry = useRetryFormExport();
  const state = formExportRowState(item);

  if (state.action === 'download') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const { url } = await products.formExport.getDownloadUrl(item.exportId);
            window.location.href = url;
          } catch (error) {
            const parsed = parseServerError(error, '다운로드 링크를 가져오지 못했습니다.');
            toast.error(
              parsed.conflict
                ? '아직 파일 생성이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.'
                : parsed.message
            );
          }
        }}
      >
        다운로드
      </Button>
    );
  }

  if (state.action === 'retry') {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={retry.isPending}
        onClick={() =>
          retry.mutate(item.exportId, {
            onSuccess: (res) =>
              toast.success(
                res.reused
                  ? '이미 진행 중인 요청이 있어 그것으로 이어집니다.'
                  : '양식 생성을 다시 접수했습니다.'
              ),
            onError: (error) =>
              toast.error(parseServerError(error, '재시도에 실패했습니다.').message),
          })
        }
      >
        다시 시도
      </Button>
    );
  }

  return null;
}

const columnHelper = createColumnHelper<FormExportSummary>();

const columns = [
  columnHelper.accessor('createdAt', {
    header: '요청일',
    cell: ({ getValue }) => <DateCell value={getValue()} withTime />,
  }),
  columnHelper.display({
    id: 'productCount',
    header: '상품 수',
    cell: ({ row }) => {
      const item = row.original;
      return (
        <span className="text-sm text-muted-foreground">
          {item.productCount} / {item.requestedCount}
        </span>
      );
    },
  }),
  columnHelper.display({
    id: 'status',
    header: '상태',
    cell: ({ row }) => {
      const item = row.original;
      const state = formExportRowState(item);
      return (
        <div className="flex flex-col gap-1">
          <Badge variant={TONE_VARIANT[state.tone]}>{state.label}</Badge>
          {state.tone === 'error' && item.errorMessage && (
            <span className="text-xs text-destructive">{item.errorMessage}</span>
          )}
        </div>
      );
    },
  }),
  columnHelper.accessor('expiresAt', {
    header: '다운로드 만료',
    cell: ({ getValue }) => <DateCell value={getValue()} withTime />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: ({ row }) => <ActionCell item={row.original} />,
  }),
];

export default function FormExportListTemplate() {
  const { page: pageParam } = useQueryParams(['page']);
  const page = pageParam ? Number(pageParam) : 1;

  const { data, isLoading, isFetching, isError, error } = useFormExportList(page, PAGE_SIZE);

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.exportId,
  });

  // RouteGuard 가 클라이언트 롤 클레임을 먼저 걸러내지만, 서버 토큰의 roles 클레임이
  // 그 판정과 어긋나면(배포 선행조건인 MD 계정 롤 실측이 안 됐을 때) 가드를 통과한
  // 뒤 조회가 403 으로 거부된다. 빈 화면 대신 원인을 그대로 알려준다.
  const forbidden = useMemo(
    () => isError && parseServerError(error).status === 403,
    [isError, error]
  );

  async function handleBlankForm() {
    try {
      const blob = await products.formExport.downloadBlank();
      downloadBlob(blob, '상품일괄등록_빈양식.xlsx');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '빈 양식을 내려받지 못했습니다.';
      toast.error(message);
    }
  }

  return (
    <Container>
      <Header
        title="양식 생성 잡"
        subtitle="선택한 상품을 프리필한 엑셀 양식을 생성합니다. 생성에는 수 분이 걸릴 수 있습니다."
        right={
          <Button variant="outline" onClick={() => void handleBlankForm()}>
            빈 양식 다운로드
          </Button>
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
          noRecords={{
            message: '아직 생성된 양식이 없습니다. 상품 목록에서 프리필 양식을 요청해 주세요.',
          }}
        />
      )}
    </Container>
  );
}
