'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { OperationReasonFields } from '@/features/order/fulfillments/detail/operation-reason-fields';
import {
  canSubmitOperationReason,
  toOperationReasonPayload,
  type OperationReasonValue,
} from '@/features/order/fulfillments/detail/operation-reasons';
import { carrierLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';
import type {
  DirectDeliveryBlocker,
  DirectDeliveryPreview,
  DirectDeliveryRecipient,
} from '@/lib/api/domains/orders/direct-delivery.client';
import { parseServerError } from '@/lib/api/server-error';
import {
  useDirectDeliveryDispatch,
  useDirectDeliveryPreview,
  useDirectDeliveryReturn,
  useDirectDeliveryTakeover,
} from '@/lib/services/orders/direct-delivery';
import type { SupplierSheetCarrier } from '@/lib/types/dto/fulfillment';
import {
  blockerText,
  directDeliveryErrorText,
  isMaskedRecipient,
  NO_ANSWER_TEXT,
  recipientClipboardText,
} from './direct-delivery-copy';

export const DIRECT_DELIVERY_CARRIERS: readonly SupplierSheetCarrier[] = [
  'CJ',
  'HANJIN',
  'LOTTE',
  'LOGEN',
  'EPOST',
  'KDEXP',
  'DAESIN',
  'ILYANG',
  'HDEXP',
  'CVSNET',
  'CUPOST',
  'CHUNIL',
  'KUNYOUNG',
  'CJGLS',
];

type Pending = { run: () => Promise<void> };

/**
 * 한 상자를 공급처가 고객에게 바로 보내게 한다(창고 상자) — 또는 맡긴 공급처 상자에 송장을 넣거나 창고로 되돌린다.
 * 창을 열 때마다 상자를 새로 읽고, 응답을 못 받으면 같은 키로 다시 보낸다.
 */
export function DirectDeliveryDialog({
  shipmentId,
  orderText,
  onClose,
}: {
  shipmentId: string;
  orderText: string;
  onClose: () => void;
}) {
  const preview = useDirectDeliveryPreview(shipmentId);
  const data = preview.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [unanswered, setUnanswered] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // 한 번 보낸 요청은 같은 키·같은 내용으로만 다시 보낸다(두 번 처리되지 않게)
  const send = async (request: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await request();
      setUnanswered(null);
      onClose();
    } catch (error) {
      const { status } = parseServerError(error);
      if (status === null || status >= 500) {
        setUnanswered({ run: request });
        return;
      }
      setUnanswered(null);
      const { text, refetch } = directDeliveryErrorText(error);
      setNotice(text);
      if (refetch) void preview.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{orderText} 공급처 직배송</DialogTitle>
          <DialogDescription className="break-keep">
            {data?.owner === 'supplier'
              ? '공급처에 맡긴 상자예요. 공급처에게 받은 송장을 넣으면 발송 완료되고, 공급처가 못 보내면 창고 출고로 되돌려요.'
              : '재고가 없을 때 이 주문만 공급처가 고객에게 바로 보내요. 우리 재고는 줄지 않고, 이 상자가 잡은 재고는 다른 주문에 돌아가요.'}
          </DialogDescription>
        </DialogHeader>
        {notice && (
          <p
            role="alert"
            className="text-sm font-medium text-destructive break-keep"
          >
            {notice}
          </p>
        )}
        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">상자를 확인하는 중…</p>
        ) : !data ? (
          <div role="alert" className="flex items-center gap-2 text-sm">
            <span>상자를 확인하지 못했어요.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void preview.refetch()}
            >
              다시 시도
            </Button>
          </div>
        ) : data.owner === 'warehouse' ? (
          <TakeoverForm
            key={data.manifestVersion}
            data={data}
            orderText={orderText}
            busy={busy || preview.isFetching}
            locked={!!unanswered}
            onSend={send}
          />
        ) : (
          <SupplierBoxForm
            key={data.manifestVersion}
            data={data}
            orderText={orderText}
            busy={busy || preview.isFetching}
            locked={!!unanswered}
            onSend={send}
          />
        )}
        {unanswered && (
          <p
            role="alert"
            className="text-sm font-medium text-destructive break-keep"
          >
            {NO_ANSWER_TEXT}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            닫기
          </Button>
          {unanswered && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void send(unanswered.run)}
            >
              같은 내용 다시 보내기
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FormProps = {
  data: DirectDeliveryPreview;
  orderText: string;
  busy: boolean;
  locked: boolean;
  onSend: (request: () => Promise<void>) => Promise<void>;
};

function TakeoverForm({ data, orderText, busy, locked, onSend }: FormProps) {
  const takeover = useDirectDeliveryTakeover();
  const [supplierId, setSupplierId] = useState(data.suggestedSupplierId ?? '');
  const [carrier, setCarrier] = useState<SupplierSheetCarrier | ''>('');
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState<OperationReasonValue>({
    reasonCode: 'out_of_stock_supplier_ships',
    otherText: '',
    note: '',
  });
  const [showErrors, setShowErrors] = useState(false);
  const reservedQty = data.lines.reduce(
    (total, line) => total + line.reservedQty,
    0
  );
  const hasTracking = carrier !== '' && trackingNo.trim() !== '';
  const halfTracking = (carrier !== '') !== (trackingNo.trim() !== '');

  const submit = () => {
    if (
      !supplierId ||
      halfTracking ||
      !canSubmitOperationReason('direct_delivery', reason)
    ) {
      setShowErrors(true);
      return;
    }
    const request = {
      ...toOperationReasonPayload('direct_delivery', reason),
      supplierId,
      expectedManifestVersion: data.manifestVersion,
      ...(carrier !== '' && hasTracking
        ? { carrier, trackingNo: trackingNo.trim() }
        : {}),
    };
    const idempotencyKey = crypto.randomUUID();
    void onSend(async () => {
      const result = await takeover.mutateAsync({
        shipmentId: data.shipmentId,
        data: request,
        idempotencyKey,
      });
      toast.success(
        result.dispatched
          ? `${orderText} 공급처 직배송으로 발송 완료했어요.`
          : `${orderText} 공급처에 맡겼어요. 송장을 받으면 출고 준비 «직배송 송장 기다림»에서 넣어 주세요.`
      );
    });
  };

  if (data.blockers.length > 0) {
    return <Blockers data={data} blockers={data.blockers} />;
  }

  return (
    <div className="min-w-0 space-y-4">
      <ul role="list" aria-label="이 상자의 상품" className="space-y-1 text-sm">
        {data.lines.map((line) => (
          <li key={line.lineId}>
            <span className="font-medium">{line.skuName}</span>{' '}
            <span className="tabular-nums text-muted-foreground">
              {line.qty}개
              {line.reservedQty > 0 ? ` · 잡은 재고 ${line.reservedQty}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {reservedQty > 0 && (
        <p className="text-sm break-keep">
          이 상자가 잡은 재고 {reservedQty}개를 놓아요 — 기다리는 다음 주문이
          받아요. 있는 것만 먼저 보내려면 닫고 «있는 것만 먼저 보내기»로 나눈 뒤
          기다리는 상자를 맡겨 주세요.
        </p>
      )}
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="direct-supplier">보낼 공급처</Label>
        <Select
          value={supplierId}
          onValueChange={setSupplierId}
          disabled={locked}
        >
          <SelectTrigger id="direct-supplier" className="w-full min-w-0">
            <SelectValue placeholder="공급처 선택" />
          </SelectTrigger>
          <SelectContent>
            {data.suppliers.map((supplier) => (
              <SelectItem key={supplier.id} value={supplier.id}>
                {supplier.name}
                {supplier.id === data.suggestedSupplierId
                  ? ' · 상품에 연결된 공급처'
                  : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!data.suggestedSupplierId && (
          <p className="text-xs text-muted-foreground break-keep">
            이 상품에 연결된 공급처가 없어요. 목록에서 골라 주세요.
          </p>
        )}
        {showErrors && !supplierId && (
          <p className="text-xs text-destructive">공급처를 골라 주세요.</p>
        )}
      </div>
      {data.recipient && <RecipientBlock recipient={data.recipient} />}
      <TrackingFields
        carrier={carrier}
        trackingNo={trackingNo}
        disabled={locked}
        onCarrier={setCarrier}
        onTrackingNo={setTrackingNo}
        hint="송장을 아직 못 받았으면 비워 두세요. 맡김만 기록되고, 받으면 출고 준비 «직배송 송장 기다림»에서 넣어요."
        error={
          showErrors && halfTracking
            ? '택배사와 송장번호를 함께 넣거나 둘 다 비워 주세요.'
            : null
        }
      />
      {!locked && (
        <OperationReasonFields
          type="direct_delivery"
          value={reason}
          onChange={setReason}
          showErrors={showErrors}
        />
      )}
      {!locked && (
        <div className="flex justify-end">
          <Button type="button" disabled={busy} onClick={submit}>
            {hasTracking ? '맡기고 발송 완료' : '공급처에 맡기기'}
          </Button>
        </div>
      )}
    </div>
  );
}

function SupplierBoxForm({ data, orderText, busy, locked, onSend }: FormProps) {
  const dispatch = useDirectDeliveryDispatch();
  const back = useDirectDeliveryReturn();
  const [carrier, setCarrier] = useState<SupplierSheetCarrier | ''>('');
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState<OperationReasonValue>({
    reasonCode: 'supplier_cannot_ship',
    otherText: '',
    note: '',
  });
  const [showTrackingErrors, setShowTrackingErrors] = useState(false);
  const [showReasonErrors, setShowReasonErrors] = useState(false);
  const supplierName =
    data.suppliers.find((s) => s.id === data.supplierId)?.name ?? '공급처';

  // 송장 입력과 창고로 되돌리기는 막는 것이 다르다 — 하나만 막혀도 다른 쪽은 연다
  const canDispatch = data.dispatchBlockers.length === 0;
  const canReturn = data.blockers.length === 0;
  if (!canDispatch && !canReturn) {
    const codes = new Set(data.dispatchBlockers.map((b) => b.code));
    return (
      <Blockers
        data={data}
        blockers={[
          ...data.dispatchBlockers,
          ...data.blockers.filter((b) => !codes.has(b.code)),
        ]}
      />
    );
  }

  const submitTracking = () => {
    if (carrier === '' || trackingNo.trim() === '') {
      setShowTrackingErrors(true);
      return;
    }
    const request = {
      carrier,
      trackingNo: trackingNo.trim(),
      expectedManifestVersion: data.manifestVersion,
    };
    const idempotencyKey = crypto.randomUUID();
    void onSend(async () => {
      await dispatch.mutateAsync({
        shipmentId: data.shipmentId,
        data: request,
        idempotencyKey,
      });
      toast.success(`${orderText} 송장을 넣어 발송 완료했어요.`);
    });
  };

  const submitReturn = () => {
    if (!canSubmitOperationReason('direct_delivery_return', reason)) {
      setShowReasonErrors(true);
      return;
    }
    const request = {
      ...toOperationReasonPayload('direct_delivery_return', reason),
      expectedManifestVersion: data.manifestVersion,
    };
    const idempotencyKey = crypto.randomUUID();
    void onSend(async () => {
      const result = await back.mutateAsync({
        shipmentId: data.shipmentId,
        data: request,
        idempotencyKey,
      });
      toast.success(
        result.wasHandedOff
          ? `${orderText} 창고 출고로 되돌렸어요. ${supplierName}에 보내지 말라고 꼭 알려 주세요.`
          : `${orderText} 창고 출고로 되돌렸어요.`
      );
    });
  };

  return (
    <div className="min-w-0 space-y-5">
      <p className="text-sm break-keep">
        {supplierName}
        {data.handedOff
          ? '에 맡겼어요.'
          : '가 보낼 상자예요(아직 넘기지 않음). 송장을 넣으면 넘김도 함께 기록돼요.'}
      </p>
      {data.recipient && <RecipientBlock recipient={data.recipient} />}
      {canDispatch && (
        <section aria-label="송장 넣기" className="space-y-3">
          <TrackingFields
            carrier={carrier}
            trackingNo={trackingNo}
            disabled={locked}
            onCarrier={setCarrier}
            onTrackingNo={setTrackingNo}
            hint="공급처에게 받은 택배사와 송장번호를 넣으면 고객 알림·배송 조회가 시작돼요."
            error={
              showTrackingErrors ? '택배사와 송장번호를 넣어 주세요.' : null
            }
          />
          {!locked && (
            <div className="flex justify-end">
              <Button type="button" disabled={busy} onClick={submitTracking}>
                송장 넣고 발송 완료
              </Button>
            </div>
          )}
        </section>
      )}
      {!canDispatch && (
        <section aria-label="송장을 넣을 수 없는 이유" className="space-y-2">
          <Blockers data={data} blockers={data.dispatchBlockers} />
        </section>
      )}
      {!canReturn && (
        <section
          aria-label="창고 출고로 되돌릴 수 없는 이유"
          className="space-y-2 border-t pt-4"
        >
          <Blockers data={data} blockers={data.blockers} />
        </section>
      )}
      {canReturn && !locked && (
        <section
          aria-label="창고 출고로 되돌리기"
          className="space-y-3 border-t pt-4"
        >
          <p className="text-sm break-keep text-muted-foreground">
            공급처가 못 보내거나 재고가 들어왔으면 창고 출고로 되돌려요. 원래
            기다리던 순서대로 재고를 다시 받아요.
            {data.handedOff
              ? ' 되돌린 뒤 공급처에 보내지 말라고 알려 주세요.'
              : ''}
          </p>
          <OperationReasonFields
            type="direct_delivery_return"
            value={reason}
            onChange={setReason}
            showErrors={showReasonErrors}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={submitReturn}
            >
              창고 출고로 되돌리기
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Blockers({
  data,
  blockers,
}: {
  data: DirectDeliveryPreview;
  blockers: DirectDeliveryBlocker[];
}) {
  const detailHref = `/order/fulfillments/${encodeURIComponent(data.fulfillmentOrderId)}?shipmentId=${encodeURIComponent(data.shipmentId)}`;
  return (
    <ul
      role="list"
      aria-label="지금 할 수 없는 이유"
      className="space-y-2 text-sm"
    >
      {blockers.map((blocker) => (
        <li key={blocker.code} className="break-keep">
          {blockerText(blocker, data.owner)}{' '}
          {blocker.code === 'active_work' && blocker.batchId ? (
            <Link
              className="whitespace-nowrap font-medium underline"
              href={`/order/outbound-batches?batchId=${encodeURIComponent(blocker.batchId)}`}
            >
              배치 열기
            </Link>
          ) : [
              'active_waybill',
              'recovery',
              'recipient_incomplete',
              'not_draft',
            ].includes(blocker.code) ? (
            <Link
              className="whitespace-nowrap font-medium underline"
              href={detailHref}
            >
              상자 상세
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RecipientBlock({ recipient }: { recipient: DirectDeliveryRecipient }) {
  const masked = isMaskedRecipient(recipient);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recipientClipboardText(recipient));
      toast.success('받는 분 정보를 복사했어요.');
    } catch {
      toast.error('복사하지 못했어요. 직접 골라 복사해 주세요.');
    }
  };
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">공급처에 알려 줄 받는 분</span>
        {!masked && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copy()}
          >
            복사
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-keep">
        <dt className="text-muted-foreground">받는 분</dt>
        <dd>{recipient.name}</dd>
        <dt className="text-muted-foreground">연락처</dt>
        <dd className="tabular-nums">{recipient.phone}</dd>
        <dt className="text-muted-foreground">주소</dt>
        <dd>{recipient.address}</dd>
        {recipient.entrancePassword && (
          <>
            <dt className="text-muted-foreground">공동현관</dt>
            <dd>{recipient.entrancePassword}</dd>
          </>
        )}
        {recipient.memo && (
          <>
            <dt className="text-muted-foreground">요청사항</dt>
            <dd>{recipient.memo}</dd>
          </>
        )}
      </dl>
      {masked && (
        <p className="text-xs text-muted-foreground break-keep">
          가려진 값이에요. 받는 분 정보 보기 권한이 있는 분이 맡겨 주세요.
        </p>
      )}
    </div>
  );
}

function TrackingFields({
  carrier,
  trackingNo,
  disabled,
  onCarrier,
  onTrackingNo,
  hint,
  error,
}: {
  carrier: SupplierSheetCarrier | '';
  trackingNo: string;
  disabled: boolean;
  onCarrier: (carrier: SupplierSheetCarrier) => void;
  onTrackingNo: (value: string) => void;
  hint: string;
  error: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor="direct-carrier">택배사</Label>
          <Select
            value={carrier}
            onValueChange={(value) => {
              const match = DIRECT_DELIVERY_CARRIERS.find(
                (code) => code === value
              );
              if (match) onCarrier(match);
            }}
            disabled={disabled}
          >
            <SelectTrigger id="direct-carrier" className="w-full">
              <SelectValue placeholder="택배사" />
            </SelectTrigger>
            <SelectContent>
              {DIRECT_DELIVERY_CARRIERS.map((code) => (
                <SelectItem key={code} value={code}>
                  {carrierLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="direct-tracking">송장번호</Label>
          <Input
            id="direct-tracking"
            inputMode="numeric"
            autoComplete="off"
            value={trackingNo}
            disabled={disabled}
            onChange={(event) => onTrackingNo(event.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground break-keep">{hint}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
