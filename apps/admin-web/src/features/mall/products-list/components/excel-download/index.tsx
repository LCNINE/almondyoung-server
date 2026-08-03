'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileDown } from 'lucide-react';
import { products } from '@/lib/api/domains';
import { downloadBlob } from '@/lib/utils/download-blob';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  exportFileName,
  sanitizeKeys,
  toExportFilters,
  toggleKey,
  type ExportScope,
} from './excel-download-model';

type Props = {
  selectedIds: string[];
  /** 검색결과 전체 건수 — 모달에서 몇 건을 받는지 보여준다. */
  totalCount: number;
};

export function ExcelDownloadMenu({ selectedIds, totalCount }: Props) {
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<ExportScope | null>(null);
  const [columnKeys, setColumnKeys] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  const { data: catalog, isLoading } = useQuery({
    queryKey: ['products', 'export-columns'],
    queryFn: () => products.masters.getExportColumns(),
    staleTime: 60 * 60 * 1000,
  });

  const availableKeys = useMemo(
    () => (catalog?.columns ?? []).map((c) => c.key),
    [catalog?.columns]
  );

  // 모달을 열 때마다 기본 양식으로 되돌린다 — 3단계에서 저장된 양식으로 바뀐다.
  useEffect(() => {
    if (scope && catalog) {
      setColumnKeys(sanitizeKeys(catalog.defaultKeys, availableKeys));
    }
  }, [scope, catalog, availableKeys]);

  const rowCount = scope === 'selected' ? selectedIds.length : totalCount;

  const orderedLabels = useMemo(() => {
    const labelByKey = new Map(
      (catalog?.columns ?? []).map((c) => [c.key, c.label])
    );
    return columnKeys
      .map((k) => labelByKey.get(k))
      .filter((l): l is string => l !== undefined);
  }, [columnKeys, catalog?.columns]);

  async function handleDownload() {
    if (!scope) return;
    setDownloading(true);
    try {
      const blob = await products.masters.exportExcel({
        columns: columnKeys,
        ...(scope === 'selected'
          ? { ids: selectedIds }
          : { filters: toExportFilters(searchParams) }),
      });
      downloadBlob(blob, exportFileName(scope, new Date()));
      toast.success('엑셀 파일이 다운로드되었습니다.');
      setScope(null);
    } catch (error) {
      // 5만건 상한 등 서버 메시지를 그대로 보여준다 — 원인을 알려줘야 필터를 좁힐 수 있다.
      toast.error(await readErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Download className="w-3 h-3 mr-1" />
            엑셀 다운로드
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setScope('filtered')}>
            <FileDown className="w-4 h-4 mr-2" />
            검색결과 전체 다운로드
            <span className="ml-1 text-xs text-muted-foreground">
              {totalCount.toLocaleString()}건
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={selectedIds.length === 0}
            onClick={() => setScope('selected')}
          >
            <FileDown className="w-4 h-4 mr-2" />
            선택항목 다운로드
            <span className="ml-1 text-xs text-muted-foreground">
              {selectedIds.length.toLocaleString()}건
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={scope !== null} onOpenChange={(o) => !o && setScope(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>엑셀 다운로드</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {scope === 'selected' ? '선택한' : '검색 조건에 맞는'} 상품{' '}
              <strong>{rowCount.toLocaleString()}건</strong>을 내보냅니다.
            </p>

            {/* 열 순서는 체크 순서라 아래 목록(카탈로그 순서)과 다르다.
                줄마다 번호를 달면 두 순서가 어긋나 보이므로 여기 한 줄로 모아 보여준다. */}
            <div className="p-2 text-xs border rounded-md bg-muted/40">
              <span className="text-muted-foreground">열 순서 </span>
              {orderedLabels.length === 0 ? (
                <span className="text-muted-foreground">
                  항목을 하나 이상 선택하세요.
                </span>
              ) : (
                orderedLabels.map((label, i) => (
                  <span key={label}>
                    {i > 0 && <span className="text-muted-foreground"> › </span>}
                    {label}
                  </span>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setColumnKeys(
                    sanitizeKeys(catalog?.defaultKeys ?? [], availableKeys)
                  )
                }
              >
                기본 양식
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setColumnKeys(availableKeys)}
              >
                전체 항목
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setColumnKeys([])}
              >
                전체 해제
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {columnKeys.length} / {availableKeys.length} 항목
              </span>
            </div>

            <ScrollArea className="h-64 border rounded-md">
              <div className="p-3 space-y-2">
                {isLoading && (
                  <p className="text-sm text-muted-foreground">
                    항목을 불러오는 중…
                  </p>
                )}
                {(catalog?.columns ?? []).map((column) => (
                  <Label
                    key={column.key}
                    className="flex items-center gap-2 font-normal cursor-pointer"
                  >
                    <Checkbox
                      checked={columnKeys.includes(column.key)}
                      onCheckedChange={() =>
                        setColumnKeys((prev) => toggleKey(prev, column.key))
                      }
                    />
                    {column.label}
                  </Label>
                ))}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScope(null)}>
              취소
            </Button>
            <Button
              onClick={handleDownload}
              disabled={downloading || columnKeys.length === 0}
            >
              {downloading ? '만드는 중…' : '다운로드'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * responseType:'blob' 이면 에러 본문도 Blob 으로 와서 message 를 못 읽는다.
 * 상한 초과 같은 서버 안내를 버리지 않도록 Blob 을 풀어 본다.
 */
async function readErrorMessage(error: unknown): Promise<string> {
  const fallback = '엑셀 다운로드 중 오류가 발생했습니다.';
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (!data) return fallback;
  try {
    const text = data instanceof Blob ? await data.text() : JSON.stringify(data);
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? fallback;
  } catch {
    return fallback;
  }
}
