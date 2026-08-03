'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { products } from '@/lib/api/domains';
import { parseServerError } from '@/lib/api/server-error';
import {
  isFormExportRunning,
  useFormExportStatus,
  useRequestFormExport,
} from '@/lib/services/products/form-export';
import {
  initialFormExportRequestGuard,
  isCurrentFormExportRequest,
  nextFormExportRequestId,
  type FormExportRequestGuardState,
} from './request-guard';

interface Props {
  open: boolean;
  masterIds: string[];
  onClose: () => void;
}

export function FormExportModal({ open, masterIds, onClose }: Props) {
  const [exportId, setExportId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const request = useRequestFormExport();
  const { data } = useFormExportStatus(exportId);

  // useMutation 이 돌려주는 객체는 렌더마다 새 참조다. 그대로 의존성에 넣으면 effect 가
  // 매 렌더 돌아 접수 요청이 무한히 나간다. ref 로 최신 mutate 만 들고, effect 는
  // '열림 전환' 한 번에만 반응하게 한다.
  const requestRef = useRef(request);
  requestRef.current = request;
  const startedRef = useRef(false);

  // 닫기는 진행 중인 POST 를 취소하지 않는다 — 닫았다 바로 다시 열거나(또는 재시도)
  // 하면 이전 요청이 서버에서 여전히 처리 중일 수 있고, 응답은 도착 순서를 보장하지
  // 않는다. requestId 로 "이 응답이 여전히 최신 요청의 것인가"를 확인해, 버려진 요청의
  // 늦은 응답이 setExportId 를 stale 값으로 덮어쓰거나 이미 성공한 뒤에 실패 토스트를
  // 띄우는 것을 막는다(request-guard.ts, request-guard.spec.ts).
  const guardRef = useRef<FormExportRequestGuardState>(
    initialFormExportRequestGuard
  );

  function fire() {
    startedRef.current = true;
    const { guard, requestId } = nextFormExportRequestId(guardRef.current);
    guardRef.current = guard;
    requestRef.current.mutate(masterIds, {
      onSuccess: (res) => {
        if (!isCurrentFormExportRequest(guardRef.current, requestId)) return;
        setExportId(res.exportId);
      },
      onError: () => {
        if (!isCurrentFormExportRequest(guardRef.current, requestId)) return;
        toast.error('양식 생성 요청에 실패했습니다.');
      },
    });
  }

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      // 진행 중이던 요청을 전부 무효화한다 — 그 뒤 도착하는 응답은 반영되지 않는다.
      guardRef.current = nextFormExportRequestId(guardRef.current).guard;
      setExportId(null);
      return;
    }
    if (startedRef.current) return;
    fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire()는 ref로 최신 mutate만 참조한다
  }, [open, masterIds]);

  if (!open) return null;

  const running = isFormExportRunning(data?.status);

  async function handleDownload() {
    if (!exportId) return;
    setDownloading(true);
    try {
      const { url } = await products.formExport.getDownloadUrl(exportId);
      window.location.href = url;
    } catch (error) {
      const parsed = parseServerError(
        error,
        '다운로드 링크를 가져오지 못했습니다.'
      );
      toast.error(
        parsed.conflict
          ? '아직 파일 생성이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.'
          : parsed.message
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleRetry() {
    fire();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            양식 생성
            {running && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <p className="text-muted-foreground">
            선택된 <strong>{masterIds.length}개</strong> 상품의 정보를 미리 채운
            등록 양식을 만듭니다.
          </p>

          {request.isError && !exportId && (
            <div className="space-y-2">
              <p className="text-destructive" role="alert">
                양식 생성 요청에 실패했습니다.
              </p>
              <Button size="sm" variant="outline" onClick={handleRetry}>
                다시 시도
              </Button>
            </div>
          )}

          {!request.isError && !data && (
            <p className="text-muted-foreground">
              양식 생성을 접수하는 중입니다…
            </p>
          )}
          {data?.status === 'queued' && (
            <p className="text-muted-foreground">
              대기 중입니다. 잠시만 기다려 주세요.
            </p>
          )}
          {data?.status === 'running' && (
            <p className="text-muted-foreground">
              상품 데이터를 모으는 중입니다…
            </p>
          )}
          {data?.status === 'failed' && (
            <p className="text-destructive" role="alert">
              양식 생성에 실패했습니다
              {data.errorMessage ? `: ${data.errorMessage}` : ''}
            </p>
          )}
          {data?.status === 'completed' &&
            data.downloadable &&
            (data.productCount > 0 ? (
              <p>
                상품 <strong>{data.productCount}건</strong>이 담긴 양식이
                준비됐습니다.
                {data.productCount < masterIds.length && (
                  <>
                    {' '}
                    판매 중인 버전이 없는 상품{' '}
                    {masterIds.length - data.productCount}건은 제외됐습니다.
                  </>
                )}
              </p>
            ) : (
              // 선택한 상품 전부가 active 버전 없음 등으로 빠져 실제로 담긴 상품이 0건인
              // 경우다. 잡 자체는 completed·downloadable(파일은 존재)이라 위 분기로는
              // "0건이 담긴 양식이 준비됐습니다"라는 무의미한 문구가 나가므로 따로 갈라
              // 원인을 알려준다.
              <p className="text-destructive" role="alert">
                선택한 상품 중 판매 중인 버전이 있는 상품이 없어 담을 데이터가
                없습니다.
              </p>
            ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          {data?.status === 'completed' && data.downloadable && (
            <Button onClick={handleDownload} disabled={downloading}>
              {downloading ? '여는 중…' : '다운로드'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
