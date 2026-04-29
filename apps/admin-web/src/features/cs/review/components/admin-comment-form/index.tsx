'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useReview,
  useCreateReviewComment,
  useUpdateReviewComment,
  useDeleteReviewComment,
} from '@/lib/services/review';
import { useOptionalAdminUser } from '@/lib/services/users';
import { toast } from 'sonner';

function AdminCommentFormContent({ reviewId }: { reviewId: string }) {
  const { data: review } = useReview(reviewId);
  const createComment = useCreateReviewComment(reviewId);
  const updateComment = useUpdateReviewComment(reviewId);
  const deleteComment = useDeleteReviewComment(reviewId);

  const [content, setContent] = useState(review.adminComment?.content ?? '');
  const hasComment = review.adminComment !== null;

  const { data: adminUser } = useOptionalAdminUser(
    review.adminComment?.adminUserId
  );

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast.error('답글 내용을 입력해주세요.');
      return;
    }

    try {
      if (hasComment) {
        await updateComment.mutateAsync({ content });
        toast.success('답글이 수정되었습니다.');
      } else {
        await createComment.mutateAsync({ content });
        toast.success('답글이 등록되었습니다.');
      }
    } catch (error: unknown) {
      const status =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        typeof (error as { response?: unknown }).response === 'object' &&
        (error as { response?: { status?: number } }).response?.status;

      if (status === 409) {
        toast.error('이미 다른 관리자가 답글을 등록했습니다.', {
          description: '페이지를 새로고침하여 확인해주세요.',
          action: {
            label: '새로고침',
            onClick: () => window.location.reload(),
          },
        });
        return;
      }

      toast.error(
        hasComment ? '답글 수정에 실패했습니다.' : '답글 등록에 실패했습니다.'
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deleteComment.mutateAsync();
      setContent('');
      toast.success('답글이 삭제되었습니다.');
    } catch (error) {
      toast.error('답글 삭제에 실패했습니다.');
    }
  };

  const isLoading =
    createComment.isPending ||
    updateComment.isPending ||
    deleteComment.isPending;

  return (
    <div className="p-4 space-y-4">
      {hasComment && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            작성자: {adminUser?.nickname ?? adminUser?.username ?? '-'}
          </div>
          <div>
            마지막 수정:{' '}
            {new Date(review.adminComment!.updatedAt).toLocaleString('ko-KR')}
          </div>
        </div>
      )}
      <Textarea
        placeholder="리뷰에 대한 관리자 답글을 입력하세요..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        disabled={isLoading}
      />
      <div className="flex gap-2 justify-end">
        {hasComment && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isLoading}>
                삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>답글 삭제</AlertDialogTitle>
                <AlertDialogDescription>
                  정말로 답글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button onClick={handleSubmit} size="sm" disabled={isLoading}>
          {isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : hasComment ? (
            '수정'
          ) : (
            '답글 등록'
          )}
        </Button>
      </div>
    </div>
  );
}

export function AdminCommentForm({ reviewId }: { reviewId: string }) {
  return (
    <Container className="divide-y">
      <Header title="관리자 답글" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <AdminCommentFormContent reviewId={reviewId} />
      </Suspense>
    </Container>
  );
}
