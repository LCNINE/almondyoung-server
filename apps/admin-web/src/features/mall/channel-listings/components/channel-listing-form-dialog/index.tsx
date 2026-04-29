'use client';

import { useState, useEffect } from 'react';
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
import { useCreateChannelListing, useUpdateChannelListing } from '@/lib/services/products';
import type { ChannelListingDto, CreateChannelListingDto } from '@/lib/types/dto/products';

type Props = {
  variantId: string;
  listing?: ChannelListingDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChannelListingFormDialog({ variantId, listing, open, onOpenChange }: Props) {
  const createMutation = useCreateChannelListing();
  const updateMutation = useUpdateChannelListing();

  const isEdit = !!listing;

  const [form, setForm] = useState<CreateChannelListingDto>({
    variantId,
    salesChannelId: '',
    channelItemId: '',
    channelItemName: '',
    channelOptionName: '',
    channelPrice: undefined,
    channelProductUrl: '',
  });

  useEffect(() => {
    if (listing) {
      setForm({
        variantId,
        salesChannelId: listing.salesChannelId,
        channelItemId: listing.channelItemId,
        channelItemName: listing.channelItemName ?? '',
        channelOptionName: listing.channelOptionName ?? '',
        channelPrice: listing.channelPrice ?? undefined,
        channelProductUrl: listing.channelProductUrl ?? '',
      });
    }
  }, [listing, variantId]);

  const update = (key: keyof CreateChannelListingDto, value: string | number | undefined) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
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
          <DialogTitle>{isEdit ? '채널 리스팅 수정' : '채널 리스팅 등록'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!isEdit && (
            <div className="space-y-1">
              <Label>판매 채널 ID</Label>
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
                update('channelPrice', e.target.value ? Number(e.target.value) : undefined)
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '저장 중…' : isEdit ? '수정' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
