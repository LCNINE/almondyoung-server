// src/features/order/input/manual-single/components/index.tsx
'use client';

import { useSkus, useWarehouses } from '@/lib/services/inventory';
import { useCreateSalesOrder } from '@/lib/services/orders';
import {
  useActiveChannels,
  useMasterList,
  useVariantsByMaster,
} from '@/lib/services/products';
import { useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';

import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerSearchDialog } from './CustomerSearchDialog';

// -------------------------
type OrderLine = {
  id: string;
  type: 'product' | 'sku';
  refId: string;
  name: string;
  optionText?: string;
  skuId?: string;
  quantity: number;
  price: number;
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
  isGift?: boolean;
  msg?: string;
};

// -------------------------
const seq = { n: 1 };
const genOrderNo = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const s = String(seq.n++).padStart(4, '0');
  return `SO-${y}${m}${day}-${s}`;
};

// -------------------------
export default function ManualSingleOrderPage() {
  const router = useRouter();
  const { data: channels } = useActiveChannels();
  const { data: warehouses } = useWarehouses();
  const createOrder = useCreateSalesOrder();

  // 쇼핑몰/주문
  const [channelType, setChannelType] = useState<'linked' | 'unsupported'>(
    'linked'
  );
  const [channelId, setChannelId] = useState<string | undefined>();
  const [phoneOrderOwner, setPhoneOrderOwner] = useState('');
  const [orderNo, setOrderNo] = useState(genOrderNo);
  const [warehouseId, setWarehouseId] = useState<string | undefined>();

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
    isGift: true,
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

  const addLine = (l: Omit<OrderLine, 'id'>) =>
    setLines((prev) => [{ ...l, id: crypto.randomUUID() }, ...prev]);
  const updateLine = (id: string, patch: Partial<OrderLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  // 주문 저장 → 실제 API 호출
  const handleSubmit = () => {
    if (!customerId) {
      toast('유저검색 버튼으로 고객을 선택하세요.');
      return;
    }
    if (!warehouseId) {
      toast('출고 창고를 선택하세요.');
      return;
    }
    if (lines.length === 0) {
      toast('주문상품을 1개 이상 추가하세요.');
      return;
    }
    const invalid = lines.find((l) => !l.skuId);
    if (invalid) {
      toast(`${invalid.name}의 SKU가 없습니다.`);
      return;
    }

    const payload = {
      customerId,
      warehouseId,
      items: lines.map((l) => ({
        skuId: String(l.skuId),
        quantity: Number(l.quantity),
        unitPrice: Number(l.price),
      })),
      memo: [
        `ORDER_NO=${orderNo}`,
        channelType === 'linked'
          ? `CHANNEL_ID=${channelId ?? ''}`
          : `PHONE_OWNER=${phoneOrderOwner ?? ''}`,
        recipient.addr1 || recipient.addr2
          ? `SHIP_TO=${[recipient.addr1, recipient.addr2]
              .filter(Boolean)
              .join(' / ')}`
          : '',
        recipient.zip ? `ZIP=${recipient.zip}` : '',
        recipient.msg ? `REQ=${recipient.msg}` : '',
        `QTY=${totalQty}, AMT=${totalAmt}`,
        memo?.trim() ? `MEMO=${memo.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    } as const;

    createOrder.mutate(payload, {
      onSuccess: (res) => {
        toast(`주문 ID: ${res.id}`);
        // 생성 성공 후 주문내역으로 이동
        router.push('/order/history');
      },
      onError: (err: any) => {
        toast(err?.message || '잠시 후 다시 시도해주세요.');
      },
    });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">주문입력(수동/개별)</h1>
      <p className="text-sm text-muted-foreground">
        주문건을 수동으로 입력하는 페이지
      </p>

      {/* 쇼핑몰/주문 기본 */}
      <Section title="쇼핑몰 정보">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>판매채널 선택</Label>
            <RadioGroup
              value={channelType}
              onValueChange={(v) =>
                setChannelType(v as 'linked' | 'unsupported')
              }
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem id="linked" value="linked" />
                <Label htmlFor="linked">쇼핑몰 (연동)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem id="unsupported" value="unsupported" />
                <Label htmlFor="unsupported">쇼핑몰 (미지원)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>주문번호</Label>
            <div className="flex gap-2">
              <Input
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrderNo(genOrderNo())}
              >
                자동생성
              </Button>
            </div>
          </div>

          {channelType === 'linked' && (
            <div className="space-y-2">
              <Label>연동 쇼핑몰</Label>
              <Select
                value={channelId || ''}
                onValueChange={(v) => setChannelId(v)}
              >
                <SelectTrigger className="px-2 border ">
                  <SelectValue placeholder="자사몰 / 스마트스토어 / 쿠팡 ..." />
                </SelectTrigger>
                <SelectContent>
                  {(channels || []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {channelType === 'unsupported' && (
            <div className="space-y-2">
              <Label>전화주문(담당자 이름)</Label>
              <Input
                placeholder="예: 홍길동"
                value={phoneOrderOwner}
                onChange={(e) => setPhoneOrderOwner(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>출고 창고</Label>
            <Select value={warehouseId || ''} onValueChange={setWarehouseId}>
              <SelectTrigger className="px-2 border ">
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses || []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name || w.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      {/* 고객 / 주문자 */}
      <Section title="고객/주문자">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="고객 선택">
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
          <Field label="배송유형" className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={!!recipient.isGift}
                onCheckedChange={(v) =>
                  setRecipient({ ...recipient, isGift: !!v })
                }
                id="gift"
              />
              <Label htmlFor="gift">선물</Label>
            </div>
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
              placeholder="주소 2"
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
          <ProductSearch addLine={addLine} />
          <div className="text-sm text-muted-foreground">
            총 {totalQty}개 / 합계 {totalAmt.toLocaleString()} 원
          </div>
        </div>

        <div className="mt-4 overflow-hidden border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">상품명</TableHead>
                <TableHead>옵션/SKU</TableHead>
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
                    <div className="text-xs text-muted-foreground">
                      {l.type === 'product' ? '판매상품' : '재고상품'}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="text-sm">{l.optionText || l.skuId}</div>
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
                      value={l.price}
                      onChange={(e) =>
                        updateLine(l.id, { price: Number(e.target.value) })
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
          placeholder="기타메모"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </Section>

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

// -------------------------
// 상품 검색 모달
// -------------------------
function ProductSearch({
  addLine,
}: {
  addLine: (l: Omit<OrderLine, 'id'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'product' | 'sku'>('product');
  const [q, setQ] = useState('');

  // 판매상품
  const { data: masters } = useMasterList();

  // 재고상품 (SkuQuery에 search가 없어서 클라이언트 필터)
  const { data: skusRaw } = useSkus();
  const skus = useMemo(() => {
    const arr = (skusRaw ?? []) as any[];
    if (!q) return arr;
    const kw = q.toLowerCase();
    return arr.filter(
      (s) =>
        String(s.name ?? s.title ?? s.id ?? '')
          .toLowerCase()
          .includes(kw) ||
        String(s.id ?? '')
          .toLowerCase()
          .includes(kw)
    );
  }, [skusRaw, q]);

  const onSelectSku = (row: any) => {
    addLine({
      type: 'sku',
      refId: row.id,
      skuId: row.id,
      name: row.name || row.id,
      quantity: 1,
      price: typeof row.price === 'number' ? row.price : 0,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">상품명 검색</Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>상품검색</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'product' | 'sku')}>
          <TabsList>
            <TabsTrigger value="product">판매상품</TabsTrigger>
            <TabsTrigger value="sku">재고상품</TabsTrigger>
          </TabsList>

          {/* 검색바 */}
          <div className="flex gap-2 my-3">
            <Input
              placeholder="상품명/코드 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {/* 판매상품 탭 */}
          <TabsContent value="product" className="space-y-3">
            <div className="overflow-hidden border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>상품명</TableHead>
                    <TableHead className="text-right w-36">옵션선택</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Array.isArray(masters)
                    ? masters
                    : Array.isArray((masters as any)?.data)
                      ? (masters as any).data
                      : []
                  ).map((m: any) => (
                    <MasterRow
                      key={m.id}
                      master={m}
                      onChoose={(v) => {
                        // 옵션 라벨
                        const optionText = buildOptionText(v);
                        addLine({
                          type: 'product',
                          refId: m.id,
                          name: m.name,
                          optionText,
                          skuId: v.skuId ?? v.id,
                          quantity: 1,
                          price:
                            typeof v.price === 'number'
                              ? v.price
                              : (m.basePrice ?? 0),
                        });
                        setOpen(false);
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* 재고상품 탭 */}
          <TabsContent value="sku" className="space-y-3">
            <div className="overflow-hidden border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>이름</TableHead>
                    <TableHead className="text-right w-28">선택</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(skus ?? []).map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono">{s.id}</TableCell>
                      <TableCell>{s.name || '-'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => onSelectSku(s)}>
                          선택
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 개별 마스터(판매상품) 행: 변형(옵션) 로딩 & 옵션/가격 버튼
function MasterRow({
  master,
  onChoose,
}: {
  master: any;
  onChoose: (variant: any) => void;
}) {
  const { data: variants, isLoading } = useVariantsByMaster(master.id);
  const toArray = (v: any): any[] => (Array.isArray(v) ? v : (v?.data ?? []));
  const variantList = toArray(variants);

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{master.name}</div>
        <div className="text-xs text-muted-foreground">
          {isLoading ? '옵션 불러오는 중...' : `${variantList.length}개 옵션`}
        </div>
        <div className="grid grid-cols-1 gap-2 mt-3 md:grid-cols-2 lg:grid-cols-3">
          {variantList.map((v: any) => (
            <Button
              key={v.id}
              variant="secondary"
              size="sm"
              onClick={() => onChoose(v)}
              className="justify-between"
              title={buildOptionText(v)}
            >
              <span className="truncate">{buildOptionText(v)}</span>
              <span className="text-xs text-muted-foreground">
                {(Number.isFinite(v.price)
                  ? Number(v.price)
                  : (master.basePrice ?? 0)
                ).toLocaleString()}
                원
              </span>
            </Button>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right align-top" />
    </TableRow>
  );
}

// 옵션 라벨 조립 유틸: v.options[] 또는 v.attributes[] 또는 name/title
function buildOptionText(v: any) {
  const pairs: string[] = Array.isArray(v?.options)
    ? v.options.map(
        (o: any) => `${o.optionName ?? o.name}:${o.optionValue ?? o.value}`
      )
    : Array.isArray(v?.attributes)
      ? v.attributes.map((o: any) => `${o.name}:${o.value}`)
      : [];

  const text = pairs.filter(Boolean).join(' / ');
  return text || v.name || v.title || v.optionText || v.id;
}
