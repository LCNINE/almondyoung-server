'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  useActiveChannels,
  useCreateChannelListing,
  useUpdateChannelListing,
} from '@/lib/services/products';
import {
  resolveActiveChannelId,
  channelResolutionMessage,
} from './resolve-channel-id';
import type {
  ChannelListingDto,
  CreateChannelListingDto,
} from '@/lib/types/dto/products';

type Props = {
  /**
   * 검색으로 이미 확정된 variant 에서 여는 경우 필수로 넘어온다(기존 channel-listings 화면).
   * 격리 큐 화면처럼 variant 를 아직 모르는 채로 여는 경우 생략하면, 폼이 직접 입력 필드를 보여준다.
   */
  variantId?: string;
  listing?: ChannelListingDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 격리 큐의 "매핑 생성" 프리필. `channelItemId` 는 채워주지만 `salesChannelId`(UUID)는 대신 채울 수 없다 — 안내 문구만 보탠다. */
  defaultChannelCode?: string;
  defaultChannelItemId?: string;
  /** 신규 등록이 성공했을 때만 호출된다(수정은 호출 안 함) — 격리 큐가 이어서 재처리를 트리거하는 데 쓴다. */
  onCreated?: () => void;
};

export function ChannelListingFormDialog({
  variantId,
  listing,
  open,
  onOpenChange,
  defaultChannelCode,
  defaultChannelItemId,
  onCreated,
}: Props) {
  const createMutation = useCreateChannelListing();
  const updateMutation = useUpdateChannelListing();
  const activeChannelsQuery = useActiveChannels();

  const isEdit = !!listing;
  const variantIdKnown = !!variantId;

  const channelResolution = resolveActiveChannelId(
    defaultChannelCode,
    activeChannelsQuery.data,
    activeChannelsQuery.isLoading
  );
  const channelHint = channelResolutionMessage(
    channelResolution,
    defaultChannelCode
  );
  const resolvedSalesChannelId =
    channelResolution.status === 'resolved'
      ? channelResolution.salesChannelId
      : null;

  const [form, setForm] = useState<CreateChannelListingDto>({
    variantId: variantId ?? '',
    salesChannelId: '',
    channelItemId: defaultChannelItemId ?? '',
    channelItemName: '',
    channelOptionName: '',
    channelPrice: undefined,
    channelProductUrl: '',
  });

  // salesChannelId 를 운영자가 직접 고쳤으면 뒤늦게 해석이 끝나도 덮어쓰지 않는다.
  const salesChannelIdTouchedRef = useRef(false);

  useEffect(() => {
    if (listing) {
      setForm({
        variantId: variantId ?? '',
        salesChannelId: listing.salesChannelId,
        channelItemId: listing.channelItemId,
        channelItemName: listing.channelItemName ?? '',
        channelOptionName: listing.channelOptionName ?? '',
        channelPrice: listing.channelPrice ?? undefined,
        channelProductUrl: listing.channelProductUrl ?? '',
      });
    } else {
      salesChannelIdTouchedRef.current = false;
      setForm({
        variantId: variantId ?? '',
        salesChannelId: '',
        channelItemId: defaultChannelItemId ?? '',
        channelItemName: '',
        channelOptionName: '',
        channelPrice: undefined,
        channelProductUrl: '',
      });
    }
  }, [listing, variantId, defaultChannelItemId]);

  // 채널 목록 조회가 폼이 이미 열린 뒤에 끝나는 경우(캐시 미스)를 위한 뒤늦은 프리필.
  useEffect(() => {
    if (isEdit || !resolvedSalesChannelId || salesChannelIdTouchedRef.current)
      return;
    setForm((prev) => ({ ...prev, salesChannelId: resolvedSalesChannelId }));
  }, [isEdit, resolvedSalesChannelId]);

  const update = (
    key: keyof CreateChannelListingDto,
    value: string | number | undefined
  ) => {
    if (key === 'salesChannelId') salesChannelIdTouchedRef.current = true;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!isEdit && !form.variantId.trim()) {
      toast.error('Variant ID를 입력해주세요.');
      return;
    }
    if (!form.salesChannelId.trim()) {
      toast.error('판매 채널 ID를 입력해주세요.');
      return;
    }
    if (!form.channelItemId.trim()) {
      toast.error('채널 상품 ID를 입력해주세요.');
      return;
    }
    try {
      if (isEdit && listing) {
        await updateMutation.mutateAsync({
          id: listing.id,
          data: {
            channelItemId: form.channelItemId,
            channelItemName: form.channelItemName || undefined,
            channelOptionName: form.channelOptionName || undefined,
            channelPrice: form.channelPrice,
            channelProductUrl: form.channelProductUrl || undefined,
          },
        });
        toast.success('채널 리스팅이 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(form);
        toast.success('채널 리스팅이 등록되었습니다.');
        onCreated?.();
      }
      onOpenChange(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        toast.error('이미 동일한 채널 상품 ID로 등록된 리스팅이 있습니다.');
      } else {
        toast.error(isEdit ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
      }
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '채널 리스팅 수정' : '채널 리스팅 등록'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!isEdit && !variantIdKnown && (
            <div className="space-y-1">
              <Label>Variant ID</Label>
              <Input
                placeholder="매핑할 판매상품 Variant UUID"
                value={form.variantId}
                onChange={(e) => update('variantId', e.target.value)}
              />
            </div>
          )}
          {!isEdit && (
            <div className="space-y-1">
              <Label>판매 채널 ID</Label>
              {channelHint && (
                <p
                  className={
                    channelResolution.status === 'unresolved'
                      ? 'text-xs text-amber-600'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {channelHint}
                </p>
              )}
              <Input
                placeholder="Sales Channel UUID"
                value={form.salesChannelId}
                onChange={(e) => update('salesChannelId', e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>채널 상품 ID</Label>
            <Input
              placeholder="예: 12345 (쿠팡 vendorItemId)"
              value={form.channelItemId}
              onChange={(e) => update('channelItemId', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>채널 상품명 (선택)</Label>
            <Input
              value={form.channelItemName ?? ''}
              onChange={(e) => update('channelItemName', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>채널 옵션명 (선택)</Label>
            <Input
              placeholder='예: "블랙 / M"'
              value={form.channelOptionName ?? ''}
              onChange={(e) => update('channelOptionName', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>채널 판매가 (선택)</Label>
            <Input
              type="number"
              min={0}
              placeholder="원 단위"
              value={form.channelPrice ?? ''}
              onChange={(e) =>
                update(
                  'channelPrice',
                  e.target.value ? Number(e.target.value) : undefined
                )
              }
            />
          </div>
          <div className="space-y-1">
            <Label>채널 상품 URL (선택)</Label>
            <Input
              placeholder="https://..."
              value={form.channelProductUrl ?? ''}
              onChange={(e) => update('channelProductUrl', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '저장 중…' : isEdit ? '수정' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
