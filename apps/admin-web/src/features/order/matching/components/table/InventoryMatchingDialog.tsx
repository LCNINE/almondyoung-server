/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/common';
import {
  FormField,
  FormInput,
  FormNumberInput,
  FormSelect,
  FormLayout
} from '@/components/common';
import { OrderLineDto } from '@/lib/types/dto/orders';
import { useResolveMatching } from '@/lib/services/matching';
import { useCreateChannelProduct } from '@/lib/services/products';
import { useSkuSearch } from '@/lib/services/inventory';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useVariant, useMaster } from '@/lib/services/products';
import {
  useWarehouses,
  useSuppliers,
  useCreateSupplier,
  useHolders,
  useHolderSearch,
  useCreateHolder,
  useCreateInventoryMatching,
} from '@/lib/services/inventory';
import { PRODUCT_TYPES } from '@/lib/mock/data/inventory';
import { Search, Trash2, ArrowRight, X, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { SearchDialog } from './SearchDialog';

/** SKU 연결 정보 */
type LinkedSku = {
  skuId: string;
  skuName: string;
  quantity: number;
};

/** 옵션 행 (자동 매칭용) */
type OptionRow = {
  id: string;
  name: string;
  image: string | null;
  price: number;
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

interface InventoryMatchingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  line: OrderLineDto | null;
}

/** 재고 생성/매칭 다이얼로그 (자동/수동/안함) */
export function InventoryMatchingDialog({ isOpen, onClose, line }: InventoryMatchingDialogProps) {
  const resolveMatching = useResolveMatching();
  const createChannelProduct = useCreateChannelProduct();
  const createInventoryMatching = useCreateInventoryMatching();

  const [activeTab, setActiveTab] = useState<'auto' | 'manual' | 'none'>('auto');
  const [showNotice, setShowNotice] = useState(true);

  // 검색 다이얼로그 상태
  const [showSupplierSearch, setShowSupplierSearch] = useState(false);
  const [showHolderSearch, setShowHolderSearch] = useState(false);

  // 필수 필드 검증
  const isFormValid = () => {
    if (!line?.matchingId) return false; // matchingId 없으면 저장 불가
    if (activeTab === 'auto') {
      return !!(productType && supplierId && stockOwnerId && warehouseId && citizenProductName);
    }
    if (activeTab === 'manual') {
      return linkedSkus.length > 0;
    }
    return true; // none 탭
  };

  // 자동 매칭 상태
  const [productType, setProductType] = useState('일반상품');
  const [citizenProductName, setCitizenProductName] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [stockOwnerId, setStockOwnerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [importDeclaration, setImportDeclaration] = useState('');
  const [importCertificate, setImportCertificate] = useState('');
  const [optionDetail, setOptionDetail] = useState('');
  const [usage, setUsage] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [moq, setMoq] = useState('');
  const [memo1, setMemo1] = useState('');
  const [memo2, setMemo2] = useState('');
  const [memo3, setMemo3] = useState('');
  const [memo4, setMemo4] = useState('');

  const [optionRows, setOptionRows] = useState<OptionRow[]>([
    { id: crypto.randomUUID(), name: '', image: null, price: 0 },
    { id: crypto.randomUUID(), name: '', image: null, price: 0 },
    { id: crypto.randomUUID(), name: '', image: null, price: 0 },
    { id: crypto.randomUUID(), name: '', image: null, price: 0 },
  ]);

  // 수동 매칭 상태
  const [linkedSkus, setLinkedSkus] = useState<LinkedSku[]>([]);
  const [skuSearch, setSkuSearch] = useState('');
  const [searchType, setSearchType] = useState('name');
  const debounced = useDebounced(skuSearch, 350);
  const { data: skuResults, isLoading: searching } = useSkuSearch(debounced, 1, 20);

  // 검색 상태
  const [supplierSearch, setSupplierSearch] = useState('');
  const [holderSearch, setHolderSearch] = useState('');
  const [showSupplierCreate, setShowSupplierCreate] = useState(false);
  const [showHolderCreate, setShowHolderCreate] = useState(false);

  // API hooks
  const { data: warehouses, isLoading: loadingWarehouses } = useWarehouses();
  const { data: suppliersResponse } = useSuppliers({ search: supplierSearch || undefined, limit: 50 });
  const searchingSuppliers = false;
  const supplierSearchResults = suppliersResponse;
  const { data: holdersResponse } = useHolders();
  const { data: holderSearchResults, isLoading: searchingHolders } = useHolderSearch(holderSearch);

  // API 응답에서 실제 데이터 추출
  const suppliers = suppliersResponse?.data || [];
  const holders = holdersResponse?.data || [];

  const createSupplier = useCreateSupplier();
  const createHolder = useCreateHolder();

  // 판매 상품 정보 조회
  const { data: variant } = useVariant(line?.variantId || '');
  const { data: master } = useMaster(variant?.masterId || '');

  /** Effect 1 — line이 바뀔 때 전체 리셋 (line 기반 기본값) */
  useEffect(() => {
    if (!line) return;

    const baseName = line.productName || '';
    const basePrice = line.unitPrice ?? 0;

    setCitizenProductName(baseName);
    setProductType('일반상품');
    setSupplierId('');
    setStockOwnerId('');
    setWarehouseId('');
    setImportDeclaration('');
    setImportCertificate('');
    setOptionDetail('');
    setUsage('');
    setProductDescription('');
    setMoq('');
    setMemo1('');
    setMemo2('');
    setMemo3('');
    setMemo4('');
    setCostPrice(basePrice ? String(basePrice) : '');
    setOptionRows([
      { id: crypto.randomUUID(), name: baseName, image: null, price: basePrice },
      { id: crypto.randomUUID(), name: '', image: null, price: 0 },
      { id: crypto.randomUUID(), name: '', image: null, price: 0 },
      { id: crypto.randomUUID(), name: '', image: null, price: 0 },
    ]);
    setActiveTab('auto');
    setLinkedSkus([]);
    setSkuSearch(baseName); // 수동 탭 검색 프리필
    setSearchType('name');
    setShowNotice(true);
  }, [line?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Effect 2 — PIM 데이터 로드 완료 시 프리필 업데이트 */
  useEffect(() => {
    if (!line || (!variant && !master)) return;

    // optionKey 값들을 조합해 옵션 라벨 생성 (e.g. { 색상: "레드", 사이즈: "L" } → "레드 / L")
    const optionLabel = variant?.optionKey && Object.keys(variant.optionKey).length > 0
      ? Object.values(variant.optionKey).join(' / ')
      : null;

    const masterName = master?.name || null;
    const richPrice = variant?.price ?? null;

    // 사입상품명 = 마스터명 (옵션 제외 상품 기본명)
    if (masterName) {
      setCitizenProductName(masterName);
      // 수동 탭 검색: 마스터명으로 (옵션 포함 전체명보다 마스터명이 더 넓은 검색)
      setSkuSearch(masterName);
    }

    // 옵션 첫 번째 행 = 옵션 라벨 (없으면 마스터명)
    const firstRowName = optionLabel || masterName || '';
    if (firstRowName) {
      setOptionRows((prev) => {
        const next = [...prev];
        if (next[0]) next[0] = { ...next[0], name: firstRowName };
        return next;
      });
    }

    if (richPrice != null) {
      setCostPrice(String(richPrice));
      setOptionRows((prev) => {
        const next = [...prev];
        if (next[0]) next[0] = { ...next[0], price: richPrice };
        return next;
      });
    }
  }, [variant?.id, master?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSaving = createChannelProduct.isPending || resolveMatching.isPending || createInventoryMatching.isPending;

  // 수동 탭 판매 상품 카드용 표시명
  const sellingProductName = master?.name || line?.productName || '상품명 없음';
  // optionKey → 사람이 읽기 좋은 라벨
  const sellingProductOption = variant?.optionKey && Object.keys(variant.optionKey).length > 0
    ? Object.entries(variant.optionKey).map(([k, v]) => `${k}: ${v}`).join(', ')
    : variant?.name && master?.name && variant.name !== master.name
      ? variant.name.replace(master.name, '').replace(/^[\s\-]+/, '')
      : '';

  /** 수동 매칭 - SKU 추가 */
  const handleAddSku = (skuId: string, skuName: string) => {
    if (!linkedSkus.find(s => s.skuId === skuId)) {
      setLinkedSkus([...linkedSkus, { skuId, skuName, quantity: 1 }]);
    } else {
      // 이미 추가된 SKU인 경우 사용자에게 알림
      alert('이미 매칭된 재고상품입니다.');
    }
  };

  /** 수동 매칭 - SKU 제거 */
  const handleRemoveSku = (skuId: string) => {
    setLinkedSkus(linkedSkus.filter(s => s.skuId !== skuId));
  };

  /** 수동 매칭 - 수량 업데이트 */
  const handleUpdateQuantity = (skuId: string, value: number) => {
    const quantity = Math.max(1, Math.floor(value)); // 최소 1, 정수만 허용
    setLinkedSkus(linkedSkus.map(s =>
      s.skuId === skuId
        ? { ...s, quantity }
        : s
    ));
  };

  /** 자동 매칭 - 옵션 행 업데이트 */
  const updateOptionRow = (id: string, field: keyof OptionRow, value: any) => {
    setOptionRows(optionRows.map(row =>
      row.id === id ? { ...row, [field]: value } : row
    ));
  };

  /** 이미지 업로드 핸들러 */
  const handleImageUpload = (rowId: string, file: File) => {
    // 실제 구현에서는 서버에 업로드하고 URL을 받아야 함
    // 여기서는 임시로 Object URL 사용
    const imageUrl = URL.createObjectURL(file);
    updateOptionRow(rowId, 'image', imageUrl);
  };

  /** 대표원가 적용 */
  const handleApplyRepresentativeCost = () => {
    const cost = Number(costPrice) || 0;
    setOptionRows(optionRows.map(row => ({ ...row, price: cost })));
  };


  /** 공급처 신규 등록 */
  const handleCreateSupplier = async () => {
    const name = prompt('공급처명을 입력하세요:');
    if (name) {
      try {
        const newSupplier = await createSupplier.mutateAsync({ name });
        setSupplierId(newSupplier.id);
        setSupplierSearch(newSupplier.name);
        setShowSupplierCreate(false);
        alert('공급처가 성공적으로 생성되었습니다.');
      } catch (error) {
        console.error('공급처 생성 실패:', error);
        alert('공급처 생성에 실패했습니다. 다시 시도해주세요.');
      }
    }
  };

  /** 재고소유 신규 등록 */
  const handleCreateHolder = async () => {
    const name = prompt('재고소유명을 입력하세요:');
    const isOurAsset = confirm('자사 자산인가요?');
    if (name) {
      try {
        const newHolder = await createHolder.mutateAsync({
          name,
          isOurAsset,
        });
        setStockOwnerId(newHolder.id);
        setHolderSearch(newHolder.name);
        setShowHolderCreate(false);
        alert('재고소유가 성공적으로 생성되었습니다.');
      } catch (error) {
        console.error('재고소유 생성 실패:', error);
        alert('재고소유 생성에 실패했습니다. 다시 시도해주세요.');
      }
    }
  };

  // 검색 다이얼로그 핸들러들
  const handleSupplierSearch = (query: string) => {
    setSupplierSearch(query);
  };

  const handleSupplierSelect = (supplier: any) => {
    setSupplierId(supplier.id);
    setSupplierSearch(supplier.name);
  };

  const handleSupplierCreate = async (data: any) => {
    try {
      const newSupplier = await createSupplier.mutateAsync({ name: data.name });
      setSupplierId(newSupplier.id);
      setSupplierSearch(newSupplier.name);
      alert('공급처가 성공적으로 생성되었습니다.');
    } catch (error) {
      console.error('공급처 생성 실패:', error);
      alert('공급처 생성에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleHolderSearch = (query: string) => {
    // 검색 로직은 이미 useHolderSearch 훅에서 처리됨
  };

  const handleHolderSelect = (holder: any) => {
    setStockOwnerId(holder.id);
    setHolderSearch(holder.name);
  };

  const handleHolderCreate = async (data: any) => {
    try {
      const newHolder = await createHolder.mutateAsync({
        name: data.name,
        isOurAsset: data.isOurAsset || false,
      });
      setStockOwnerId(newHolder.id);
      setHolderSearch(newHolder.name);
      alert('재고소유가 성공적으로 생성되었습니다.');
    } catch (error) {
      console.error('재고소유 생성 실패:', error);
      alert('재고소유 생성에 실패했습니다. 다시 시도해주세요.');
    }
  };

  /** 저장 */
  const onSave = async () => {
    if (!line) return;
    if (!line.matchingId) {
      alert('매칭 레코드가 없습니다. 관리자에게 문의하세요.');
      return;
    }

    try {
      if (activeTab === 'auto') {
        // 자동 매칭 - 재고 SKU 생성 후 매칭 연결
        if (!supplierId || !stockOwnerId || !warehouseId) {
          alert('필수 필드를 모두 입력해주세요.');
          return;
        }

        const filledOptions = optionRows.filter(row => row.name.trim());
        if (filledOptions.length === 0) {
          alert('최소 1개 이상의 옵션을 입력해주세요.');
          return;
        }

        const inventoryMatchingData = {
          productType: productType as any,
          citizenProductName,
          supplierId,
          stockOwnerId,
          warehouseId,
          usage,
          importDeclaration,
          importCertificate,
          optionDetail,
          costPrice: Number(costPrice) || 0,
          options: filledOptions.map(row => ({
            name: row.name,
            image: row.image || undefined,
            price: row.price,
          })),
          productDescription,
          moq,
          memo1,
          memo2,
          memo3,
          memo4,
        };

        // 1) SKU 생성
        const result = await createInventoryMatching.mutateAsync(inventoryMatchingData);

        // 2) 생성된 SKU로 매칭 해소
        await resolveMatching.mutateAsync({
          id: line.matchingId,
          data: {
            ignore: false,
            strategy: 'variant',
            stockPolicy: {
              preStockSellable: true,
              alwaysSellableZeroStock: false,
            },
            skuMappings: result.skuMappings.map(s => ({
              skuId: s.skuId,
              quantity: s.quantity,
            })),
            isGift: false,
          },
        });

      } else if (activeTab === 'manual') {
        // 수동 매칭 - SKU 직접 연결
        const skuMappings = linkedSkus.map((s) => ({
          skuId: s.skuId,
          quantity: s.quantity,
        }));

        if (skuMappings.length > 0) {
          await resolveMatching.mutateAsync({
            id: line.matchingId,
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
          alert('최소 1개 이상의 재고를 연결해주세요.');
          return;
        }

      } else if (activeTab === 'none') {
        // 재고 사용 안함
        await resolveMatching.mutateAsync({
          id: line.matchingId!,
          data: {
            ignore: false,
            strategy: 'void',
            stockPolicy: {
              preStockSellable: true,
              alwaysSellableZeroStock: false,
            },
            isGift: false,
          },
        });
      }

      onClose();
    } catch (e) {
      console.error('상품등록/매칭 저장 실패:', e);
      alert('상품등록/매칭 저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  if (!line) return null;

  // 검색 결과 필터링 (서버에서 이미 필터링되므로 클라이언트에서는 추가 필터링 불필요)
  const filteredSkuResults = (skuResults as any)?.items ?? (Array.isArray(skuResults) ? skuResults : []);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 flex flex-col">
      <DialogHeader className="px-6 py-4 border-b shrink-0">
        <DialogTitle>재고 생성</DialogTitle>
      </DialogHeader>

      {/* 매칭 대상 상품 정보 */}
      <div className="px-6 py-3 bg-gray-50 border-b shrink-0 flex items-center gap-3">
        <div className="text-xs text-gray-500 shrink-0">매칭 대상</div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">{sellingProductName}</span>
          {sellingProductOption && (
            <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded px-2 py-0.5 shrink-0">
              {sellingProductOption}
            </span>
          )}
        </div>
        <div className="ml-auto shrink-0 text-xs text-gray-400">수량 {line.quantity}개</div>
      </div>

      {/* matchingId 없는 경우 경고 */}
      {!line.matchingId && (
        <div className="mx-6 mt-3 shrink-0 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          이 주문의 매칭 레코드가 없습니다. PIM에서 상품 이벤트가 누락되었을 수 있습니다. 관리자에게 문의하세요.
        </div>
      )}

      {/* 탭 네비게이션 */}
      <div className="flex border-b px-0 shrink-0">
        <button
          onClick={() => setActiveTab('auto')}
          className={cn(
            "px-6 py-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'auto'
              ? "text-white bg-orange-500 border-orange-500"
              : "text-gray-600 bg-gray-100 hover:bg-gray-200 border-transparent"
          )}
        >
          자동 재고 매칭
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={cn(
            "px-6 py-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'manual'
              ? "text-white bg-orange-500 border-orange-500"
              : "text-gray-600 bg-gray-100 hover:bg-gray-200 border-transparent"
          )}
        >
          수동 재고 매칭
        </button>
        <button
          onClick={() => setActiveTab('none')}
          className={cn(
            "px-6 py-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'none'
              ? "text-white bg-orange-500 border-orange-500"
              : "text-gray-600 bg-gray-100 hover:bg-gray-200 border-transparent"
          )}
        >
          재고사용 안함
        </button>
      </div>

      {/* 컨텐츠 영역 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6">
        {/* ─────────── 자동 매칭 ─────────── */}
        {activeTab === 'auto' && (
          <div className="space-y-6 py-6">
            {/* 안내 박스 */}
            <div className="rounded-md border p-3 bg-orange-50 text-[13px] leading-5">
              <div className="font-medium mb-1">1. 자동 재고 매칭 : 재고가 생성된 적이 없는 모든 재고 관리 상품</div>
              <div>자동으로 재고파악 시 예상 상품으로 재고파악이 자동으로 매칭됩니다.</div>

              <div className="font-medium mt-2 mb-1">2. 수동 재고 매칭 : 세트, 묶음한 상품 등 재고가 1:1 이 아닌 상품, 또는 기존에 재고가 있는 상품</div>
              <div>수동 재고 매칭 선택 후 [상품명-재고명] 1:1 확인 후 지정하세요.</div>

              <div className="font-medium mt-2 mb-1">3. 재고사용 안함 : 디지털 상품 등 재고관리를 하지 않는 상품</div>
              <div>창고에서 재고관리가 필요하지 않은 상품을 선택해주세요.</div>
            </div>

            {/* 입력 폼 */}
            <FormLayout columns={2} gap="md">
              <FormField label="상품 구분" required>
                <FormSelect
                  options={PRODUCT_TYPES}
                  value={productType}
                  onValueChange={setProductType}
                />
              </FormField>

              <FormField label="사입상품명">
                <FormInput
                  value={citizenProductName}
                  onChange={(e) => setCitizenProductName(e.target.value)}
                  placeholder="상품명을 입력하세요"
                />
              </FormField>

              <FormField label="공급처(발주처)" required>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FormSelect
                      options={suppliers?.map((s: any) => ({ value: s.id, label: s.name })) || []}
                      value={supplierId}
                      onValueChange={setSupplierId}
                      placeholder="공급처 선택"
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowSupplierSearch(true)}>
                    검색
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowSupplierSearch(true)}>
                    신규 등록
                  </Button>
                </div>
              </FormField>

              <FormField label="물류처" required>
                <FormSelect
                  options={warehouses?.map((w: any) => ({ value: w.id, label: w.name })) || []}
                  value={warehouseId}
                  onValueChange={setWarehouseId}
                  placeholder={loadingWarehouses ? "로딩 중..." : "물류처 선택"}
                  disabled={loadingWarehouses}
                />
              </FormField>

              <FormField label="재고소유" required>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FormSelect
                      options={holders?.map((h: any) => ({ value: h.id, label: h.name })) || []}
                      value={stockOwnerId}
                      onValueChange={setStockOwnerId}
                      placeholder="재고소유 선택"
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowHolderSearch(true)}>
                    검색
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowHolderSearch(true)}>
                    신규 등록
                  </Button>
                </div>
              </FormField>

              <FormField label="수입신고필증">
                <div className="flex gap-2">
                  <FormInput
                    value={importDeclaration}
                    onChange={(e) => setImportDeclaration(e.target.value)}
                    className="flex-1"
                    placeholder="수입신고필증 번호"
                  />
                  <Button variant="outline" size="sm">검색</Button>
                </div>
              </FormField>

              <FormField label="수입상고필증">
                <FormInput
                  value={importCertificate}
                  onChange={(e) => setImportCertificate(e.target.value)}
                  placeholder="수입상고필증 번호"
                />
              </FormField>

              <FormField label="옵션성세명정">
                <FormInput
                  value={optionDetail}
                  onChange={(e) => setOptionDetail(e.target.value)}
                  placeholder="옵션 상세 명칭"
                />
              </FormField>

              <FormField label="용도">
                <FormInput
                  value={usage}
                  onChange={(e) => setUsage(e.target.value)}
                  placeholder="용도를 입력하세요"
                />
              </FormField>
            </FormLayout>

            {/* 원가 */}
            <FormField label="원가">
              <div className="flex items-center gap-2">
                <FormNumberInput
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  placeholder="0"
                  suffix="원"
                  className="w-32"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleApplyRepresentativeCost}
                >
                  ↓ 대표원가 적용
                </Button>
              </div>
            </FormField>

            {/* 옵션 테이블 */}
            <div>
              <div className="text-sm font-medium mb-2">옵션 정보</div>
              <div className="border rounded">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium w-16">번호</th>
                      <th className="px-4 py-2 text-left text-xs font-medium">옵션상세명칭</th>
                      <th className="px-4 py-2 text-center text-xs font-medium w-32">옵션이미지</th>
                      <th className="px-4 py-2 text-right text-xs font-medium w-32">원가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionRows.map((row, idx) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-4 py-2 text-center text-sm">{idx + 1}</td>
                        <td className="px-4 py-2">
                          <FormInput
                            value={row.name}
                            onChange={(e) => updateOptionRow(row.id, 'name', e.target.value)}
                            placeholder="옵션명을 입력하세요"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-center">
                            <label className="cursor-pointer">
                              {row.image ? (
                                <img
                                  src={row.image}
                                  alt="옵션 이미지"
                                  className="w-16 h-16 object-cover rounded border"
                                />
                              ) : (
                                <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400 hover:bg-gray-200 transition-colors border border-dashed">
                                  이미지
                                </div>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    handleImageUpload(row.id, file);
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <FormNumberInput
                            value={String(row.price)}
                            onChange={(e) => updateOptionRow(row.id, 'price', parseInt(e.target.value || '0', 10))}
                            suffix="원"
                            className="text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 추가 필드 */}
            <FormField label="상품설명">
              <FormInput
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="상품 설명을 입력하세요"
              />
            </FormField>

            <FormField label="MOQ">
              <FormInput
                value={moq}
                onChange={(e) => setMoq(e.target.value)}
                placeholder="최소 주문 수량"
              />
            </FormField>

            <FormField label="메모1">
              <FormInput
                value={memo1}
                onChange={(e) => setMemo1(e.target.value)}
                placeholder="메모를 입력하세요"
              />
            </FormField>

            <FormField label="메모2">
              <FormInput
                value={memo2}
                onChange={(e) => setMemo2(e.target.value)}
                placeholder="메모를 입력하세요"
              />
            </FormField>

            <FormField label="메모3">
              <FormInput
                value={memo3}
                onChange={(e) => setMemo3(e.target.value)}
                placeholder="메모를 입력하세요"
              />
            </FormField>

            <FormField label="메모4">
              <FormInput
                value={memo4}
                onChange={(e) => setMemo4(e.target.value)}
                placeholder="메모를 입력하세요"
              />
            </FormField>
          </div>
        )}

        {/* ─────────── 수동 매칭 ─────────── */}
        {activeTab === 'manual' && (
          <div className="space-y-6 py-6">
            {/* 안내 메시지 */}
            {showNotice && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4 relative">
                <button
                  onClick={() => setShowNotice(false)}
                  className="absolute top-2 right-2 text-red-600 hover:text-red-800"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="font-medium text-red-800 mb-2 text-sm">필수 안내 (클릭하여 닫기)</div>
                <ul className="text-[13px] text-red-700 space-y-1">
                  <li>• 매칭 오류 시 출고·정산이 지연될 수 있습니다.</li>
                  <li>• 상품명-재고명 1:1 확인 후 저장하세요.</li>
                  <li>• 잘못 저장했을 때 [매칭수정] 기능을 활용할 수 있습니다.</li>
                </ul>
              </div>
            )}

            {/* 판매 상품 & 현재 매칭된 재고 상품 */}
            <div className="grid grid-cols-5 gap-4 items-start">
              {/* 판매 상품 (좌) */}
              <div className="col-span-2">
                <h3 className="text-sm font-medium text-gray-700 mb-3">판매 상품</h3>
                <div className="space-y-2">
                  <div className="bg-gray-50 border rounded-lg p-3">
                    <div className="text-sm font-medium">
                      {sellingProductName}
                    </div>
                    {sellingProductOption && (
                      <div className="text-xs text-gray-500 mt-1">
                        옵션: {sellingProductOption}
                      </div>
                    )}
                    <div className="flex justify-end mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 rounded-full"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 화살표 */}
              <div className="flex items-center justify-center pt-8">
                <ArrowRight className="w-6 h-6 text-gray-400" />
              </div>

              {/* 현재 매칭된 재고 상품 (우) */}
              <div className="col-span-2">
                <h3 className="text-sm font-medium text-gray-700 mb-3">현재 매칭된 재고상품</h3>
                <div className="space-y-2">
                  {linkedSkus.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm border border-dashed rounded-lg">
                      현재 매칭된 재고상품이 없습니다.
                    </div>
                  ) : (
                    linkedSkus.map((sku) => (
                      <div key={sku.skuId} className="bg-white border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{sku.skuName}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <FormNumberInput
                              className="w-12 h-7 text-center text-xs"
                              value={String(sku.quantity)}
                              onChange={(e) => handleUpdateQuantity(sku.skuId, Number(e.target.value))}
                              onBlur={(e) => {
                                const value = Number(e.target.value);
                                if (isNaN(value) || value < 1) {
                                  handleUpdateQuantity(sku.skuId, 1);
                                }
                              }}
                              min={1}
                              step={1}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-red-600 hover:bg-red-50 text-xs"
                              onClick={() => handleRemoveSku(sku.skuId)}
                            >
                              삭제
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* 재고상품 검색 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">재고상품 검색</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs px-3 py-1 h-7">
                    젤로젤로 필요오프 베이스젤
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs px-3 py-1 h-7">
                    젤로젤로 우드스틱
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <FormSelect
                  options={[
                    { value: 'name', label: '재고 상품명' },
                  ]}
                  value={searchType || 'name'}
                  onValueChange={setSearchType}
                  className="w-40"
                />
                <div className="flex-1 relative">
                  <FormInput
                    placeholder="재고 상품명으로 검색"
                    value={skuSearch}
                    onChange={(e) => setSkuSearch(e.target.value)}
                    className="pr-10"
                  />
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
                <Button
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4"
                  onClick={() => {
                    // 검색은 useSkuSearch 훅에서 자동으로 처리됨
                    // debounced 값이 변경되면 자동으로 검색이 실행됨
                  }}
                >
                  찾기
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // 판매상품명으로 검색
                    setSkuSearch(sellingProductName);
                  }}
                >
                  판매상품명으로 검색
                </Button>
              </div>

              {/* 검색 결과 테이블 */}
              <div className="bg-white border rounded-lg">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">등록</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">재고상품 명</th>
                      <th className="text-center px-4 py-2 text-xs font-medium text-gray-700">공급처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searching ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                        </td>
                      </tr>
                    ) : filteredSkuResults.length > 0 ? (
                      filteredSkuResults.map((sku: any) => {
                        const isLinked = linkedSkus.some(s => s.skuId === sku.id);
                        return (
                          <tr key={sku.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <Button
                                size="sm"
                                variant={isLinked ? "outline" : "primary"}
                                className={cn(
                                  "h-7 px-3 text-xs",
                                  isLinked ? "text-gray-500" : "bg-orange-500 hover:bg-orange-600 text-white"
                                )}
                                onClick={() => !isLinked && handleAddSku(sku.id, sku.name)}
                                disabled={isLinked}
                              >
                                {isLinked ? '등록됨' : '등록'}
                              </Button>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-sm">{sku.name}</div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="text-sm text-gray-600">{sku.supplier?.name || '자체제작'}</div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                          {debounced ? '검색 결과가 없습니다.' : '검색어를 입력해주세요'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* 페이지 네이션 */}
                <div className="text-center py-2 border-t">
                  <span className="text-xs text-gray-400">페이지 네이션</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────── 재고 사용 안함 ─────────── */}
        {activeTab === 'none' && (
          <div className="py-6">
            <div className="flex flex-col items-center justify-center py-20">
              <div className="text-center space-y-3 mb-8">
                <div className="text-lg font-medium text-gray-700">
                  재고 상품이 생성되지 않습니다.
                </div>
                <div className="text-sm text-gray-500">
                  디지털 상품 등 재고에 관계없는 상품일 경우 선택해주세요
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer - 저장 버튼 */}
      <div className="border-t p-4 flex justify-center shrink-0">
        <Button
          onClick={onSave}
          className={cn(
            "px-12 py-2",
            isFormValid()
              ? "bg-orange-500 hover:bg-orange-600 text-white"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          )}
          disabled={isSaving || !isFormValid()}
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {activeTab === 'auto' ? '자동 재고 매칭' : activeTab === 'manual' ? '수동 재고 매칭' : '재고사용 안함'}
        </Button>
      </div>

      {/* 검색 다이얼로그들 */}
      <SearchDialog
        isOpen={showSupplierSearch}
        onClose={() => setShowSupplierSearch(false)}
        type="supplier"
        onSelect={handleSupplierSelect}
        onCreate={handleSupplierCreate}
        searchResults={supplierSearchResults?.data || []}
        isLoading={searchingSuppliers}
        onSearch={handleSupplierSearch}
      />

      <SearchDialog
        isOpen={showHolderSearch}
        onClose={() => setShowHolderSearch(false)}
        type="holder"
        onSelect={handleHolderSelect}
        onCreate={handleHolderCreate}
        searchResults={holderSearchResults?.data || []}
        isLoading={searchingHolders}
        onSearch={handleHolderSearch}
      />
      </DialogContent>
    </Dialog>
  );
}