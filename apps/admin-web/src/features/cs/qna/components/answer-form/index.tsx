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
  useQuestion,
  useCreateAnswer,
  useUpdateAnswer,
  useDeleteAnswer,
} from '@/lib/services/qna';
import { useOptionalAdminUser } from '@/lib/services/users';
import { toast } from 'sonner';

function AnswerFormContent({ questionId }: { questionId: string }) {
  const { data: question } = useQuestion(questionId);
  const createAnswer = useCreateAnswer(questionId);
  const updateAnswer = useUpdateAnswer(questionId);
  const deleteAnswer = useDeleteAnswer(questionId);

  const [content, setContent] = useState(question.answer?.content ?? '');
  const hasAnswer = question.answer !== null;

  const { data: adminUser } = useOptionalAdminUser(question.answer?.adminUserId);

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast.error('답변 내용을 입력해주세요.');
      return;
    }

    try {
      if (hasAnswer) {
        await updateAnswer.mutateAsync({ content });
        toast.success('답변이 수정되었습니다.');
      } else {
        await createAnswer.mutateAsync({ content });
        toast.success('답변이 등록되었습니다.');
      }
    } catch (error: unknown) {
      const status =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        typeof (error as { response?: unknown }).response === 'object' &&
        (error as { response?: { status?: number } }).response?.status;

      if (status === 409) {
        toast.error('이미 다른 관리자가 답변을 등록했습니다.', {
          description: '페이지를 새로고침하여 확인해주세요.',
          action: {
            label: '새로고침',
            onClick: () => window.location.reload(),
          },
        });
        return;
      }

      toast.error(
        hasAnswer ? '답변 수정에 실패했습니다.' : '답변 등록에 실패했습니다.'
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAnswer.mutateAsync();
      setContent('');
      toast.success('답변이 삭제되었습니다.');
    } catch (error) {
      toast.error('답변 삭제에 실패했습니다.');
    }
  };

  const isLoading =
    createAnswer.isPending || updateAnswer.isPending || deleteAnswer.isPending;

  return (
    <div className="p-4 space-y-4">
      {hasAnswer && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            답변자: {adminUser?.username ?? adminUser?.nickname ?? '-'}
          </div>
          <div>
            마지막 수정:{' '}
            {new Date(question.answer!.updatedAt).toLocaleString('ko-KR')}
          </div>
        </div>
      )}
      <Textarea
        placeholder="답변 내용을 입력하세요..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        disabled={isLoading}
      />
      <div className="flex gap-2 justify-end">
        {hasAnswer && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isLoading}>
                삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>답변 삭제</AlertDialogTitle>
                <AlertDialogDescription>
                  정말로 답변을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
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
          ) : hasAnswer ? (
            '수정'
          ) : (
            '답변 등록'
          )}
        </Button>
      </div>
    </div>
  );
}

export function AnswerForm({ questionId }: { questionId: string }) {
  return (
    <Container className="divide-y">
      <Header title="관리자 답변" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <AnswerFormContent questionId={questionId} />
      </Suspense>
    </Container>
  );
}
