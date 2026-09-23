'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  type AdminShopListingDetailDto,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingRegion,
} from '@/lib/types/dto/products';
import { cn } from '@/lib/utils';
import {
  adminFormValuesFrom,
  buildAdminPayload,
  type AdminFormField,
  type AdminShopListingFormValues,
} from '../../lib/admin-listing-rules';
import { ImageGalleryField } from '../image-gallery-field';
import { MoneyInput } from '../money-input';
import { ShopListingMarkdown } from '../shop-listing-markdown';

type Props = {
  listing?: AdminShopListingDetailDto;
};

const invalidBox = 'rounded-md ring-2 ring-destructive ring-offset-2';

export function ShopListingForm({ listing }: Props) {
  const router = useRouter();
  const createMutation = useCreateShopListing();
  const updateMutation = useUpdateShopListing();
  const [values, setValues] = useState<AdminShopListingFormValues>(() =>
    adminFormValuesFrom(listing)
  );
  const [invalid, setInvalid] = useState<AdminFormField | null>(null);
  const fieldRefs = useRef<Partial<Record<AdminFormField, HTMLElement | null>>>(
    {}
  );

  const isPending = createMutation.isPending || updateMutation.isPending;
  const snapshot = useMemo(() => JSON.stringify(values), [values]);
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

  const set = <K extends keyof AdminShopListingFormValues>(
    key: K,
    value: AdminShopListingFormValues[K]
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (invalid === key) setInvalid(null);
  };

  const bindRef = (field: AdminFormField) => (el: HTMLElement | null) => {
    fieldRefs.current[field] = el;
  };

  const leave = () => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있어요. 나갈까요?'))
      return;
    router.push('/mall/shop-listings');
  };

  const handleSave = async () => {
    const built = buildAdminPayload(values);
    if (!built.ok) {
      setInvalid(built.field);
      fieldRefs.current[built.field]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      toast.error(built.message);
      return;
    }
    setInvalid(null);

    try {
      if (listing) {
        await updateMutation.mutateAsync({
          id: listing.id,
          payload: built.payload,
        });
        toast.success('저장했습니다.');
      } else {
        await createMutation.mutateAsync(built.payload);
        toast.success('등록했습니다. 바로 쇼핑몰에 보여요.');
      }
      savedRef.current = true;
      router.push('/mall/shop-listings');
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-background border-border sticky top-14 z-20 flex items-center justify-between gap-3 border-b py-3 lg:top-16">
        <div className={cn('min-w-0', listing && 'min-h-[46px]')}>
          <h1 className="truncate text-xl font-bold">
            {listing ? '샵매매 글' : '샵매매 새 글'}
          </h1>
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
              <div className="grid gap-1.5" ref={bindRef('title')}>
                <Label htmlFor="title">
                  제목 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  aria-invalid={invalid === 'title'}
                  value={values.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="예) 강남역 네일샵 양도합니다"
                />
              </div>

              <div className="grid gap-1.5" ref={bindRef('content')}>
                <Label>
                  내용 (마크다운) <span className="text-destructive">*</span>
                </Label>
                {/* 상품 상세설명 편집기와 같은 배치 — 넓을 땐 좌우, 좁을 땐 위아래 */}
                <div
                  className={cn(
                    'grid gap-3 xl:grid-cols-2',
                    invalid === 'content' && invalidBox
                  )}
                >
                  <Textarea
                    value={values.content}
                    onChange={(e) => set('content', e.target.value)}
                    placeholder="본문을 마크다운으로 작성하세요. 줄바꿈은 그대로 보여요."
                    className="min-h-[420px] font-mono text-sm"
                  />
                  <div className="bg-muted/20 max-h-[600px] min-h-[420px] overflow-y-auto rounded-md border p-4">
                    <div className="text-muted-foreground mb-2 text-xs font-medium">
                      미리보기
                    </div>
                    {values.content.trim() ? (
                      <ShopListingMarkdown value={values.content} />
                    ) : (
                      <div className="text-muted-foreground py-6 text-center text-sm">
                        작성한 내용이 여기에 보여요.
                      </div>
                    )}
                  </div>
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
                  value={values.dealType}
                  onValueChange={(v) =>
                    set('dealType', v as ShopListingDealType)
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
                  value={values.areaPyeong}
                  onChange={(v) => set('areaPyeong', v)}
                  placeholder="15"
                  unit="평"
                  money={false}
                  disabled={isPending}
                />
                <MoneyInput
                  id="deposit"
                  label="보증금"
                  value={values.deposit}
                  onChange={(v) => set('deposit', v)}
                  placeholder="2000"
                  unit="만원"
                  disabled={isPending}
                />
                <MoneyInput
                  id="monthlyRent"
                  label="월세"
                  value={values.monthlyRent}
                  onChange={(v) => set('monthlyRent', v)}
                  placeholder="120"
                  unit="만원"
                  disabled={isPending}
                />
                <MoneyInput
                  id="keyMoney"
                  label="권리금"
                  value={values.keyMoney}
                  onChange={(v) => set('keyMoney', v)}
                  placeholder="3000"
                  unit="만원"
                  disabled={isPending}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">연락처</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5" ref={bindRef('contactPhone')}>
                <Label htmlFor="contactPhone">전화번호 (선택)</Label>
                <Input
                  id="contactPhone"
                  inputMode="tel"
                  aria-invalid={invalid === 'contactPhone'}
                  value={values.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  placeholder="010-1234-5678"
                />
                <p className="text-muted-foreground text-xs">
                  쇼핑몰에서는 로그인한 회원에게만 보여요.
                </p>
              </div>
              <div className="grid gap-1.5" ref={bindRef('kakaoOpenChatUrl')}>
                <Label htmlFor="kakaoOpenChatUrl">카카오 오픈채팅 (선택)</Label>
                <Input
                  id="kakaoOpenChatUrl"
                  inputMode="url"
                  aria-invalid={invalid === 'kakaoOpenChatUrl'}
                  value={values.kakaoOpenChatUrl}
                  onChange={(e) => set('kakaoOpenChatUrl', e.target.value)}
                  placeholder="https://open.kakao.com/o/…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">분류</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div ref={bindRef('region')} className="grid gap-1.5">
                <Label>
                  지역 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={values.region}
                  onValueChange={(v) => set('region', v as ShopListingRegion)}
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

              <div ref={bindRef('businessType')} className="grid gap-1.5">
                <Label>
                  업종 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={values.businessType}
                  onValueChange={(v) =>
                    set('businessType', v as ShopListingBusinessType)
                  }
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
                ref={bindRef('imageFileIds')}
                className={cn(invalid === 'imageFileIds' && invalidBox)}
              >
                <ImageGalleryField
                  value={values.imageFileIds}
                  onChange={(next) => set('imageFileIds', next)}
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
    </div>
  );
}
