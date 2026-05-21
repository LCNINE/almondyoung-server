'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useCreateCoupon } from '@/lib/services/coupons';
import { useMe } from '@/lib/services/users';
import { useProductSearch, useCategoryList, useCollectionList } from '@/lib/services/catalog';
import type { PromotionTargetRule } from '@/lib/api/domains/medusa/promotions';
import { toast } from 'sonner';
import { RefreshCw, X, ChevronsUpDown, Check } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import { useDebounced } from '@/hooks/use-debounced';

function generateCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 8).toUpperCase();
}

type TargetAttribute = 'product_id' | 'product_category_id' | 'product_collection_id';

interface SelectedItem {
  id: string;
  label: string;
}

function TargetRuleSelector({
  attribute,
  selected,
  onToggle,
}: {
  attribute: TargetAttribute;
  selected: SelectedItem[];
  onToggle: (item: SelectedItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 300);

  const isProduct = attribute === 'product_id';
  const isCategory = attribute === 'product_category_id';

  const { data: productData, isFetching: productFetching } = useProductSearch(debouncedQ, open && isProduct);
  const { data: categoryData, isFetching: categoryFetching } = useCategoryList(debouncedQ, open && isCategory);
  const { data: collectionData, isFetching: collectionFetching } = useCollectionList(debouncedQ, open && !isProduct && !isCategory);

  const isFetching = productFetching || categoryFetching || collectionFetching;

  const itemsByAttribute: Record<TargetAttribute, SelectedItem[]> = {
    product_id: (productData?.products ?? []).map((p) => ({ id: p.id, label: p.title })),
    product_category_id: (categoryData?.product_categories ?? []).map((c) => ({ id: c.id, label: c.name })),
    product_collection_id: (collectionData?.collections ?? []).map((c) => ({ id: c.id, label: c.title })),
  };
  const allItems = itemsByAttribute[attribute];

  const placeholderByAttribute: Record<TargetAttribute, string> = {
    product_id: '상품 검색...',
    product_category_id: '카테고리 검색...',
    product_collection_id: '컬렉션 검색...',
  };
  const placeholder = placeholderByAttribute[attribute];
  const triggerLabel = selected.length > 0 ? `${selected.length}개 선택됨` : `전체 ${placeholder.replace('...', '')}`;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(''); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-9 text-sm font-normal">
            <span className={selected.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
              {triggerLabel}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              {isFetching ? (
                <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
              ) : allItems.length === 0 ? (
                <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
              ) : (
                <CommandGroup heading={`${allItems.length}개 결과`}>
                  {allItems.map((item) => {
                    const isSelected = selected.some((s) => s.id === item.id);
                    return (
                      <CommandItem
                        key={item.id}
                        value={item.label}
                        onSelect={() => onToggle(item)}
                      >
                        <Check className={cn('mr-2 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                        <span className="text-sm truncate">{item.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <Badge key={item.id} variant="secondary" className="text-xs gap-1 pr-1">
              <span className="max-w-[160px] truncate">{item.label}</span>
              <button type="button" onClick={() => onToggle(item)} className="hover:text-destructive ml-0.5">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function CouponCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue] = useState<number | ''>('');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState<number | ''>('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState<number | ''>('');
  const [usageLimit, setUsageLimit] = useState<number | ''>('');
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState<number | ''>('');
  const [targetType, setTargetType] = useState<'order' | 'items'>('order');
  const [targetAttribute, setTargetAttribute] = useState<TargetAttribute>('product_id');
  const [targetItems, setTargetItems] = useState<SelectedItem[]>([]);

  const createMutation = useCreateCoupon();
  const { data: me } = useMe();

  const handleToggleTargetItem = (item: SelectedItem) => {
    setTargetItems((prev) =>
      prev.some((s) => s.id === item.id) ? prev.filter((s) => s.id !== item.id) : [...prev, item]
    );
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!code.trim() || !value || (value as number) <= 0) return;
    if (discountType === 'percentage' && (value as number) > 100) return;
    if (targetType === 'items' && targetItems.length === 0) return;

    const additional_data: Record<string, unknown> = {};
    if (trimmedName) additional_data.name = trimmedName;
    if (discountType === 'percentage' && maxDiscountAmount) additional_data.max_discount_amount = Number(maxDiscountAmount);
    if (maxUsesPerCustomer) additional_data.max_uses_per_customer = Number(maxUsesPerCustomer);
    if (me) additional_data.created_by = me.email || me.username;

    const hasCampaign = startsAt || endsAt || usageLimit;
    const campaignIdentifier = `CAMP_${code.trim().toUpperCase()}`;

    const targetRules: PromotionTargetRule[] | undefined =
      targetType === 'items' && targetItems.length > 0
        ? [{ attribute: targetAttribute, operator: 'in', values: targetItems.map((i) => i.id) }]
        : undefined;
    const allocation = targetType === 'items' ? 'across' : undefined;

    try {
      await createMutation.mutateAsync({
        code: code.trim().toUpperCase(),
        type: 'standard',
        is_automatic: false,
        application_method: {
          type: discountType,
          value: value as number,
          target_type: targetType,
          ...(discountType === 'fixed' ? { currency_code: 'krw' } : {}),
          ...(allocation ? { allocation } : {}),
          ...(targetRules ? { target_rules: targetRules } : {}),
        },
        ...(hasCampaign
          ? {
              campaign: {
                name: trimmedName || code.trim().toUpperCase(),
                campaign_identifier: campaignIdentifier,
                ...(startsAt ? { starts_at: new Date(startsAt).toISOString() } : {}),
                ...(endsAt ? { ends_at: new Date(endsAt).toISOString() } : {}),
                ...(usageLimit ? { budget: { type: 'usage' as const, limit: Number(usageLimit) } } : {}),
              },
            }
          : {}),
        ...(minOrderAmount
          ? {
              rules: [{ attribute: 'subtotal', operator: 'gte', values: [String(minOrderAmount)] }],
            }
          : {}),
        ...(Object.keys(additional_data).length > 0 ? { additional_data } : {}),
      });
      toast.success('쿠폰이 생성되었습니다.');
      handleClose();
    } catch (e: unknown) {
      const msg = (e as any)?.response?.data?.message ?? (e as any)?.message ?? '쿠폰 생성에 실패했습니다.';
      toast.error(msg);
    }
  };

  const handleClose = () => {
    setName('');
    setCode('');
    setDiscountType('percentage');
    setValue('');
    setMaxDiscountAmount('');
    setStartsAt('');
    setEndsAt('');
    setMinOrderAmount('');
    setUsageLimit('');
    setMaxUsesPerCustomer('');
    setTargetType('order');
    setTargetAttribute('product_id');
    setTargetItems([]);
    onOpenChange(false);
  };

  const isValid =
    code.trim() &&
    value &&
    (value as number) > 0 &&
    !(discountType === 'percentage' && (value as number) > 100) &&
    (targetType === 'order' || targetItems.length > 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>쿠폰 생성</DialogTitle>
          <DialogDescription>새 쿠폰 코드와 할인 조건을 설정하세요.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>쿠폰 이름</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 신규 회원 할인 쿠폰"
            />
          </div>

          <div className="space-y-2">
            <Label>쿠폰 코드 <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SUMMER2025"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setCode(generateCode())}
                title="자동 생성"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>할인 유형 <span className="text-destructive">*</span></Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'percentage' | 'fixed')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">정률 (%)</SelectItem>
                  <SelectItem value="fixed">정액 (원)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                할인 {discountType === 'percentage' ? '율 (%)' : '금액 (원)'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                max={discountType === 'percentage' ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value ? Number(e.target.value) : '')}
                placeholder={discountType === 'percentage' ? '10' : '5000'}
              />
            </div>
          </div>

          {discountType === 'percentage' && (
            <div className="space-y-2">
              <Label>최대 할인 금액 (원)</Label>
              <Input
                type="number"
                min={0}
                value={maxDiscountAmount}
                onChange={(e) => setMaxDiscountAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 10000 (최대 1만원까지 할인)"
              />
              {!!maxDiscountAmount && (
                <p className="text-xs text-muted-foreground">
                  최대 {(maxDiscountAmount as number).toLocaleString('ko-KR')}원까지 할인
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>쿠폰 적용 대상</Label>
            <Select value={targetType} onValueChange={(v) => {
              setTargetType(v as 'order' | 'items');
              setTargetItems([]);
            }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">전체 주문 (주문 금액 할인)</SelectItem>
                <SelectItem value="items">특정 상품/카테고리/컬렉션</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {targetType === 'items' && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Label className="shrink-0">대상 유형</Label>
                <Select value={targetAttribute} onValueChange={(v) => {
                  setTargetAttribute(v as TargetAttribute);
                  setTargetItems([]);
                }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product_id">상품</SelectItem>
                    <SelectItem value="product_category_id">카테고리</SelectItem>
                    <SelectItem value="product_collection_id">컬렉션</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TargetRuleSelector
                attribute={targetAttribute}
                selected={targetItems}
                onToggle={handleToggleTargetItem}
              />
              {targetItems.length === 0 && (
                <p className="text-xs text-destructive">대상 항목을 하나 이상 선택해주세요.</p>
              )}
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">사용 조건 (선택)</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>최소 주문 금액 (원)</Label>
            <Input
              type="number"
              min={0}
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="예: 50000 (5만원 이상 구매 시 사용 가능)"
            />
            {!!minOrderAmount && (
              <p className="text-xs text-muted-foreground">
                {minOrderAmount.toLocaleString('ko-KR')}원 이상 구매 시 사용 가능
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>시작일</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>만료일</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>총 사용 횟수 제한</Label>
              <Input
                type="number"
                min={1}
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 100"
              />
              {!!usageLimit && (
                <p className="text-xs text-muted-foreground">
                  전체 {usageLimit.toLocaleString('ko-KR')}회 (선착순)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>1인당 사용 횟수 제한</Label>
              <Input
                type="number"
                min={1}
                value={maxUsesPerCustomer}
                onChange={(e) => setMaxUsesPerCustomer(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 1"
              />
              {!!maxUsesPerCustomer && (
                <p className="text-xs text-muted-foreground">
                  1인당 {maxUsesPerCustomer.toLocaleString('ko-KR')}회 사용 가능
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || !isValid}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
