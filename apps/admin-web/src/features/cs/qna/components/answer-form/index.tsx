'use client';

import { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useQuestion,
  useCreateAnswer,
  useUpdateAnswer,
  useDeleteAnswer,
} from '@/lib/services/qna';
import { useOptionalAdminUser } from '@/lib/services/users';
import { toast } from 'sonner';
import {
  ANSWER_TEMPLATES,
  defaultTemplateId,
  renderAnswerTemplate,
} from '../../answer-templates';

function AnswerFormContent({ questionId }: { questionId: string }) {
  const { data: question } = useQuestion(questionId);
  const { data: author, isLoading: isAuthorLoading } = useOptionalAdminUser(
    question.userId
  );

  if (isAuthorLoading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <AnswerEditor
      questionId={questionId}
      customerName={author?.username || question.nickname}
    />
  );
}

function AnswerEditor({
  questionId,
  customerName,
}: {
  questionId: string;
  customerName: string;
}) {
  const { data: question } = useQuestion(questionId);
  const createAnswer = useCreateAnswer(questionId);
  const updateAnswer = useUpdateAnswer(questionId);
  const deleteAnswer = useDeleteAnswer(questionId);

  const initialTemplateId = defaultTemplateId(question.category);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [content, setContent] = useState(
    question.answer?.content ??
      renderAnswerTemplate(initialTemplateId, customerName)
  );
  // 양식을 바꾸면 쓰던 답변이 지워지므로, 손댄 내용이 있을 때만 한 번 묻는다
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null
  );
  const hasAnswer = question.answer !== null;

  const { data: adminUser } = useOptionalAdminUser(
    question.answer?.adminUserId
  );

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    setContent(renderAnswerTemplate(id, customerName));
  };

  const handleTemplateChange = (id: string) => {
    const untouched =
      !content.trim() ||
      content === renderAnswerTemplate(templateId, customerName);
    if (untouched) applyTemplate(id);
    else setPendingTemplateId(id);
  };

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast.error('답변 내용을 입력해 주세요.');
      return;
    }

    try {
      if (hasAnswer) {
        await updateAnswer.mutateAsync({ content });
        toast.success('답변을 수정했어요');
      } else {
        await createAnswer.mutateAsync({ content });
        toast.success('답변을 등록했어요');
      }
    } catch (error: unknown) {
      const status =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        typeof (error as { response?: unknown }).response === 'object' &&
        (error as { response?: { status?: number } }).response?.status;

      if (status === 409) {
        toast.error('다른 관리자가 먼저 답변을 등록했어요.', {
          description: '새로고침해서 확인해 주세요.',
          action: {
            label: '새로고침',
            onClick: () => window.location.reload(),
          },
        });
        return;
      }

      toast.error(
        hasAnswer
          ? '답변을 수정하지 못했어요. 다시 시도해 주세요.'
          : '답변을 등록하지 못했어요. 다시 시도해 주세요.'
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAnswer.mutateAsync();
      setContent(renderAnswerTemplate(templateId, customerName));
      toast.success('답변을 삭제했어요');
    } catch {
      toast.error('답변을 삭제하지 못했어요. 다시 시도해 주세요.');
    }
  };

  const isLoading =
    createAnswer.isPending || updateAnswer.isPending || deleteAnswer.isPending;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">
            {hasAnswer ? '보낸 답변' : '답변 작성'}
          </h3>
          {hasAnswer && (
            <p className="text-muted-foreground mt-0.5 text-[13px]">
              {adminUser?.username ?? adminUser?.nickname ?? '관리자'} ·{' '}
              {new Date(question.answer!.updatedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
        <Select
          value={templateId}
          onValueChange={handleTemplateChange}
          disabled={isLoading}
        >
          <SelectTrigger size="sm" className="w-36">
            <span className="text-muted-foreground">양식</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANSWER_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        placeholder="고객에게 보낼 답변을 적어 주세요"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={12}
        disabled={isLoading}
        className="mt-4 text-[15px] leading-7"
      />

      <div className="mt-4 flex items-center justify-between">
        {hasAnswer ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={isLoading}
              >
                답변 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>답변을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  삭제하면 되돌릴 수 없어요.
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
        ) : (
          <span />
        )}
        <Button onClick={handleSubmit} disabled={isLoading} className="min-w-28">
          {isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : hasAnswer ? (
            '답변 수정하기'
          ) : (
            '답변 등록하기'
          )}
        </Button>
      </div>

      <AlertDialog
        open={pendingTemplateId !== null}
        onOpenChange={(open) => !open && setPendingTemplateId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>양식을 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금 쓰고 있는 답변이 지워져요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>그대로 두기</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTemplateId) applyTemplate(pendingTemplateId);
                setPendingTemplateId(null);
              }}
            >
              바꾸기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AnswerForm({ questionId }: { questionId: string }) {
  return (
    <Container>
      <Suspense
        fallback={
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        }
      >
        <AnswerFormContent questionId={questionId} />
      </Suspense>
    </Container>
  );
}
