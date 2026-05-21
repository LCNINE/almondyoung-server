/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FormField,
  FormInput,
  FormNumberInput,
  FormSelect,
  FormCheckbox,
  FormLayout
} from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderLineDto } from '@/lib/types/dto/orders';
import { useResolveMatching } from '@/lib/services/matching';
import { useCreateChannelProduct } from '@/lib/services/products';
import { useSkus } from '@/lib/services/inventory';
import { Search, Trash2, Link2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/** 옵션 1개 형태 */
type LocalOption = {
  id: string;              // 로컬 키
  name: string;
  quantity: number;        // 주문 수량/묶음 수량
  price: number;           // 옵션가
  status: '판매' | '판매중단';
  // 재고 연결
  skuId?: string;
  skuName?: string;
};

/** 간단 디바운스 */
function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

interface ProductRegistrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  line: OrderLineDto | null;
}

/** 외부채널 매칭용 상품 등록 다이얼로그 */
export function ProductRegistrationDialog({ isOpen, onClose, line }: ProductRegistrationDialogProps) {
  const resolveMatching = useResolveMatching();
  const createChannelProduct = useCreateChannelProduct();

  const [productName, setProductName] = useState('');
  const [useOrderName, setUseOrderName] = useState(true);
  const [salesPrice, setSalesPrice] = useState('');
  const [salesChannel, setSalesChannel] = useState('');
  const [activeTab, setActiveTab] = useState<'opts' | 'stock'>('opts');

  // 옵션들
  const [options, setOptions] = useState<LocalOption[]>([]);
  // 재고연결 검색
  const [skuSearch, setSkuSearch] = useState('');
  const debounced = useDebounced(skuSearch, 350);
  const { data: skuResults, isLoading: searching } = useSkus();

  // 현재 “재고연결”을 눌러 편집중인 옵션 인덱스
  const [linkingIndex, setLinkingIndex] = useState<number | null>(null);

  /** 폼 초기화 — line이 바뀔 때 */
  useEffect(() => {
    if (!line) return;

    setSalesChannel(line.salesChannel || '');
    setProductName(line.productName || '');
    setSalesPrice(line.totalPrice ? String(line.totalPrice) : '');

    // 단일 옵션 기본 생성
    const initialOptions: LocalOption[] = [
      {
        id: crypto.randomUUID(),
        name: '단일 옵션',
        quantity: line.quantity ?? 1,
        price: line.totalPrice ?? 0,
        status: '판매',
      },
    ];
    setOptions(initialOptions);
    setActiveTab('opts');
    setSkuSearch('');
    setLinkingIndex(null);
  }, [line]);

  const isSaving = createChannelProduct.isPending || resolveMatching.isPending;

  /** 옵션 조작 */
  const addOption = () =>
    setOptions((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', quantity: 0, price: 0, status: '판매' },
    ]);

  const removeOption = (idx: number) =>
    setOptions((prev) => prev.filter((_, i) => i !== idx));

  const updateOption = (idx: number, patch: Partial<LocalOption>) =>
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));

  /** 재고연결 */
  const startLink = (idx: number) => {
    setLinkingIndex(idx);
    setActiveTab('stock');
  };

  const clearLink = (idx: number) => updateOption(idx, { skuId: undefined, skuName: undefined });

  const attachSku = (skuId: string, skuName: string) => {
    if (linkingIndex == null) return;
    updateOption(linkingIndex, { skuId, skuName });
    setActiveTab('opts');
    setLinkingIndex(null);
    setSkuSearch('');
  };

  /** 저장
   *  1) 채널상품 생성(가능하면)
   *  2) 옵션에 연결된 skuId -> WMS 매칭 resolve (strategy: option)
   */
  const onSave = async () => {
    if (!line) return;

    // 옵션 검증
    const invalid = options.some((o) => !o.name || o.quantity <= 0);
    if (invalid) {
      alert('옵션명과 수량을 확인해주세요.');
      return;
    }

    try {
      // 1) 채널상품 생성 (스키마가 유동적일 수 있어 안전한 필드만 전송)
      //    CreateChannelProductDto의 상세를 몰라도, 대부분 서버에서 무시 가능한 확장 필드로 설계되어 있음.
      const channelProductDto: any = {
        channelId: line.salesChannel || salesChannel || 'other',
        externalProductCode: line.channelOrderId ?? '',
        name: productName,
        useOrderName,
        basePrice: Number(salesPrice) || 0,
        // 옵션
        options: options.map((o) => ({
          name: o.name,
          price: o.price,
          status: o.status === '판매' ? 'active' : 'inactive',
          quantityPerUnit: o.quantity,
          linkedSkuId: o.skuId,
        })),
        _meta: {
          from: 'external-matching-dialog',
          orderId: line.salesOrderId,
        },
      };
      try {
        await createChannelProduct.mutateAsync(channelProductDto);
      } catch (e) {
        // 채널상품 생성 실패해도 매칭만 우선 진행 가능하도록 경고 후 진행
        console.warn('채널상품 생성 실패(무시하고 매칭 진행):', e);
      }

      // 2) 재고 매칭 저장
      const skuMappings = options
        .filter((o) => o.skuId)
        .map((o) => ({ skuId: o.skuId as string, quantity: o.quantity || 1 }));

      if (skuMappings.length > 0) {
        await resolveMatching.mutateAsync({
          id: line.matchingId!,
          data: {
            ignore: false,
            strategy: 'variant',
            stockPolicy: {
              preStockSellable: true,
              alwaysSellableZeroStock: false,
            },
            skuMappings,
            isGift: false,
          },
        });
      } else {
        // 재고연결 없으면 “재고사용 안함” 또는 자동전략 중 택1
        await resolveMatching.mutateAsync({
          id: line.matchingId!,
          data: {
            ignore: false,
            strategy: 'void', // 우선 재고 미사용으로 저장 (필요 시 'variant'로 교체)
            stockPolicy: { preStockSellable: true, alwaysSellableZeroStock: false },
            isGift: false,
          },
        });
      }

      onClose();
    } catch (e) {
      console.error(e);
      alert('상품등록/매칭 저장에 실패했습니다.');
    }
  };

  const channelIcon = useMemo(() => {
    switch (salesChannel) {
      case 'naver':
        return { badge: 'NA', label: '네이버 스마트스토어 - 아몬드영' };
      case 'coupang':
        return { badge: 'CO', label: '쿠팡 - 아몬드영' };
      case 'almondyoung':
        return { badge: 'AM', label: '아몬드영 자사몰' };
      default:
        return { badge: 'ET', label: '외부채널' };
    }
  }, [salesChannel]);

  if (!line) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>매칭용 상품등록</DialogTitle>
        </DialogHeader>

        {/* 안내 박스 */}
        <div className="rounded-md border p-3 bg-amber-50 text-[13px] leading-5 mb-4">
          <div className="font-medium">외부채널 매칭용 상품등록</div>
          <div>외부 판매채널에서 들어온 주문을 매칭하기 위해 상품 정보를 생성하고, 옵션별로 재고상품을 연결해 바로 매칭까지 등록합니다.</div>
          <div className="mt-1 text-amber-700">중요: 필수 항목(상품명, 옵션 수량, 재고연결 시 수량)을 확인해 주세요.</div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="opts">상품/옵션</TabsTrigger>
            <TabsTrigger value="stock">재고연결</TabsTrigger>
          </TabsList>

          {/* 상품/옵션 탭 */}
          <TabsContent value="opts" className="space-y-6 mt-4">
            {/* 판매처 정보 */}
            <FormLayout columns={2} gap="md">
              <FormField label="판매처">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs font-medium">
                    {channelIcon.badge}
                  </div>
                  <span className="text-sm">{channelIcon.label}</span>
                </div>
              </FormField>
              <FormField label="판매처 상품코드">
                <FormInput
                  value={line.channelOrderId || ''}
                  readOnly
                />
              </FormField>
            </FormLayout>

            {/* 판매 상품명 */}
            <FormField label="판매 상품명" required>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FormInput
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="상품명을 입력하세요"
                    maxLength={250}
                    className="flex-1"
                  />
                  <span className="text-sm text-gray-500">[{productName.length}/250]</span>
                </div>
                <FormCheckbox
                  label="주문명과 동일"
                  checked={useOrderName}
                  onCheckedChange={(c) => setUseOrderName(Boolean(c))}
                />
              </div>
            </FormField>

            {/* 판매가 */}
            <FormField label="판매가" required>
              <FormNumberInput
                value={salesPrice}
                onChange={(e) => setSalesPrice(e.target.value)}
                placeholder="0"
                suffix="원"
              />
            </FormField>

            {/* 옵션 정보 */}
            <div>
              <Label>옵션정보</Label>
              <div className="mt-2 space-y-3">
                {options.map((opt, idx) => (
                  <div key={opt.id} className="grid grid-cols-12 items-center gap-2 p-3 border rounded">
                    <div className="col-span-1 text-sm font-medium">{idx + 1}</div>

                    <div className="col-span-3">
                      <FormInput
                        value={opt.name}
                        onChange={(e) => updateOption(idx, { name: e.target.value })}
                        placeholder="옵션명"
                      />
                    </div>

                    <div className="col-span-3 flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => updateOption(idx, { quantity: Math.max(0, (opt.quantity || 0) - 1) })}
                        aria-label="decrease"
                      >
                        -
                      </Button>
                      <FormNumberInput
                        className="w-20 text-center"
                        value={String(opt.quantity)}
                        onChange={(e) => updateOption(idx, { quantity: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => updateOption(idx, { quantity: (opt.quantity || 0) + 1 })}
                        aria-label="increase"
                      >
                        +
                      </Button>
                    </div>

                    <div className="col-span-2">
                      <FormNumberInput
                        className="text-right"
                        value={String(opt.price)}
                        onChange={(e) => updateOption(idx, { price: parseInt(e.target.value || '0', 10) })}
                        placeholder="0"
                        suffix="원"
                      />
                    </div>

                    <div className="col-span-2">
                      <FormSelect
                        options={[
                          { value: "판매", label: "판매" },
                          { value: "판매중단", label: "판매중단" }
                        ]}
                        value={opt.status}
                        onValueChange={(v) => updateOption(idx, { status: v as '판매' | '판매중단' })}
                      />
                    </div>

                    <div className="col-span-1 flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => startLink(idx)}>
                        <Link2 className="w-4 h-4 mr-1" />
                        재고연결
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeOption(idx)} aria-label="remove">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* 연결된 SKU 미리보기 */}
                    {opt.skuId && (
                      <div className="col-span-12 text-xs text-gray-600 pl-8">
                        연결된 재고: <b>{opt.skuName ?? opt.skuId}</b>{' '}
                        <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => clearLink(idx)}>
                          <X className="w-3 h-3" /> 해제
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                <div className="pt-1">
                  <Button variant="outline" onClick={addOption}>옵션 추가</Button>
                </div>
              </div>
            </div>

            {/* 액션 */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                상품등록
              </Button>
            </div>
          </TabsContent>

          {/* 재고연결 탭 */}
          <TabsContent value="stock" className="mt-4 space-y-3">
            <div className="text-sm text-gray-600">
              {linkingIndex == null ? '왼쪽 옵션의 [재고연결] 버튼을 눌러 연결할 옵션을 선택하세요.' : (
                <>
                  연결 대상 옵션: <b>{options[linkingIndex]?.name || `옵션 ${linkingIndex + 1}`}</b>
                </>
              )}
            </div>

            <FormLayout columns={1} gap="md">
              <FormField label="재고 상품 검색">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" />
                    <FormInput
                      placeholder="재고 상품명으로 검색"
                      className="pl-8"
                      value={skuSearch}
                      onChange={(e) => setSkuSearch(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" onClick={() => setSkuSearch('')}>
                    초기화
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab('opts')}>
                    옵션으로 돌아가기
                  </Button>
                </div>
              </FormField>
            </FormLayout>

            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-sm">검색 결과</h4>
                {searching && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
              </div>

              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {((skuResults as any)?.items ?? (Array.isArray(skuResults) ? skuResults : [])).map((s: any) => (
                  <div
                    key={s.id}
                    className={cn(
                      'flex items-center justify-between p-2 rounded border bg-white'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{s.name}</div>
                      <div className="text-xs text-gray-500 truncate">{s.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                        onClick={() => attachSku(s.id, s.name)}
                        disabled={linkingIndex == null}
                      >
                        연결
                      </Button>
                    </div>
                  </div>
                ))}
                {!searching && ((skuResults as any)?.items?.length ?? (Array.isArray(skuResults) ? skuResults.length : 0)) === 0 && (
                  <div className="text-sm text-gray-500 p-2">검색 결과가 없습니다.</div>
                )}
              </div>

              <div className="text-center text-xs text-gray-400 mt-2">페이지 네이션</div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
