'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useReview, useUpdateReviewStatus } from '@/lib/services/review';
import {
  REVIEW_STATUSES,
  ReviewStatus,
  STATUS_LABELS,
} from '@/lib/types/dto/review';
import { toast } from 'sonner';

function ReviewStatusToggleContent({ reviewId }: { reviewId: string }) {
  const { data: review } = useReview(reviewId);
  const updateStatus = useUpdateReviewStatus(reviewId);

  const [pendingStatus, setPendingStatus] = useState<ReviewStatus | null>(null);

  const handleConfirm = async () => {
    if (!pendingStatus) return;

    try {
      await updateStatus.mutateAsync({ status: pendingStatus });
      toast.success(`상태가 "${STATUS_LABELS[pendingStatus]}"(으)로 변경되었습니다.`);
    } catch (error) {
      toast.error('상태 변경에 실패했습니다.');
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        현재 상태:{' '}
        <span className="font-medium">{STATUS_LABELS[review.status]}</span>
      </p>
      <div className="flex items-center gap-2">
        <Select
          value={review.status}
          onValueChange={(value) => {
            const next = value as ReviewStatus;
            if (next !== review.status) {
              setPendingStatus(next);
            }
          }}
          disabled={updateStatus.isPending}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="상태 선택" />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {updateStatus.isPending && <Spinner className="h-4 w-4" />}
      </div>

      <AlertDialog
        open={pendingStatus !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatus(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>리뷰 상태 변경</AlertDialogTitle>
            <AlertDialogDescription>
              상태를 &quot;{pendingStatus && STATUS_LABELS[pendingStatus]}&quot;
              (으)로 변경하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>변경</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ReviewStatusToggle({ reviewId }: { reviewId: string }) {
  return (
    <Container className="divide-y">
      <Header title="상태 관리" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <ReviewStatusToggleContent reviewId={reviewId} />
      </Suspense>
    </Container>
  );
}
