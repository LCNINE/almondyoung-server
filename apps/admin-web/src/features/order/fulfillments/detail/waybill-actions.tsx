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
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  createIdempotentCommand,
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
import { carrierLabel, waybillStatusLabel } from './fulfillment-labels';
import { waybillErrorMessage } from './stuck-waybill';
import {
  activeBatchId,
  shownWaybillActions,
  splitWaybills,
} from './waybill-view';

type Action = 'issue' | 'manual' | 'reissue' | 'void';

const ACTION_TITLE: Record<Action, string> = {
  issue: '운송장 발급',
  manual: '수동 운송장 등록',
  reissue: '운송장 재발급',
  void: '운송장 무효화',
};

const SUBMIT_LABEL: Record<Action, string> = {
  issue: '발급하기',
  manual: '등록하기',
  reissue: '재발급하기',
  void: '무효로 하기',
};

const SUPPORTED_CARRIERS_TEXT = '지금은 한진택배만 발급할 수 있어요.';

function activeVoidableWaybill(
  waybills: ShipmentWaybillHistory[]
): ShipmentWaybillHistory | undefined {
  // 서버가 무효화를 받는 건 발송 전 registered 뿐이다. 멈춘(pending/allocated)·끝난(abandoned/failed) 행에
  // 버튼을 켜 두면 거절만 받는다 — 멈춘 발급은 위의 «중단하고 다시 발급»으로 푼다(#1241).
  return waybills.find((w) => w.status === 'registered');
}

export function WaybillActions({
  shipment,
  voidLockedReason = null,
}: {
  shipment: ShipmentAdminDetail;
  voidLockedReason?: string | null;
}) {
  const { canRun } = usePermissionCheck();
  const issue = useIssueWaybill();
  const manual = useRegisterManualWaybill();
  const reissue = useReissueWaybill();
  const voidWaybill = useVoidWaybill();

  const [action, setAction] = useState<Action | null>(null);
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState('');
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [lastKind, setLastKind] = useState<'issue' | 'reissue' | 'manual' | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  const voidTarget = activeVoidableWaybill(shipment.waybills ?? []);
  const shown = shownWaybillActions(
    shipment.status,
    splitWaybills(shipment.waybills ?? []).current
  );
  const inBatch = !!activeBatchId(shipment.workItems ?? []);

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
    setLastKind(null);
    setPendingNotice(null);
    setAction('issue');
  };

  const reflectStatus = (
    status: string | null | undefined,
    kind: 'issue' | 'reissue' | 'manual' = 'issue'
  ) => {
    if (isWaybillIssued(status)) {
      toast.success(
        kind === 'reissue'
          ? '새 송장을 받았어요. 붙어 있는 송장은 떼고 새 송장으로 바꿔 붙여 주세요.'
          : '운송장을 발급했어요.'
      );
      setPendingNotice(null);
      setAction(null);
    } else if (isWaybillPendingIssue(status)) {
      // 비종결 — 성공으로 표시하지 않는다. 동일 키 안전 재시도 안내.
      setPendingNotice(
        '아직 발급이 끝나지 않았어요. 다시 시도해도 같은 요청으로 보내서 송장이 두 장 나오지 않아요.'
      );
      toast.info('발급을 진행하고 있어요.');
      setAction(null);
    } else if (kind === 'reissue') {
      // 재발급은 기존 송장을 먼저 무효로 하므로, 창에 남기면 바꿀 송장 없는 재발급이 된다
      toast.error(
        '기존 송장은 무효가 됐고 새 송장은 받지 못했어요. «운송장 발급»으로 새 송장을 받아 주세요.'
      );
      setPendingNotice(null);
      setAction(null);
    } else {
      toast.error(
        status
          ? `운송장을 발급하지 못했어요 (${waybillStatusLabel(status)}).`
          : '운송장을 발급하지 못했어요.'
      );
      setPendingNotice(null);
    }
  };

  const runIssueLike = async (kind: 'issue' | 'reissue', originalKey?: string) => {
    // 재발급은 서버가 활성 운송장을 먼저 무효화하므로 무효화와 같이 막는다
    if (kind === 'reissue' && voidLockedReason) {
      toast.error(voidLockedReason);
      return;
    }
    if (!isCarrierSupported(carrier)) {
      toast.error(SUPPORTED_CARRIERS_TEXT);
      return;
    }
    const key = createIdempotentCommand({}, originalKey ?? undefined)
      .idempotencyKey;
    setLastKey(key);
    setLastKind(kind);
    try {
      const data = {
        carrier,
        expectedManifestVersion: shipment.manifestVersion,
      };
      const result =
        kind === 'issue'
          ? await issue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key })
          : await reissue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key });
      reflectStatus(result.status, kind);
    } catch (error) {
      toast.error(
        waybillErrorMessage(error, `${ACTION_TITLE[kind === 'issue' ? 'issue' : 'reissue']}에 실패했어요.`)
      );
      if (kind === 'reissue') setAction(null);
    }
  };

  const runManual = async (originalKey?: string) => {
    if (!isCarrierSupported(carrier)) {
      toast.error(SUPPORTED_CARRIERS_TEXT);
      return;
    }
    if (!trackingNo.trim()) {
      toast.error('운송장 번호를 입력하세요.');
      return;
    }
    const key = createIdempotentCommand({}, originalKey ?? undefined)
      .idempotencyKey;
    setLastKey(key);
    setLastKind('manual');
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
      reflectStatus(result.status, 'manual');
    } catch (error) {
      toast.error(waybillErrorMessage(error, '수동 등록에 실패했어요.'));
    }
  };

  const runVoid = async () => {
    if (voidLockedReason) {
      toast.error(voidLockedReason);
      return;
    }
    if (!voidTarget) {
      toast.error('무효로 할 수 있는 송장이 없어요.');
      return;
    }
    if (!reason.trim()) {
      toast.error('무효로 하는 이유를 입력하세요.');
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
      toast.success('송장을 무효로 했어요.');
      setAction(null);
    } catch (error) {
      toast.error(waybillErrorMessage(error, '무효화에 실패했어요.'));
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
      <div className="flex flex-wrap gap-2 empty:hidden">
        {shown.includes('issue') && canRun(useIssueWaybill) && (
          <Button size="sm" variant="outline" onClick={openIssue}>
            운송장 발급
          </Button>
        )}
        {shown.includes('manual') && canRun(useRegisterManualWaybill) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTrackingNo('');
              setReason('');
              setLastKey(null);
              setLastKind(null);
              setPendingNotice(null);
              setAction('manual');
            }}
          >
            수동 등록
          </Button>
        )}
        {shown.includes('reissue') && canRun(useReissueWaybill) && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!voidLockedReason}
            onClick={() => {
              setCarrier('HANJIN');
              setLastKey(null);
              setLastKind(null);
              setPendingNotice(null);
              setAction('reissue');
            }}
          >
            재발급
          </Button>
        )}
        {shown.includes('void') && canRun(useVoidWaybill) && (
          <Button
            size="sm"
            variant="destructive"
            disabled={!voidTarget || !!voidLockedReason}
            onClick={() => {
              setReason('');
              setAction('void');
            }}
          >
            무효화
          </Button>
        )}
      </div>

      {((shown.includes('void') && canRun(useVoidWaybill)) ||
        (shown.includes('reissue') && canRun(useReissueWaybill))) &&
        voidLockedReason && (
          <p className="text-xs text-muted-foreground">{voidLockedReason}</p>
        )}

      {pendingNotice && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{pendingNotice}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !lastKey}
              onClick={() => {
                if (lastKind === 'manual') return runManual(lastKey ?? undefined);
                // 재발급은 기존 송장을 이미 무효로 했고, 서버는 발급 단계를 «요청 키:issue»로 실행한다.
                // 같은 재발급을 다시 보내면 대기 중인 송장 때문에 거절되므로 그 발급 단계를 이어 간다
                if (lastKind === 'reissue') return runIssueLike('issue', `${lastKey}:issue`);
                return runIssueLike('issue', lastKey ?? undefined);
              }}
            >
              다시 시도
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
              <Label htmlFor="waybill-carrier">택배사</Label>
              <Select
                value={carrier}
                onValueChange={(v) => setCarrier(v as CarrierCode)}
              >
                <SelectTrigger id="waybill-carrier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAYBILL_CARRIERS.map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      disabled={!isCarrierSupported(c)}
                    >
                      {carrierLabel(c)}
                      {isCarrierSupported(c) ? '' : ' (준비 중)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === 'manual' && (
            <div className="space-y-1.5">
              <Label htmlFor="waybill-tracking-no">운송장 번호</Label>
              <Input
                id="waybill-tracking-no"
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
            </div>
          )}

          {(action === 'manual' || action === 'void') && (
            <div className="space-y-1.5">
              <Label htmlFor="waybill-reason">
                사유{action === 'void' ? ' (필수)' : ' (선택)'}
              </Label>
              <Input
                id="waybill-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {action === 'reissue' && voidTarget && (
            <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-sm">
              <p className="font-medium">
                {`바꿀 송장: ${carrierLabel(voidTarget.carrier)} ${voidTarget.trackingNo ?? '번호 없음'}`}
              </p>
              <p className="text-muted-foreground">
                재발급하면 이 번호는 먼저 무효가 돼요. 새 번호 발급은 늦어지거나 실패할 수 있어요.{' '}
                {inBatch
                  ? '새 송장 번호를 확인한 뒤 물류앱에서 «송장 재출력»으로 출력해, 상자에 붙인 송장과 바꿔 붙여 주세요.'
                  : '새 송장 번호를 확인한 뒤, 출력해 붙인 송장이 있으면 떼고 새 송장으로 바꿔 붙여 주세요.'}
              </p>
            </div>
          )}

          {action === 'void' && (
            <p className="text-xs text-muted-foreground">
              {voidTarget
                ? `무효로 할 송장: ${carrierLabel(voidTarget.carrier)} ${voidTarget.trackingNo ?? '번호 없음'}`
                : '무효로 할 수 있는 송장이 없어요.'}
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
              {busy ? '처리 중…' : action ? SUBMIT_LABEL[action] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
