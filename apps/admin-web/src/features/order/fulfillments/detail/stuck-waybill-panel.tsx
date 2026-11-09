'use client';

// 멈춘 송장 발급을 끊고(abandon) 같은 자리에서 새로 발급한다 (#1241).
// 출고 준비 화면이 «멈춘 송장이 있어요»로 남긴 상자가 «상자 보기»로 여기 온다.

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  createIdempotentCommand,
  isWaybillIssued,
  useAbandonWaybill,
  useIssueWaybill,
  WAYBILL_CARRIERS,
} from '@/lib/services/orders';
import type {
  CarrierCode,
  ShipmentAdminDetail,
  ShipmentWaybillHistory,
} from '@/lib/types/dto/fulfillment';
import {
  abandonRisks,
  stuckReason,
  stuckWaybillOf,
  waybillErrorMessage,
  type StuckWaybill,
} from './stuck-waybill';

type Step = 'confirm' | 'reissue';

// 멈춘 행의 택배사로 다시 발급한다. 목록 밖 값이면 유일하게 연동된 한진으로.
function carrierOf(w: ShipmentWaybillHistory): CarrierCode {
  return WAYBILL_CARRIERS.find((c) => c === w.carrier) ?? 'HANJIN';
}

export function StuckWaybillPanel({
  shipment,
}: {
  shipment: Pick<ShipmentAdminDetail, 'id' | 'manifestVersion' | 'waybills'>;
}) {
  const { canRun } = usePermissionCheck();
  const abandon = useAbandonWaybill();
  const issue = useIssueWaybill();

  // 중단에 성공하면 상자 상세를 다시 읽어 멈춘 행이 사라진다 — 대화상자는 붙잡아 둔 사본으로 이어 간다.
  const [target, setTarget] = useState<StuckWaybill | null>(null);
  const [step, setStep] = useState<Step>('confirm');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 같은 대화상자 안의 재시도는 같은 키로 — 응답만 잃은 요청이 두 번 실행되지 않게.
  const [abandonKey, setAbandonKey] = useState<string | null>(null);
  const [issueKey, setIssueKey] = useState<string | null>(null);

  const stuck = stuckWaybillOf(shipment);
  if (!stuck && !target) return null;

  const busy = abandon.isPending || issue.isPending;

  const open = (s: StuckWaybill) => {
    setTarget(s);
    setStep('confirm');
    setReason('');
    setError(null);
    setNotice(null);
    setAbandonKey(createIdempotentCommand({}).idempotencyKey);
    setIssueKey(null);
  };

  const close = () => {
    if (busy) return;
    setTarget(null);
  };

  const runAbandon = async (w: ShipmentWaybillHistory) => {
    if (!reason.trim()) {
      setError('중단 사유를 적어 주세요.');
      return;
    }
    setError(null);
    try {
      await abandon.mutateAsync({
        waybillId: w.id,
        shipmentId: shipment.id,
        data: { reason: reason.trim() },
        idempotencyKey: abandonKey ?? undefined,
      });
      setIssueKey(createIdempotentCommand({}).idempotencyKey);
      setStep('reissue');
    } catch (e) {
      setError(waybillErrorMessage(e, '발급을 중단하지 못했어요.'));
    }
  };

  const runIssue = async (w: ShipmentWaybillHistory) => {
    setError(null);
    setNotice(null);
    try {
      const result = await issue.mutateAsync({
        shipmentId: shipment.id,
        data: {
          carrier: carrierOf(w),
          expectedManifestVersion: shipment.manifestVersion,
        },
        idempotencyKey: issueKey ?? undefined,
      });
      if (isWaybillIssued(result.status)) {
        toast.success(`새 송장을 발급했어요 (${result.trackingNo ?? ''}).`);
        setTarget(null);
        return;
      }
      // 또 결과를 모르는 채 멈췄다 — 성공으로 보이지 않는다. 같은 키로 다시 누르면 그 행을 이어 간다.
      setNotice('발급이 아직 끝나지 않았어요. 잠시 뒤 다시 눌러 주세요.');
    } catch (e) {
      setError(waybillErrorMessage(e, '송장을 발급하지 못했어요.'));
    }
  };

  const w = target?.waybill;

  return (
    <>
      {stuck && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertTitle>송장 발급이 멈춰 있어요</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{stuckReason(stuck)}</span>
            {canRun(useAbandonWaybill) && (
              <Button size="sm" variant="outline" onClick={() => open(stuck)}>
                중단하고 다시 발급
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {step === 'confirm' ? '멈춘 송장 발급 중단' : '새 송장 발급'}
            </DialogTitle>
          </DialogHeader>

          {step === 'confirm' && target && w && (
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5">
                {abandonRisks(target).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {w.lastError && (
                <p className="font-mono text-xs text-muted-foreground">
                  {w.lastError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="abandon-reason">중단 사유</Label>
                <Input
                  id="abandon-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 'reissue' && (
            <p className="text-sm">
              발급을 중단했어요. 이 상자의 새 송장을 발급할까요?
            </p>
          )}

          {notice && <p className="text-sm text-amber-700">{notice}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              {step === 'confirm' ? '취소' : '나중에'}
            </Button>
            {step === 'confirm' && w && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => runAbandon(w)}
              >
                {abandon.isPending ? '중단하는 중…' : '발급 중단'}
              </Button>
            )}
            {step === 'reissue' && w && canRun(useIssueWaybill) && (
              <Button disabled={busy} onClick={() => runIssue(w)}>
                {issue.isPending ? '발급하는 중…' : '새로 발급'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
