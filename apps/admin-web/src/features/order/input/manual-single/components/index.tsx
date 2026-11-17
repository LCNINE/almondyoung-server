// src/features/order/input/manual-single/components/index.tsx
'use client';

import { useCreateSalesOrder } from '@/lib/services/orders';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerSearchDialog } from './CustomerSearchDialog';
import {
  ProductSearchDialog,
  type ProductSearchPick,
} from './product-search-dialog';
import {
  buildManualOrder,
  describeSaveError,
  generateManualOrderNo,
  type ManualOrderField,
} from '../../lib/manual-order';

// -------------------------
type OrderLine = {
  id: string;
  refId: string;
  name: string;
  optionText?: string;
  variantId: string;
  quantity: number;
  /** 가격을 모르는 상품은 null — 작업자가 단가를 입력한다. */
  price: number | null;
};

type Customer = {
  name: string;
  phone: string;
  email?: string;
};

type Address = {
  name: string;
  phone: string;
  zip?: string;
  addr1?: string;
  addr2?: string;
  msg?: string;
};

// -------------------------
const toOrderLine = (p: ProductSearchPick): Omit<OrderLine, 'id'> => ({
  refId: p.masterId,
  name: p.name,
  optionText: p.optionText,
  variantId: p.variantId,
  quantity: 1,
  price: p.price,
});

// -------------------------
export default function ManualSingleOrderPage() {
  const router = useRouter();
  const createOrder = useCreateSalesOrder();

  // 임의 번호라 서버 렌더와 어긋나지 않게 브라우저에서 만든다
  const [orderNo, setOrderNo] = useState('');
  useEffect(() => {
    setOrderNo((current) => current || generateManualOrderNo());
  }, []);
  // 저장 전 검증·저장 실패 안내. 입력값은 지우지 않는다.
  const [issues, setIssues] = useState<
    { field: ManualOrderField | 'save'; message: string }[]
  >([]);

  // 고객/배송지
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [buyer, setBuyer] = useState<Customer>({
    name: '',
    phone: '',
    email: '',
  });
  const [recipient, setRecipient] = useState<Address>({
    name: '',
    phone: '',
    msg: '',
  });
  const [addrDialogOpen, setAddrDialogOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);

  // 라인/메모
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [memo, setMemo] = useState('');

  // 합계
  const totalQty = useMemo(
    () => lines.reduce((a, b) => a + Number(b.quantity || 0), 0),
    [lines]
  );
  const totalAmt = useMemo(
    () =>
      lines.reduce(
        (a, b) => a + Number(b.quantity || 0) * Number(b.price || 0),
        0
      ),
    [lines]
  );

  const unpricedCount = lines.filter((l) => l.price == null).length;

  const addLine = (l: Omit<OrderLine, 'id'>) =>
    setLines((prev) => [{ ...l, id: crypto.randomUUID() }, ...prev]);
  const updateLine = (id: string, patch: Partial<OrderLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const handleSubmit = () => {
    const built = buildManualOrder({
      orderNo,
      customerId,
      buyer,
      recipient: {
        name: recipient.name,
        phone: recipient.phone,
        postalCode: recipient.zip ?? '',
        roadAddress: recipient.addr1 ?? '',
        detailAddress: recipient.addr2 ?? '',
        deliveryNote: recipient.msg,
      },
      lines: lines.map((l) => ({
        variantId: l.variantId,
        label:
          l.optionText && l.optionText !== l.name
            ? `${l.name} / ${l.optionText}`
            : l.name,
        quantity: Number(l.quantity),
        unitPrice: l.price,
      })),
      memo,
    });
    if (!built.payload) {
      setIssues(built.issues);
      toast.error('저장하기 전에 아래 항목을 확인해 주세요.');
      return;
    }
    setIssues([]);
    createOrder.mutate(built.payload, {
      onSuccess: () => {
        toast.success(
          `주문 ${built.payload.channelOrderId} 을 저장했습니다. 출고 준비로 넘어갑니다.`
        );
        router.push('/order/history');
      },
      onError: (err: unknown) => {
        const { message } = describeSaveError(err);
        setIssues([{ field: 'save', message }]);
        toast.error(message);
      },
    });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">주문입력(수동/개별)</h1>
      <p className="text-sm text-muted-foreground">
        주문건을 수동으로 입력하는 페이지
      </p>

      <Section title="주문 정보">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>판매채널</Label>
            <p className="text-sm">수기·기타</p>
            <p className="text-xs text-muted-foreground">
              전화·방문·미연동 쇼핑몰 주문을 입력합니다. 자사몰·스마트스토어·쿠팡
              주문은 자동으로 들어오니 여기서 다시 입력하지 마세요. 저장하면
              바로 출고 준비로 넘어가고, 출고 창고는 출고 준비에서 정해집니다.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-order-no">주문번호</Label>
            <div className="flex gap-2">
              <Input
                id="manual-order-no"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrderNo(generateManualOrderNo())}
              >
                자동생성
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              같은 주문번호로는 한 번만 저장됩니다.
            </p>
          </div>
        </div>
      </Section>

      {/* 고객 / 주문자 */}
      <Section title="고객/주문자">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="고객 선택 (회원이면)">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCustomerDialogOpen(true)}
              >
                유저검색
              </Button>
              {customerId && (
                <span className="self-center text-xs text-muted-foreground">
                  선택된 고객 ID: {customerId}
                </span>
              )}
            </div>
          </Field>
          <Field label="주문자 성명">
            <Input
              value={buyer.name}
              onChange={(e) => setBuyer({ ...buyer, name: e.target.value })}
            />
          </Field>
          <Field label="핸드폰">
            <Input
              value={buyer.phone}
              onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
            />
          </Field>
          <Field label="이메일">
            <Input
              value={buyer.email}
              onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      {/* 수취인 */}
      <Section title="수취인 정보" subtitle="배송과 관련된 정보">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="수취인 성명">
            <Input
              value={recipient.name}
              onChange={(e) =>
                setRecipient({ ...recipient, name: e.target.value })
              }
            />
          </Field>
          <Field label="핸드폰">
            <Input
              value={recipient.phone}
              onChange={(e) =>
                setRecipient({ ...recipient, phone: e.target.value })
              }
            />
          </Field>
          <Field label="우편번호">
            <div className="flex gap-2">
              <Input
                placeholder="우편번호"
                value={recipient.zip || ''}
                onChange={(e) =>
                  setRecipient({ ...recipient, zip: e.target.value })
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddrDialogOpen(true)}
              >
                주소검색
              </Button>
            </div>
          </Field>
          <Field label="주소">
            <Input
              placeholder="주소 1"
              value={recipient.addr1 || ''}
              onChange={(e) =>
                setRecipient({ ...recipient, addr1: e.target.value })
              }
            />
          </Field>
          <Field label="상세주소">
            <Input
              placeholder="없으면 '없음'"
              value={recipient.addr2 || ''}
              onChange={(e) =>
                setRecipient({ ...recipient, addr2: e.target.value })
              }
            />
          </Field>
          <Field label="배송메모">
            <Input
              placeholder="예: 문 앞에 놔주세요"
              value={recipient.msg || ''}
              onChange={(e) =>
                setRecipient({ ...recipient, msg: e.target.value })
              }
            />
          </Field>
        </div>

        {/* 주소 검색 다이얼로그 */}
        <AddressSearchDialog
          open={addrDialogOpen}
          onOpenChange={setAddrDialogOpen}
          onSelect={({ zipcode, address }) => {
            setRecipient((prev) => ({ ...prev, zip: zipcode, addr1: address }));
          }}
          title="주소 검색"
        />
      </Section>

      {/* 주문상품 */}
      <Section title="주문상품 정보입력">
        <div className="flex items-center justify-between">
          <ProductSearchDialog onPick={(p) => addLine(toOrderLine(p))} />
          <div className="text-sm text-muted-foreground">
            총 {totalQty}개 / 합계 {totalAmt.toLocaleString()} 원
            {unpricedCount > 0
              ? ` (단가 미입력 ${unpricedCount}개 제외)`
              : ''}
          </div>
        </div>

        <div className="mt-4 overflow-hidden border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">상품명</TableHead>
                <TableHead>옵션</TableHead>
                <TableHead className="w-24 text-right">수량</TableHead>
                <TableHead className="w-32 text-right">단가(원)</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    상품을 추가하세요.
                  </TableCell>
                </TableRow>
              )}
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="align-top">
                    <div className="font-medium">{l.name}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="text-sm">{l.optionText}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(l.id, { quantity: Number(e.target.value) })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      placeholder="단가 입력"
                      value={l.price ?? ''}
                      onChange={(e) =>
                        updateLine(l.id, {
                          price:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(l.id)}
                      aria-label="remove"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      {/* 기타 메모 */}
      <Section title="기타">
        <Textarea
          placeholder="예: 전화 접수, 담당 홍길동"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </Section>

      {issues.length > 0 && (
        <div
          role="alert"
          className="p-4 space-y-1 text-sm border rounded-lg border-destructive/40 bg-destructive/5 text-destructive"
        >
          {issues.map((issue, i) => (
            <p key={i}>{issue.message}</p>
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <Button
          className="px-10 text-white bg-orange-500 hover:bg-orange-600"
          onClick={handleSubmit}
          disabled={createOrder.isPending}
        >
          {createOrder.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>

      {/* 고객 검색 모달 (ID/Email) */}
      <CustomerSearchDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        onSelect={(u) => {
          setCustomerId(u.id);
          setBuyer((b) => ({
            ...b,
            name: u.name || b.name,
            email: u.email || b.email,
            phone: u.phone || b.phone, // ✅ 전화 자동 채우기
          }));
        }}
        title="고객 검색"
      />
    </div>
  );
}

// -------------------------
function Section({
  title,
  subtitle,
  children,
}: React.PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <div className="p-4 space-y-4 bg-white border rounded-lg md:p-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: React.PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <div className={className}>
      <Label className="block mb-1">{label}</Label>
      {children}
    </div>
  );
}
