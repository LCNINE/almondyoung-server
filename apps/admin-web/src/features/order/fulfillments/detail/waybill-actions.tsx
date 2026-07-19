'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePermission } from '@/hooks/use-permission';
import {
  createIdempotentCommand,
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  isWaybillIssued,
  isWaybillPendingIssue,
  useIssueWaybill,
  useReissueWaybill,
  useRegisterManualWaybill,
  useVoidWaybill,
  WAYBILL_CARRIERS,
  isCarrierSupported,
} from '@/lib/services/orders';
import type {
  CarrierCode,
  ShipmentAdminDetail,
  ShipmentWaybillHistory,
} from '@/lib/types/dto/fulfillment';

type Action = 'issue' | 'manual' | 'reissue' | 'void';

const ACTION_TITLE: Record<Action, string> = {
  issue: '운송장 발급',
  manual: '수동 운송장 등록',
  reissue: '운송장 재발급',
  void: '운송장 무효화',
};

function activeVoidableWaybill(
  waybills: ShipmentWaybillHistory[]
): ShipmentWaybillHistory | undefined {
  // 발송 전(voidedAt 없음)만 무효화 대상.
  return waybills.find((w) => !w.voidedAt && w.status !== 'voided');
}

export function WaybillActions({
  shipment,
}: {
  shipment: ShipmentAdminDetail;
}) {
  const { hasScope, isPermissionLoading } = usePermission();
  const issue = useIssueWaybill();
  const manual = useRegisterManualWaybill();
  const reissue = useReissueWaybill();
  const voidWaybill = useVoidWaybill();

  const [action, setAction] = useState<Action | null>(null);
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState('');
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  const operate =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);
  const reopen =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.reopen]);
  const voidTarget = activeVoidableWaybill(shipment.waybills ?? []);

  const busy =
    issue.isPending ||
    manual.isPending ||
    reissue.isPending ||
    voidWaybill.isPending;

  const openIssue = () => {
    setCarrier('HANJIN');
    setTrackingNo('');
    setReason('');
    setLastKey(null);
    setPendingNotice(null);
    setAction('issue');
  };

  const reflectStatus = (status: string | null | undefined) => {
    if (isWaybillIssued(status)) {
      toast.success(`운송장 발급 완료 (${status}).`);
      setPendingNotice(null);
      setAction(null);
    } else if (isWaybillPendingIssue(status)) {
      // 비종결 — 성공으로 표시하지 않는다. 동일 키 안전 재시도 안내.
      setPendingNotice(
        `발급이 아직 종결되지 않았습니다 (${status}). 동일 키로 안전하게 재시도할 수 있습니다.`
      );
      toast.info('발급 진행 중입니다. 서버 종결 전에는 성공으로 표시하지 않습니다.');
    } else {
      toast.error(`발급 실패 상태 (${status ?? 'unknown'}).`);
      setPendingNotice(null);
    }
  };

  const runIssueLike = async (kind: 'issue' | 'reissue', originalKey?: string) => {
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    const key = createIdempotentCommand({}, originalKey ?? undefined)
      .idempotencyKey;
    setLastKey(key);
    try {
      const data = {
        carrier,
        expectedManifestVersion: shipment.manifestVersion,
      };
      const result =
        kind === 'issue'
          ? await issue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key })
          : await reissue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key });
      reflectStatus(result.status);
    } catch (error) {
      toast.error(
        getServerDenyMessage(error, `${ACTION_TITLE[kind === 'issue' ? 'issue' : 'reissue']} 요청 실패`)
      );
    }
  };

  const runManual = async () => {
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    if (!trackingNo.trim()) {
      toast.error('운송장 번호를 입력하세요.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      const result = await manual.mutateAsync({
        shipmentId: shipment.id,
        data: {
          carrier,
          expectedManifestVersion: shipment.manifestVersion,
          trackingNo: trackingNo.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        idempotencyKey: key,
      });
      reflectStatus(result.status);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '수동 등록 요청 실패'));
    }
  };

  const runVoid = async () => {
    if (!voidTarget) {
      toast.error('무효화할 활성 운송장이 없습니다.');
      return;
    }
    if (!reason.trim()) {
      toast.error('무효화 사유를 입력하세요.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      await voidWaybill.mutateAsync({
        waybillId: voidTarget.id,
        shipmentId: shipment.id,
        data: { reason: reason.trim() },
        idempotencyKey: key,
      });
      toast.success('운송장을 무효화했습니다.');
      setAction(null);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '무효화 요청 실패'));
    }
  };

  const submit = () => {
    if (action === 'issue') return runIssueLike('issue');
    if (action === 'reissue') return runIssueLike('reissue');
    if (action === 'manual') return runManual();
    if (action === 'void') return runVoid();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {operate && (
          <Button size="sm" variant="outline" onClick={openIssue}>
            운송장 발급
          </Button>
        )}
        {operate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTrackingNo('');
              setReason('');
              setAction('manual');
            }}
          >
            수동 등록
          </Button>
        )}
        {operate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCarrier('HANJIN');
              setLastKey(null);
              setPendingNotice(null);
              setAction('reissue');
            }}
          >
            재발급
          </Button>
        )}
        {reopen && (
          <Button
            size="sm"
            variant="destructive"
            disabled={!voidTarget}
            onClick={() => {
              setReason('');
              setAction('void');
            }}
          >
            무효화
          </Button>
        )}
      </div>

      {pendingNotice && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{pendingNotice}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !lastKey}
              onClick={() =>
                runIssueLike(action === 'reissue' ? 'reissue' : 'issue', lastKey ?? undefined)
              }
            >
              동일 키로 안전 재시도
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action ? ACTION_TITLE[action] : ''}</DialogTitle>
          </DialogHeader>

          {action !== 'void' && (
            <div className="space-y-1.5">
              <Label>택배사</Label>
              <Select
                value={carrier}
                onValueChange={(v) => setCarrier(v as CarrierCode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAYBILL_CARRIERS.map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      disabled={!isCarrierSupported(c)}
                    >
                      {c}
                      {isCarrierSupported(c) ? '' : ' (미지원)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === 'manual' && (
            <div className="space-y-1.5">
              <Label>운송장 번호</Label>
              <Input
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
            </div>
          )}

          {(action === 'manual' || action === 'void') && (
            <div className="space-y-1.5">
              <Label>사유{action === 'void' ? ' (필수)' : ' (선택)'}</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {action === 'void' && (
            <p className="text-xs text-muted-foreground">
              대상 운송장: {voidTarget ? voidTarget.trackingNo ?? voidTarget.id : '없음'}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              취소
            </Button>
            <Button
              variant={action === 'void' ? 'destructive' : 'default'}
              onClick={submit}
              disabled={busy}
            >
              {busy ? '요청 중...' : '서버에 요청'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
