'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Download } from 'lucide-react';
import {
  useForwardDirectShipOrders,
  useCompleteDirectShipOrders,
  useExportDirectShipFile,
  orderQueryKeys,
} from '@/lib/services/orders';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { data?: { message?: string | string[] } } };
    const msg = axiosErr.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

export function DirectShipTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const queryClient = useQueryClient();

  if (fo.fulfillmentMode !== 'drop_ship') {
    return (
      <div className="flex flex-col gap-3 py-4">
        <Alert>
          <AlertTriangle />
          <AlertDescription>
            이 FO는 직배(drop_ship) 모드가 아닙니다. 직배 액션은 fulfillmentMode=drop_ship인 FO에만 노출됩니다.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <DirectShipContent fo={fo} queryClient={queryClient} />;
}

function DirectShipContent({
  fo,
  queryClient,
}: {
  fo: FulfillmentOrderDetail;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const canForward = fo.adminAvailableActions.includes('forwardDropShip');
  const canComplete = fo.adminAvailableActions.includes('completeDropShip');

  const [forwardCompanyName, setForwardCompanyName] = useState('');
  const [exportCompanyName, setExportCompanyName] = useState('');
  const [completedBy, setCompletedBy] = useState('');

  const forward = useForwardDirectShipOrders();
  const complete = useCompleteDirectShipOrders();
  const exportFile = useExportDirectShipFile();

  const handleForward = async () => {
    if (!forwardCompanyName.trim()) {
      toast.error('공급사 이름을 입력하세요.');
      return;
    }
    try {
      await forward.mutateAsync({
        fulfillmentOrderIds: [fo.id],
        companyName: forwardCompanyName.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(fo.id) });
      toast.success('공급사 전달 완료 처리되었습니다.');
    } catch (err) {
      toast.error(`공급사 전달 실패: ${extractErrorMessage(err)}`);
    }
  };

  const handleExport = async () => {
    const name = exportCompanyName.trim();
    if (!name) {
      toast.error('공급사 이름을 입력하세요.');
      return;
    }
    try {
      const blob = await exportFile.mutateAsync(name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_직배발주서.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`CSV 내보내기 실패: ${extractErrorMessage(err)}`);
    }
  };

  const handleComplete = async () => {
    if (!completedBy.trim()) {
      toast.error('처리자 이름/ID를 입력하세요.');
      return;
    }
    try {
      await complete.mutateAsync({
        fulfillmentOrderIds: [fo.id],
        completedBy: completedBy.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillment(fo.id) });
      toast.success('공급사 출고 완료 처리되었습니다. FO가 shipped 상태로 전환됩니다.');
    } catch (err) {
      toast.error(`공급사 출고 완료 처리 실패: ${extractErrorMessage(err)}`);
    }
  };

  return (
    <div className="flex flex-col gap-8 py-4">
      {/* 직배 상태 헤더 */}
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">직배 상태</p>
        {fo.directShipStatus ? (
          <Badge variant="secondary" className="font-mono text-xs">
            {fo.directShipStatus}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
            미전달 (pending)
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">drop_ship</Badge>
      </div>

      <Alert>
        <AlertTriangle />
        <AlertDescription>
          직배 플로우: 공급사 전달(forwardDropShip) → 공급사 출고 완료(completeDropShip).
          공급사 출고 완료는 창고 출고 완료(ship)와 다르며, 고객 배송 완료(deliver)가 아닙니다.
        </AlertDescription>
      </Alert>

      {/* 공급사 전달 (forward) */}
      <section className="rounded-md border p-4">
        <h3 className="mb-1 text-sm font-semibold">공급사 전달</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          공급사에 발주서를 전달합니다. directShipStatus가 <span className="font-mono">forwarded</span>로 전환됩니다.
          전달 후 공급사가 상품을 준비하고 출고하면 아래 &ldquo;공급사 출고 완료&rdquo;를 처리합니다.
        </p>
        {!canForward && (
          <p className="mb-2 text-xs text-muted-foreground">
            현재 directShipStatus({fo.directShipStatus ?? 'null'})에서는 전달이 허용되지 않습니다.
            전달은 pending 또는 미전달 상태에서만 가능합니다.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">공급사 이름</Label>
            <Input
              value={forwardCompanyName}
              onChange={(e) => setForwardCompanyName(e.target.value)}
              placeholder="예: 예시공급사(주)"
              className="w-52"
              disabled={!canForward}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleForward}
            disabled={!canForward || forward.isPending || !forwardCompanyName.trim()}
          >
            {forward.isPending ? '처리 중...' : '공급사 전달'}
          </Button>
        </div>
      </section>

      {/* CSV 발주서 다운로드 */}
      <section className="rounded-md border p-4">
        <h3 className="mb-1 text-sm font-semibold">발주서 CSV 내보내기</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          공급사별 직배 발주서를 CSV 형식으로 내보냅니다. 공급사 이름으로 데이터가 필터링됩니다.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">공급사 이름</Label>
            <Input
              value={exportCompanyName}
              onChange={(e) => setExportCompanyName(e.target.value)}
              placeholder="예: 예시공급사(주)"
              className="w-52"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={exportFile.isPending || !exportCompanyName.trim()}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {exportFile.isPending ? '내보내는 중...' : 'CSV 내보내기'}
          </Button>
        </div>
      </section>

      {/* 공급사 출고 완료 (complete) */}
      <section className="rounded-md border p-4">
        <h3 className="mb-1 text-sm font-semibold">공급사 출고 완료</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          공급사에서 상품이 출고되었음을 확인할 때 실행합니다.
          FO 상태가 <span className="font-mono font-medium">shipped</span>로 전환됩니다.
        </p>
        <Alert className="mb-3">
          <AlertTriangle />
          <AlertDescription>
            공급사 출고 완료는 <strong>고객 배송 완료(수령)가 아닙니다.</strong>{' '}
            공급사에서 물건이 출고된 시점을 의미합니다.
            고객 배송 완료는 배송 탭의 &ldquo;배송 완료 처리(고객 수령)&rdquo;로 별도 처리합니다.
          </AlertDescription>
        </Alert>
        {!canComplete && (
          <p className="mb-2 text-xs text-muted-foreground">
            현재 directShipStatus({fo.directShipStatus ?? 'null'})에서는 출고 완료 처리가 허용되지 않습니다.
            공급사 전달(forwarded) 상태에서만 가능합니다.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">처리자 이름/ID</Label>
            <Input
              value={completedBy}
              onChange={(e) => setCompletedBy(e.target.value)}
              placeholder="예: 홍길동 또는 admin01"
              className="w-52"
              disabled={!canComplete}
            />
          </div>
          <Button
            onClick={handleComplete}
            disabled={!canComplete || complete.isPending || !completedBy.trim()}
          >
            {complete.isPending ? '처리 중...' : '공급사 출고 완료'}
          </Button>
        </div>
      </section>
    </div>
  );
}
