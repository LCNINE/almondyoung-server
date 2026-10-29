'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrderReturnable, useRequestCustomerReturn } from '@/lib/services/customer-returns';
import { useMedusaOrderById } from '@/lib/services/medusa-customers/queries';
import type { CustomerReturnKind } from '@/lib/types/dto/customer-returns';
import { RETURN_FEE_BEARER_LABELS, RETURN_KIND_LABELS } from '../../customer-return-labels';
import {
  buildReturnRequestBody,
  reasonOptionsFor,
  returnRejectMessage,
  windowOverrideNeeded,
  withKind,
  type ReturnRequestForm,
} from '../../return-request-form';

const KINDS: CustomerReturnKind[] = ['return', 'exchange'];

interface Props {
  /** Medusa 주문 id (주문 목록 행의 channelOrderId) */
  orderId: string;
  onClose: () => void;
}

/** 열 때마다 새로 마운트되어야 request_id 가 한 번 만들어진다 — 부모는 열렸을 때만 그린다 */
export function RequestReturnDialog({ orderId, onClose }: Props) {
  // N8: 같은 제출을 다시 눌러도 같은 반품이 되게 열 때 한 번만 만든다
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<ReturnRequestForm>({
    kind: 'return',
    quantities: {},
    reason: '',
    note: '',
    feeBearer: null,
    windowOverrideReason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const returnableQ = useOrderReturnable(orderId);
  const orderQ = useMedusaOrderById(orderId);
  const request = useRequestCustomerReturn();

  const returnable = returnableQ.data;
  const lines = (returnable?.items ?? []).filter((i) => i.returnable_quantity > 0);
  const exchange = form.kind === 'exchange';
  const nameOf = (itemId: string) => {
    const it = orderQ.data?.order?.items?.find((x) => x.id === itemId);
    if (!it) return itemId;
    return [it.product_title ?? it.title, it.variant_title].filter(Boolean).join(' · ');
  };

  const loading = returnableQ.isLoading || orderQ.isLoading;
  const needsOverride = returnable ? windowOverrideNeeded(form, returnable, new Date()) : false;

  const patch = (p: Partial<ReturnRequestForm>) => {
    setError(null);
    setForm((f) => ({ ...f, ...p }));
  };

  const changeKind = (kind: CustomerReturnKind) => {
    if (!returnable) return;
    setError(null);
    setForm((f) => withKind(f, kind, returnable));
  };

  const submit = () => {
    if (!returnable) return;
    const built = buildReturnRequestBody(form, returnable, requestId, new Date());
    if (!built.ok) {
      setError(built.error);
      return;
    }
    request.mutate(
      { orderId, body: built.body },
      {
        onSuccess: () => {
          toast.success(
            `${RETURN_KIND_LABELS[form.kind]}을 접수했습니다 — 반품·교환 목록에는 5분 안에 나타납니다`
          );
          onClose();
        },
        onError: (e) => setError(returnRejectMessage(e)),
      }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !request.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>반품·교환 접수</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : returnableQ.isError || !returnable ? (
          <p className="text-sm text-red-600">{returnRejectMessage(returnableQ.error)}</p>
        ) : lines.length === 0 ? (
          <>
            <p className="text-sm">반품할 수 있는 수량이 없습니다</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                닫기
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <RadioGroup
                className="flex gap-4"
                value={form.kind}
                onValueChange={(v) => changeKind(v === 'exchange' ? 'exchange' : 'return')}
              >
                {KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1 text-sm">
                    <RadioGroupItem value={k} />
                    {RETURN_KIND_LABELS[k]}
                  </label>
                ))}
              </RadioGroup>

              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.item_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{nameOf(l.item_id)}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {exchange && !l.exchangeable ? '교환 불가(인쇄 상품)' : `가능 ${l.returnable_quantity}`}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={l.returnable_quantity}
                      disabled={exchange && !l.exchangeable}
                      className="w-20 h-8"
                      value={form.quantities[l.item_id] ?? 0}
                      onChange={(e) =>
                        patch({
                          quantities: { ...form.quantities, [l.item_id]: Number(e.target.value) || 0 },
                        })
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label>사유</Label>
                <Select value={form.reason} onValueChange={(v) => patch({ reason: v })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="사유 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {reasonOptionsFor(form.kind).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.reason === 'other' && exchange && (
                <p className="text-sm text-muted-foreground">교환 배송비는 판매자가 부담합니다</p>
              )}

              {form.reason === 'other' && !exchange && (
                <div className="space-y-1">
                  <Label>배송비 부담</Label>
                  <RadioGroup
                    className="flex gap-4"
                    value={form.feeBearer ?? ''}
                    onValueChange={(v) => patch({ feeBearer: v === 'customer' || v === 'seller' ? v : null })}
                  >
                    {(['customer', 'seller'] as const).map((b) => (
                      <label key={b} className="flex items-center gap-1 text-sm">
                        <RadioGroupItem value={b} />
                        {RETURN_FEE_BEARER_LABELS[b]}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}

              {needsOverride && (
                <div className="space-y-1">
                  <Label>기한 넘김 사유</Label>
                  <Input
                    value={form.windowOverrideReason}
                    onChange={(e) => patch({ windowOverrideReason: e.target.value })}
                    placeholder="반품 기한이 지난 품목이 포함되어 있습니다"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label>메모</Label>
                <Textarea rows={2} value={form.note} onChange={(e) => patch({ note: e.target.value })} />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={request.isPending}>
                취소
              </Button>
              <Button onClick={submit} disabled={request.isPending}>
                {request.isPending ? '접수 중…' : '접수'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
