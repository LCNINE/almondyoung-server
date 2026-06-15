'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Printer, Send, Truck } from 'lucide-react';
import { useIssueInvoice, usePrintInvoices, useMarkInvoiceShipped, useCancelInvoice } from '@/lib/services/orders/mutations';
import { useInvoice } from '@/lib/services/orders/queries';
import type { IssueInvoiceRequest, InvoiceIssueMethod } from '@/lib/types/dto/fulfillment';
import { Badge } from '@/components/ui/badge';

// Core carrier enum(inventory.schema.ts)에 있는 값만 노출 — enum 밖 값은 서버가 400 으로 거부한다
const CARRIER_CODES = [
  { value: 'HANJIN', label: '한진택배' },
  { value: 'CJ', label: 'CJ대한통운' },
  { value: 'LOTTE', label: '롯데택배' },
  { value: 'LOGEN', label: '로젠택배' },
];

export function IssueInvoiceForm() {
  const [foId, setFoId] = useState('');
  const [carrierCode, setCarrierCode] = useState('HANJIN');
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  // 기본값 없음 — 운영자가 발행 방식을 명시적으로 선택해야 발행 가능.
  // (direct 가 기본이면 HANJIN + 내부발번이 고객 tracking 으로 나가는 사고 여지)
  // TODO(hanjin): 한진 계약 승인(HANJIN_* secret 등록) 후 기본값 'hanjin' 전환 검토.
  const [issueMethod, setIssueMethod] = useState<InvoiceIssueMethod | ''>('');
  // direct(직접 입력) 발행 시 필수 — 택배사에서 실제 발급받은 운송장 번호
  const [trackingNumber, setTrackingNumber] = useState('');
  const [issuedInvoiceId, setIssuedInvoiceId] = useState<string | null>(null);

  const issueMutation = useIssueInvoice();
  const printMutation = usePrintInvoices();
  const shipMutation = useMarkInvoiceShipped();
  const cancelMutation = useCancelInvoice();

  const { data: invoiceDetail, refetch: refetchInvoice } = useInvoice(issuedInvoiceId ?? '');

  const handleIssue = async () => {
    if (!foId.trim() || !recipientName.trim() || !recipientAddress.trim() || !recipientPhone.trim()) {
      toast.error('주문처리 ID, 수취인 정보를 모두 입력해주세요.');
      return;
    }
    if (!issueMethod) {
      toast.error('발행 방식을 선택해주세요.');
      return;
    }
    if (issueMethod === 'direct' && !trackingNumber.trim()) {
      toast.error('직접 입력 발행은 실제 운송장 번호가 필요합니다.');
      return;
    }
    try {
      const result = await issueMutation.mutateAsync({
        fulfillmentOrderId: foId.trim(),
        carrierCode,
        recipientName: recipientName.trim(),
        recipientAddress: recipientAddress.trim(),
        recipientPhone: recipientPhone.trim(),
        deliveryMessage: deliveryMessage.trim() || undefined,
        issueMethod,
        invoiceNumber:
          issueMethod === 'direct' ? trackingNumber.trim() : undefined,
      });
      setIssuedInvoiceId(result.invoiceId);
      toast.success('송장이 발행되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '송장 발행에 실패했습니다.');
    }
  };

  const handlePrint = async () => {
    if (!issuedInvoiceId) return;
    try {
      const result = await printMutation.mutateAsync({ invoiceIds: [issuedInvoiceId] });
      if (result.printUri) {
        window.open(result.printUri, '_blank');
      } else {
        toast.success('출력 요청이 완료되었습니다.');
      }
      refetchInvoice();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '송장 출력에 실패했습니다.');
    }
  };

  const handleShip = async () => {
    if (!issuedInvoiceId) return;
    // 외부 provider(hanjin/goodsflow): printed 상태에서만 ship 가능. direct/self: 인쇄 단계가 없어 issued 에서 바로 ship 가능 (서버 가드 동일).
    try {
      await shipMutation.mutateAsync(issuedInvoiceId);
      toast.success('배송 처리가 완료되었습니다.');
      refetchInvoice();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '배송 처리에 실패했습니다.');
    }
  };

  const handleCancel = async () => {
    if (!issuedInvoiceId) return;
    try {
      await cancelMutation.mutateAsync(issuedInvoiceId);
      toast.success('송장이 취소되었습니다.');
      setIssuedInvoiceId(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '취소에 실패했습니다.');
    }
  };

  const isProviderMethod =
    issueMethod === 'hanjin' || issueMethod === 'goodsflow';
  const canPrint = invoiceDetail?.status === 'issued' && isProviderMethod;
  const isDirectOrSelf = issueMethod === 'direct' || issueMethod === 'self';
  const canShip = isDirectOrSelf
    ? invoiceDetail?.status === 'issued' || invoiceDetail?.status === 'printed'
    : invoiceDetail?.status === 'printed';
  const isCanceled = invoiceDetail?.status === 'canceled';

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {/* 발행 폼 */}
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">송장 발행</h3>

        <div className="flex flex-col gap-1">
          <Label>주문처리 ID</Label>
          <Input
            placeholder="Fulfillment Order ID"
            value={foId}
            onChange={(e) => setFoId(e.target.value)}
            disabled={!!issuedInvoiceId}
          />
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label>택배사</Label>
            {/* hanjin 발행은 서버에서 carrier 를 HANJIN 으로 강제하므로 선택 잠금 */}
            <Select
              value={carrierCode}
              onValueChange={setCarrierCode}
              disabled={!!issuedInvoiceId || issueMethod === 'hanjin'}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARRIER_CODES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label>발행 방식</Label>
            <Select
              value={issueMethod}
              onValueChange={(v) => {
                const method = v as InvoiceIssueMethod;
                setIssueMethod(method);
                if (method === 'hanjin') setCarrierCode('HANJIN');
              }}
              disabled={!!issuedInvoiceId}
            >
              <SelectTrigger>
                <SelectValue placeholder="발행 방식 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hanjin">한진택배 (API)</SelectItem>
                <SelectItem value="direct">
                  직접 입력 (운송장 번호 필요)
                </SelectItem>
                <SelectItem value="self">자체 발행</SelectItem>
                <SelectItem value="goodsflow">Goodsflow (구)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {issueMethod === 'direct' && (
          <div className="flex flex-col gap-1">
            <Label>운송장 번호</Label>
            <Input
              placeholder="택배사에서 발급받은 실제 운송장 번호"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              disabled={!!issuedInvoiceId}
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label>수취인 이름</Label>
          <Input
            placeholder="홍길동"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            disabled={!!issuedInvoiceId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>수취인 주소</Label>
          <Input
            placeholder="서울시 강남구..."
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            disabled={!!issuedInvoiceId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>수취인 전화번호</Label>
          <Input
            placeholder="010-1234-5678"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            disabled={!!issuedInvoiceId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>배송 메시지</Label>
          <Input
            placeholder="문 앞에 두세요 (선택)"
            value={deliveryMessage}
            onChange={(e) => setDeliveryMessage(e.target.value)}
            disabled={!!issuedInvoiceId}
          />
        </div>

        {!issuedInvoiceId ? (
          <Button
            onClick={handleIssue}
            disabled={issueMutation.isPending || !issueMethod}
          >
            {issueMutation.isPending ? '발행 중…' : '송장 발행'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            송장 ID: <span className="font-mono">{issuedInvoiceId}</span>
          </p>
        )}
      </div>

      {/* 발행 후 액션 */}
      {issuedInvoiceId && !isCanceled && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">발행된 송장</h3>
            {invoiceDetail?.status && (
              <Badge variant="secondary">{invoiceDetail.status}</Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={!canPrint || printMutation.isPending}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printMutation.isPending ? '출력 중…' : '송장 출력'}
            </Button>

            <Button
              variant="outline"
              onClick={handleShip}
              disabled={!canShip || shipMutation.isPending}
            >
              <Truck className="mr-2 h-4 w-4" />
              {shipMutation.isPending ? '처리 중…' : '배송 처리'}
            </Button>

            <Button
              variant="ghost"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              className="text-destructive hover:text-destructive"
            >
              {cancelMutation.isPending ? '취소 중…' : '송장 취소'}
            </Button>
          </div>

          {isDirectOrSelf && (
            <p className="text-xs text-muted-foreground">
              direct/self 방식은 발행 즉시 배송 처리가 가능합니다 (송장 출력
              불필요).
            </p>
          )}
        </div>
      )}

      {isCanceled && (
        <p className="text-sm text-destructive">해당 송장은 취소되었습니다.</p>
      )}
    </div>
  );
}
