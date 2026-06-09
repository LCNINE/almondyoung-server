'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Search, X } from 'lucide-react';
import { useWarehouses, useSkus } from '@/lib/services/inventory/queries';
import { useCreateFulfillmentOrder } from '@/lib/services/orders/mutations';
import type {
  FulfillmentMode,
  FulfillmentOrderPriority,
  CreateStandaloneFulfillmentRequest,
  FulfillmentShippingAddress,
} from '@/lib/types/dto/fulfillment';

type DraftItem = {
  skuId: string;
  label: string; // "{code} {name}"
  quantity: number;
};

const EMPTY_ADDRESS: FulfillmentShippingAddress = {
  recipientName: '',
  phone: '',
  postalCode: '',
  roadAddress: '',
  detailAddress: '',
  deliveryNote: '',
};

export function ManualCreateForm() {
  const router = useRouter();
  const { data: warehouses } = useWarehouses();
  const createMutation = useCreateFulfillmentOrder();

  const [warehouseId, setWarehouseId] = useState('');
  const [fulfillmentMode, setFulfillmentMode] =
    useState<FulfillmentMode>('in_house');
  const [priority, setPriority] = useState<FulfillmentOrderPriority>('normal');
  const [items, setItems] = useState<DraftItem[]>([]);

  // SKU 검색
  const [keywordInput, setKeywordInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const { data: skuResult, isFetching: skuLoading } = useSkus({
    name: searchKeyword || undefined,
    limit: 10,
  });

  // 배송지 (선택)
  const [useAddress, setUseAddress] = useState(false);
  const [address, setAddress] =
    useState<FulfillmentShippingAddress>(EMPTY_ADDRESS);

  const handleSearch = () => setSearchKeyword(keywordInput.trim());

  const addItem = (skuId: string, code: string, name: string) => {
    setItems((prev) => {
      if (prev.some((i) => i.skuId === skuId)) {
        toast.info('이미 추가된 SKU입니다.');
        return prev;
      }
      return [...prev, { skuId, label: `${code} · ${name}`, quantity: 1 }];
    });
  };

  const updateQty = (skuId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.skuId === skuId ? { ...i, quantity: Math.max(1, quantity) } : i
      )
    );
  };

  const removeItem = (skuId: string) => {
    setItems((prev) => prev.filter((i) => i.skuId !== skuId));
  };

  const addressFilled =
    address.recipientName &&
    address.phone &&
    address.postalCode &&
    address.roadAddress &&
    address.detailAddress;

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast.error('출고 품목을 1개 이상 추가하세요.');
      return;
    }
    if (useAddress && !addressFilled) {
      toast.error('배송지 입력 시 메모를 제외한 모든 항목은 필수입니다.');
      return;
    }

    const payload: CreateStandaloneFulfillmentRequest = {
      warehouseId: warehouseId || undefined,
      fulfillmentMode,
      priority,
      items: items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      ...(useAddress && addressFilled
        ? {
            shippingAddress: {
              ...address,
              deliveryNote: address.deliveryNote || undefined,
            },
          }
        : {}),
    };

    try {
      const created = await createMutation.mutateAsync(payload);
      toast.success('출고주문이 생성되었습니다.');
      router.push(`/order/fulfillments/${created.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '생성에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col w-full gap-y-3">
      <Container className="divide-y-0">
        <Header title="출고주문 수동 생성" />

        <div className="flex flex-col gap-5 p-4">
          {/* 기본 정보 */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label>창고</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="창고 선택 (선택)" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>출고 모드</Label>
              <Select
                value={fulfillmentMode}
                onValueChange={(v) => setFulfillmentMode(v as FulfillmentMode)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_house">자가출고</SelectItem>
                  <SelectItem value="3pl">3PL</SelectItem>
                  <SelectItem value="drop_ship">직배송</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>우선순위</Label>
              <Select
                value={priority}
                onValueChange={(v) =>
                  setPriority(v as FulfillmentOrderPriority)
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">보통</SelectItem>
                  <SelectItem value="high">높음</SelectItem>
                  <SelectItem value="urgent">긴급</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* SKU 검색 + 추가 */}
          <div className="flex flex-col gap-2">
            <Label>출고 품목 (SKU)</Label>
            <div className="flex items-end gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                placeholder="SKU 이름으로 검색"
                className="w-[320px]"
              />
              <Button variant="outline" onClick={handleSearch}>
                <Search className="w-4 h-4 mr-1" />
                검색
              </Button>
            </div>

            {searchKeyword && (
              <div className="overflow-y-auto border rounded-md max-h-48">
                {skuLoading ? (
                  <p className="p-3 text-sm text-muted-foreground">검색 중…</p>
                ) : (skuResult?.items ?? []).length > 0 ? (
                  (skuResult?.items ?? []).map((sku) => (
                    <button
                      key={sku.id}
                      type="button"
                      onClick={() => addItem(sku.id, sku.code, sku.name)}
                      className="flex items-center justify-between w-full px-3 py-2 text-sm text-left hover:bg-muted"
                    >
                      <span>{sku.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {sku.code}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">
                    검색 결과가 없습니다.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 선택된 품목 */}
          {items.length > 0 && (
            <div className="flex flex-col gap-1 p-2 border rounded-md">
              {items.map((item) => (
                <div key={item.skuId} className="flex items-center gap-2 py-1">
                  <span className="flex-1 text-sm">{item.label}</span>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateQty(item.skuId, Number(e.target.value))
                    }
                    className="w-24"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(item.skuId)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* 배송지 (선택) */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={useAddress}
                onCheckedChange={(v) => setUseAddress(!!v)}
              />
              배송지 입력 (선택)
            </label>
            {useAddress && (
              <div className="grid grid-cols-2 gap-3 p-3 border rounded-md">
                <Input
                  placeholder="수령인 이름"
                  value={address.recipientName}
                  onChange={(e) =>
                    setAddress({ ...address, recipientName: e.target.value })
                  }
                />
                <Input
                  placeholder="수령인 연락처"
                  value={address.phone}
                  onChange={(e) =>
                    setAddress({ ...address, phone: e.target.value })
                  }
                />
                <Input
                  placeholder="우편번호"
                  value={address.postalCode}
                  onChange={(e) =>
                    setAddress({ ...address, postalCode: e.target.value })
                  }
                />
                <Input
                  placeholder="도로명 주소"
                  value={address.roadAddress}
                  onChange={(e) =>
                    setAddress({ ...address, roadAddress: e.target.value })
                  }
                />
                <Input
                  placeholder="상세 주소"
                  value={address.detailAddress}
                  onChange={(e) =>
                    setAddress({ ...address, detailAddress: e.target.value })
                  }
                />
                <Input
                  placeholder="배송 메모 (선택)"
                  value={address.deliveryNote ?? ''}
                  onChange={(e) =>
                    setAddress({ ...address, deliveryNote: e.target.value })
                  }
                />
              </div>
            )}
          </div>

          {/* 제출 */}
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={items.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? '생성 중…' : '출고주문 생성'}
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
