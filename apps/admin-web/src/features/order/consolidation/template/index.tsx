'use client';

import { useState } from 'react';
import { AlertTriangle, Boxes, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePermission } from '@/hooks/use-permission';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  useShipmentConsolidationCandidates,
  createIdempotentCommand,
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  isRecoverableOperation,
  useCreateShipmentConsolidation,
  useFulfillmentOperation,
} from '@/lib/services/orders';
import type { FulfillmentOperationStatus } from '@/lib/types/dto/fulfillment';

type RetryState = {
  operationId: string;
  operationStatus: FulfillmentOperationStatus;
  idempotencyKey: string;
  data: {
    sources: Array<{
      shipmentId: string;
      expectedManifestVersion: number;
      expectedReservationVersion: number;
    }>;
    recipientSourceShipmentId: string;
    reason: string;
    csCaseId?: string;
    note?: string;
  };
};

function shortId(value: string) {
  return value ? `${value.slice(0, 8)}…` : '응답 대기';
}

export default function ConsolidationTemplate() {
  const { data: warehouses = [] } = useWarehouses();
  const { hasScope, isPermissionLoading } = usePermission();
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('동일 수령인 합포장');
  const [csCaseId, setCsCaseId] = useState('');
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState<RetryState | null>(null);

  const canRead = !!hasScope([FULFILLMENT_SCOPES.operate]);
  const canCreate = !!hasScope([FULFILLMENT_SCOPES.consolidate]);
  const candidates = useShipmentConsolidationCandidates({ warehouseId });
  const create = useCreateShipmentConsolidation();
  const operation = useFulfillmentOperation(retry?.operationId ?? '');
  const currentStatus = operation.data?.status ?? retry?.operationStatus;

  const run = async (state: RetryState) => {
    setRetry(state);
    try {
      const result = await create.mutateAsync({
        data: state.data,
        idempotencyKey: state.idempotencyKey,
      });
      const next = {
        ...state,
        operationId: result.operationId,
        operationStatus: result.operationStatus,
      };
      setRetry(next);
      if (result.operationStatus === 'completed') {
        toast.success('합포장 작업이 완료되었습니다.');
        await candidates.refetch();
      } else {
        toast.info(
          '합포장 복구 작업이 접수되었습니다. 완료 전까지 결과를 확정 표시하지 않습니다.'
        );
      }
    } catch (error) {
      toast.error(getServerDenyMessage(error, '합포장 요청에 실패했습니다.'));
    }
  };

  const consolidate = async (
    group: NonNullable<typeof candidates.data>[number]
  ) => {
    if (!reason.trim()) {
      toast.error('작업 사유를 입력하세요.');
      return;
    }
    const state: RetryState = {
      operationId: '',
      operationStatus: 'pending',
      idempotencyKey: createIdempotentCommand({}).idempotencyKey,
      data: {
        sources: group.shipments.map((shipment) => ({
          shipmentId: shipment.shipmentId,
          expectedManifestVersion: shipment.manifestVersion,
          expectedReservationVersion: shipment.reservationVersion,
        })),
        recipientSourceShipmentId: group.shipments[0].shipmentId,
        reason: reason.trim(),
        ...(csCaseId.trim() ? { csCaseId: csCaseId.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    };
    await run(state);
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="합포장 계획"
        subtitle="서버가 검증한 Draft shipment 후보를 명시적으로 선택해 하나의 shipment로 합칩니다."
      />
      <div className="flex flex-col gap-4 p-4">
        {!isPermissionLoading && !canRead && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>조회 권한 없음</AlertTitle>
            <AlertDescription>
              합포장 후보를 조회할 권한이 없습니다.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>창고</Label>
            <Select
              value={warehouseId}
              onValueChange={setWarehouseId}
              disabled={!canRead}
            >
              <SelectTrigger>
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>작업 사유 (필수)</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>CS case UUID</Label>
            <Input
              value={csCaseId}
              onChange={(event) => setCsCaseId(event.target.value)}
              placeholder="선택"
            />
          </div>
          <div className="space-y-1.5">
            <Label>운영 메모</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={1}
            />
          </div>
        </div>

        {retry && isRecoverableOperation(currentStatus) && (
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <RefreshCw />
            <AlertTitle>합포장 작업 {currentStatus}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {retry.operationId
                  ? `작업 ${shortId(retry.operationId)}`
                  : '서버 응답 미확인 · 원래 요청 키 보존'}{' '}
                · 완료가 확인되기 전에는 target shipment를 성공으로 표시하지
                않습니다.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(retry)}
                disabled={create.isPending}
              >
                동일 키로 안전 재시도
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!warehouseId ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            창고를 선택하세요.
          </p>
        ) : candidates.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            실제 후보를 조회하는 중입니다.
          </p>
        ) : candidates.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              {getServerDenyMessage(
                candidates.error,
                '합포장 후보 조회에 실패했습니다.'
              )}
            </AlertDescription>
          </Alert>
        ) : (candidates.data?.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            현재 합포장 가능한 shipment 그룹이 없습니다.
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {candidates.data?.map((group) => (
              <Card key={group.compatibilityKey}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Boxes className="h-4 w-4" /> 후보{' '}
                      {group.shipments.length}건
                    </span>
                    <Badge variant="outline">
                      {shortId(group.shippingProfileId)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="divide-y rounded-md border">
                    {group.shipments.map((shipment) => (
                      <div
                        key={shipment.shipmentId}
                        className="flex items-center justify-between gap-3 p-3 text-xs"
                      >
                        <div>
                          <p className="font-mono">
                            {shortId(shipment.shipmentId)}
                          </p>
                          <p className="text-muted-foreground">
                            {shipment.salesChannels.join(', ')} ·{' '}
                            {shipment.lineCount}라인 · {shipment.totalQty}개
                          </p>
                        </div>
                        <span className="text-muted-foreground">
                          M{shipment.manifestVersion} / R
                          {shipment.reservationVersion}
                        </span>
                      </div>
                    ))}
                  </div>
                  {canCreate && (
                    <Button
                      className="w-full"
                      onClick={() => consolidate(group)}
                      disabled={create.isPending || !reason.trim()}
                    >
                      {create.isPending ? '요청 중...' : '이 그룹 합포장'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
