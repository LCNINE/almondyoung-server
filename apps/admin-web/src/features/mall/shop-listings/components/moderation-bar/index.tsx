'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  useApproveShopListing,
  useRejectShopListing,
  useShopListingTransition,
} from '@/lib/services/products';
import type { AdminShopListingDetailDto } from '@/lib/types/dto/products';
import {
  SHOP_LISTING_AUTHOR_LABELS,
  SHOP_LISTING_STATUS_LABELS,
  adminListingActions,
  isModerationConflict,
} from '../../lib/admin-listing-rules';

type Props = {
  listing: AdminShopListingDetailDto;
  onRefresh: () => void;
};

/** 선례: features/cs/business-licenses 상세의 승인·반려. 반려 사유는 서버가 요구하므로 비면 막는다. */
export function ModerationBar({ listing, onRefresh }: Props) {
  const approve = useApproveShopListing();
  const reject = useRejectShopListing();
  const hide = useShopListingTransition('hide');
  const unhide = useShopListingTransition('unhide');
  const close = useShopListingTransition('close');
  const reopen = useShopListingTransition('reopen');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const actions = adminListingActions(listing.status);
  const busy = [approve, reject, hide, unhide, close, reopen].some(
    (m) => m.isPending
  );

  const handle = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      toast.success(done);
    } catch (error) {
      if (isModerationConflict(error)) {
        toast.error(
          '그사이 회원이 글을 고쳤거나 상태가 바뀌었어요. 새로고침해서 바뀐 내용을 확인해 주세요.',
          {
            action: { label: '새로고침', onClick: onRefresh },
          }
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : '처리하지 못했어요.'
      );
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge
              variant={listing.status === 'pending' ? 'default' : 'secondary'}
            >
              {SHOP_LISTING_STATUS_LABELS[listing.status]}
            </Badge>
            <Badge variant="outline">
              {SHOP_LISTING_AUTHOR_LABELS[listing.authorType]} 작성
            </Badge>
            {listing.submittedAt && (
              <span className="text-muted-foreground text-xs">
                제출 {new Date(listing.submittedAt).toLocaleString('ko-KR')}
              </span>
            )}
          </div>
          {listing.status === 'rejected' && listing.rejectReason && (
            <p className="text-muted-foreground text-sm">
              반려 사유: {listing.rejectReason}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {actions.includes('reject') && (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
            >
              반려
            </Button>
          )}
          {actions.includes('approve') && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(
                  () =>
                    approve.mutateAsync({
                      id: listing.id,
                      expectedSubmittedAt: listing.submittedAt,
                    }),
                  '승인했어요. 1분 안에 쇼핑몰에 보여요.'
                )
              }
            >
              승인
            </Button>
          )}
          {actions.includes('hide') && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(() => hide.mutateAsync(listing.id), '숨겼어요.')
              }
            >
              숨김
            </Button>
          )}
          {actions.includes('unhide') && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(
                  () => unhide.mutateAsync(listing.id),
                  '다시 게시했어요.'
                )
              }
            >
              숨김 해제
            </Button>
          )}
          {actions.includes('close') && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(
                  () => close.mutateAsync(listing.id),
                  '거래완료로 바꿨어요.'
                )
              }
            >
              거래완료
            </Button>
          )}
          {actions.includes('reopen') && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void handle(
                  () => reopen.mutateAsync(listing.id),
                  '다시 게시했어요.'
                )
              }
            >
              재개
            </Button>
          )}
        </div>
      </CardContent>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>반려 처리</AlertDialogTitle>
            <AlertDialogDescription>
              반려 사유를 입력해 주세요. 회원의 「내 매물」 화면에 그대로
              보여요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예) 매물과 관계없는 글이에요 / 사진에 연락처가 보여요"
            rows={4}
            maxLength={500}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || busy}
              onClick={() =>
                void handle(
                  () =>
                    reject.mutateAsync({
                      id: listing.id,
                      reason: reason.trim(),
                      expectedSubmittedAt: listing.submittedAt,
                    }),
                  '반려했어요.'
                ).then(() => setReason(''))
              }
            >
              반려 처리
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
