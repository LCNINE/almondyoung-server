'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RichTextEditor,
  isEmptyHtml,
} from '@/components/common/rich-text-editor';
import { SHOP_LISTING_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import {
  useCreateShopListing,
  useUpdateShopListing,
} from '@/lib/services/products';
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_BUSINESS_TYPE_LABELS,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_DEAL_TYPE_LABELS,
  SHOP_LISTING_REGIONS,
  SHOP_LISTING_REGION_LABELS,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingDto,
  type ShopListingRegion,
} from '@/lib/types/dto/products';
import { useInViewport } from '@/lib/hooks/use-in-viewport';
import { shouldShowFloatingCollapse } from '@/features/mall/products-detail/components/description/product-description-floating-collapse';
import { cn } from '@/lib/utils';
import { MoneyInput } from '../money-input';
import { ImageGalleryField } from '../image-gallery-field';

type Props = {
  listing?: ShopListingDto;
};

type FieldName = 'title' | 'region' | 'businessType' | 'thumbnail' | 'content';

const toWon = (manwon: string): number | null =>
  manwon.trim() === '' ? null : Number(manwon) * 10_000;
const toManwon = (won: number | null | undefined): string =>
  won === null || won === undefined ? '' : String(won / 10_000);

export function ShopListingForm({ listing }: Props) {
  const router = useRouter();
  const createMutation = useCreateShopListing();
  const updateMutation = useUpdateShopListing();

  const [title, setTitle] = useState(listing?.title ?? '');
  const [content, setContent] = useState(listing?.content ?? '');
  const [images, setImages] = useState<string[]>(listing?.images ?? []);
  // 대표 사진은 따로 고르지 않는다 — 갤러리 맨 앞 사진이 곧 대표다.
  const thumbnailFileId = images[0] ?? null;
  const [region, setRegion] = useState<ShopListingRegion | ''>(
    listing?.region ?? ''
  );
  const [businessType, setBusinessType] = useState<
    ShopListingBusinessType | ''
  >(listing?.businessType ?? '');
  const [dealType, setDealType] = useState<ShopListingDealType>(
    listing?.dealType ?? 'transfer'
  );
  const [areaPyeong, setAreaPyeong] = useState(
    listing?.areaPyeong ? String(listing.areaPyeong) : ''
  );
  const [deposit, setDeposit] = useState(toManwon(listing?.deposit));
  const [monthlyRent, setMonthlyRent] = useState(
    toManwon(listing?.monthlyRent)
  );
  const [keyMoney, setKeyMoney] = useState(toManwon(listing?.keyMoney));
  const [isActive, setIsActive] = useState(listing?.isActive ?? true);
  const [invalid, setInvalid] = useState<FieldName | null>(null);
  const [contentExpanded, setContentExpanded] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const businessTypeRef = useRef<HTMLDivElement>(null);
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentToggleRef = useRef<HTMLDivElement>(null);
  // 상품 상세설명과 같은 규칙 — 펼친 본문은 보이는데 하단 접기 버튼이 화면 밖일 때만 띄운다
  const contentVisible = useInViewport(contentRef, {
    enabled: contentExpanded,
  });
  const toggleFullyVisible = useInViewport(contentToggleRef, { threshold: 1 });
  const showFloatingCollapse = shouldShowFloatingCollapse({
    open: contentExpanded,
    contentVisible,
    triggerFullyVisible: toggleFullyVisible,
  });

  // createPortal 은 클라이언트에서만 — SSR 가드
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const collapseContent = () => {
    setContentExpanded(false);
    contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const snapshot = useMemo(
    () =>
      JSON.stringify([
        title,
        content,
        images,
        region,
        businessType,
        dealType,
        areaPyeong,
        deposit,
        monthlyRent,
        keyMoney,
        isActive,
      ]),
    [
      title,
      content,
      images,
      region,
      businessType,
      dealType,
      areaPyeong,
      deposit,
      monthlyRent,
      keyMoney,
      isActive,
    ]
  );
  const initialSnapshot = useRef(snapshot);
  const savedRef = useRef(false);
  const isDirty = !savedRef.current && snapshot !== initialSnapshot.current;

  // 카페 글을 길게 붙여넣은 뒤 실수로 탭을 닫는 사고를 막는다
  useEffect(() => {
    if (!isDirty) return;

    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const focusField = (field: FieldName) => {
    setInvalid(field);
    const refs: Record<FieldName, HTMLElement | null> = {
      title: titleRef.current,
      region: regionRef.current,
      businessType: businessTypeRef.current,
      thumbnail: thumbnailRef.current,
      content: contentRef.current,
    };

    refs[field]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (field === 'title') titleRef.current?.focus({ preventScroll: true });
  };

  const leave = () => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있어요. 나갈까요?')) {
      return;
    }
    router.push('/mall/shop-listings');
  };

  const handleSave = async () => {
    if (!title.trim()) {
      focusField('title');
      toast.error('제목을 입력해 주세요.');
      return;
    }
    if (!region) {
      focusField('region');
      toast.error('지역을 선택해 주세요.');
      return;
    }
    if (!businessType) {
      focusField('businessType');
      toast.error('업종을 선택해 주세요.');
      return;
    }
    if (images.length === 0) {
      focusField('thumbnail');
      toast.error('샵 사진을 한 장 이상 올려 주세요.');
      return;
    }
    if (isEmptyHtml(content)) {
      focusField('content');
      toast.error('내용을 입력해 주세요.');
      return;
    }

    setInvalid(null);

    const payload = {
      title,
      content,
      region,
      businessType,
      dealType,
      areaPyeong: areaPyeong.trim() === '' ? null : Number(areaPyeong),
      deposit: toWon(deposit),
      monthlyRent: toWon(monthlyRent),
      keyMoney: toWon(keyMoney),
      thumbnailFileId,
      images,
      isActive,
    };

    try {
      if (listing) {
        await updateMutation.mutateAsync({ id: listing.id, dto: payload });
        toast.success('저장했습니다.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('등록했습니다.');
      }
      savedRef.current = true;
      router.push('/mall/shop-listings');
    } catch {
      toast.error('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const invalidBox = 'rounded-md ring-2 ring-destructive ring-offset-2';

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-background border-border sticky top-14 z-20 -mt-4 flex items-center justify-between gap-3 border-b py-3 lg:top-16">
        {/* 안내 문구가 나타날 때 헤더 높이가 변해 본문이 밀리지 않도록 자리를 미리 잡아둔다 */}
        <div className={cn('min-w-0', listing && 'min-h-[46px]')}>
          <h1 className="truncate text-xl font-bold">
            {listing ? '샵매매 글 수정' : '샵매매 새 글'}
          </h1>
          {/* 새 글은 아직 저장된 원본이 없어 "변경사항"이 성립하지 않는다 — 수정 화면에서만 알린다 */}
          {listing && isDirty && (
            <p className="text-muted-foreground text-xs">
              저장하지 않은 변경사항이 있어요
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={leave} disabled={isPending}>
            취소
          </Button>
          <Button onClick={() => void handleSave()} disabled={isPending}>
            {listing ? '저장' : '등록'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="grid gap-1.5">
                <Label htmlFor="title">
                  제목 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  ref={titleRef}
                  aria-invalid={invalid === 'title'}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (invalid === 'title') setInvalid(null);
                  }}
                  placeholder="예) 강남역 네일샵 양도합니다"
                />
              </div>

              <div className="grid gap-1.5">
                <Label>
                  내용 <span className="text-destructive">*</span>
                </Label>
                <div
                  ref={contentRef}
                  className={cn(
                    invalid === 'content' && invalidBox,
                    // 공용 에디터를 건드리지 않고 본문 영역 높이만 밖에서 제한한다
                    !contentExpanded &&
                      '[&_.rich-text-content]:max-h-[420px] [&_.rich-text-content]:overflow-y-auto'
                  )}
                >
                  <RichTextEditor
                    value={content}
                    onChange={(html) => {
                      setContent(html);
                      if (invalid === 'content') setInvalid(null);
                    }}
                    imageContextId={SHOP_LISTING_IMAGE_CONTEXT_ID}
                    placeholder="본문을 작성해주세요."
                    // 사진은 위 「샵 사진」 한 곳에서만 관리한다
                    allowImages={false}
                  />
                </div>

                <div ref={contentToggleRef}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setContentExpanded((prev) => !prev)}
                    className="w-full justify-center gap-1"
                  >
                    {contentExpanded ? '본문 접기' : '본문 펼치기'}
                    <ChevronDown
                      className="size-4 transition-transform duration-200"
                      style={{
                        transform: contentExpanded
                          ? 'rotate(180deg)'
                          : undefined,
                      }}
                    />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">거래 조건</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>거래 유형</Label>
                <Select
                  value={dealType}
                  onValueChange={(value) =>
                    setDealType(value as ShopListingDealType)
                  }
                  disabled={isPending}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_DEAL_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_DEAL_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MoneyInput
                  id="areaPyeong"
                  label="평수"
                  value={areaPyeong}
                  onChange={setAreaPyeong}
                  placeholder="15"
                  unit="평"
                  money={false}
                  disabled={isPending}
                />
                <MoneyInput
                  id="deposit"
                  label="보증금"
                  value={deposit}
                  onChange={setDeposit}
                  placeholder="2000"
                  unit="만원"
                  disabled={isPending}
                />
                <MoneyInput
                  id="monthlyRent"
                  label="월세"
                  value={monthlyRent}
                  onChange={setMonthlyRent}
                  placeholder="120"
                  unit="만원"
                  disabled={isPending}
                />
                <MoneyInput
                  id="keyMoney"
                  label="권리금"
                  value={keyMoney}
                  onChange={setKeyMoney}
                  placeholder="3000"
                  unit="만원"
                  disabled={isPending}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">쇼핑몰 노출</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isPending}
              />
              <Label htmlFor="isActive" className="font-normal">
                {isActive ? '노출중' : '숨김'}
              </Label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">분류</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div ref={regionRef} className="grid gap-1.5">
                <Label>
                  지역 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={region}
                  onValueChange={(value) => {
                    setRegion(value as ShopListingRegion);
                    if (invalid === 'region') setInvalid(null);
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger aria-invalid={invalid === 'region'}>
                    <SelectValue placeholder="지역 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_REGIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_REGION_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div ref={businessTypeRef} className="grid gap-1.5">
                <Label>
                  업종 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={businessType}
                  onValueChange={(value) => {
                    setBusinessType(value as ShopListingBusinessType);
                    if (invalid === 'businessType') setInvalid(null);
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger aria-invalid={invalid === 'businessType'}>
                    <SelectValue placeholder="업종 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOP_LISTING_BUSINESS_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SHOP_LISTING_BUSINESS_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div
                ref={thumbnailRef}
                className={cn(invalid === 'thumbnail' && invalidBox)}
              >
                <ImageGalleryField
                  value={images}
                  onChange={(next) => {
                    setImages(next);
                    if (invalid === 'thumbnail' && next.length > 0) {
                      setInvalid(null);
                    }
                  }}
                  contextId={SHOP_LISTING_IMAGE_CONTEXT_ID}
                  disabled={isPending}
                />
              </div>
            </CardContent>
          </Card>

          {listing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">인터넷 주소</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground font-mono text-xs break-all">
                  /kr/shop-trade/{listing.slug}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {mounted && showFloatingCollapse
        ? createPortal(
            <div className="animate-in fade-in slide-in-from-bottom-4 fixed bottom-6 left-1/2 z-40 -translate-x-1/2 duration-200">
              <Button
                variant="outline"
                onClick={collapseContent}
                className="gap-1 shadow-lg"
              >
                <ChevronUp className="size-4" />
                본문 접기
              </Button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
