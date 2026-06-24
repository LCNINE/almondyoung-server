'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { LockIcon, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Spinner } from '@/components/ui/spinner';
import {
  useQuestions,
  useCreateAnswer,
  useUpdateAnswer,
  useDeleteAnswer,
} from '@/lib/services/qna';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  type QuestionDto,
} from '@/lib/types/dto/qna';
import { FILE_SERVICE_BASE_URL } from '@/const';
import { formatDate } from '@/lib/utils/date';

function categoryLabel(category: QuestionDto['category']): string {
  return category ? CATEGORY_LABELS[category] : '-';
}

function StatusBadge({ question }: { question: QuestionDto }) {
  if (question.deletedAt) {
    return <Badge variant="destructive">{STATUS_LABELS.deleted}</Badge>;
  }
  return (
    <Badge variant={question.status === 'answered' ? 'default' : 'secondary'}>
      {STATUS_LABELS[question.status]}
    </Badge>
  );
}

/** 다이얼로그 내부 답변 작성/수정/삭제 폼 */
function AnswerForm({ question }: { question: QuestionDto }) {
  const createAnswer = useCreateAnswer(question.id);
  const updateAnswer = useUpdateAnswer(question.id);
  const deleteAnswer = useDeleteAnswer(question.id);

  const hasAnswer = question.answer !== null;
  const [content, setContent] = useState(question.answer?.content ?? '');

  const isLoading =
    createAnswer.isPending || updateAnswer.isPending || deleteAnswer.isPending;

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
          description: '잠시 후 다시 시도해주세요.',
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
    } catch {
      toast.error('답변 삭제에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">관리자 답변</h3>
        {hasAnswer && question.answer && (
          <span className="text-xs text-gray-400">
            마지막 수정 : {formatDate(question.answer.updatedAt)}
          </span>
        )}
      </div>
      <Textarea
        placeholder="답변 내용을 입력하세요..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        disabled={isLoading}
      />
      <div className="flex justify-end gap-2">
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
            '답변 수정'
          ) : (
            '답변 등록'
          )}
        </Button>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}

/** 문의 상세 다이얼로그 */
function InquiryDetailDialog({
  question,
  onClose,
}: {
  question: QuestionDto | null;
  onClose: () => void;
}) {
  const imageUrls =
    question?.mediaFileIds.map(
      (fileId) => `${FILE_SERVICE_BASE_URL}/files/public/${fileId}`
    ) ?? [];

  return (
    <Dialog open={!!question} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        {question && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-6 text-left">
                {question.isSecret && (
                  <LockIcon className="size-4 shrink-0 text-gray-400" />
                )}
                <span className="break-keep">{question.title}</span>
              </DialogTitle>
              <DialogDescription className="sr-only">
                문의 상세 내용 및 답변 작성
              </DialogDescription>
            </DialogHeader>

            <dl className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
              <DetailRow label="작성자">{question.nickname}</DetailRow>
              <DetailRow label="카테고리">
                {categoryLabel(question.category)}
              </DetailRow>
              <DetailRow label="상태">
                <StatusBadge question={question} />
              </DetailRow>
              <DetailRow label="작성일">
                {formatDate(question.createdAt)}
              </DetailRow>
            </dl>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-gray-800">
                문의 내용
              </h3>
              <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-800">
                {question.content}
              </p>
            </section>

            {imageUrls.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-gray-800">
                  첨부파일 ({imageUrls.length}개)
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {imageUrls.map((url, index) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <Image
                          width={80}
                          height={80}
                          src={url}
                          alt={`첨부 이미지 ${index + 1}`}
                          className="aspect-square rounded-md border object-cover transition-opacity hover:opacity-80"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="border-t border-gray-100 pt-3">
              <AnswerForm question={question} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InquiriesTab({ customerId }: { customerId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuestions({
    userId: customerId,
    limit: 100,
    sort: 'latest',
  });

  const questions = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? questions.length;

  // 선택된 질문은 항상 최신 목록 데이터에서 파생 (답변 후 invalidate 시 동기화)
  const selectedQuestion = useMemo(
    () => questions.find((q) => q.id === selectedId) ?? null,
    [questions, selectedId]
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <MessageSquare className="size-4 text-indigo-500" />
        문의내역
        {!isLoading && !isError && (
          <span className="text-xs font-normal text-gray-500">
            총 {total.toLocaleString()}건
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <div className="py-8 text-center text-sm text-red-400">
          문의 내역을 불러오지 못했습니다.
        </div>
      ) : questions.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          문의 내역이 없습니다.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">카테고리</TableHead>
              <TableHead>제목</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-28">작성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questions.map((question) => (
              <TableRow
                key={question.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(question.id)}
              >
                <TableCell className="text-gray-600">
                  {categoryLabel(question.category)}
                </TableCell>
                <TableCell className="max-w-0">
                  <div className="flex items-center gap-1.5">
                    {question.isSecret && (
                      <LockIcon className="size-3.5 shrink-0 text-gray-400" />
                    )}
                    <span className="truncate text-gray-900">
                      {question.title}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge question={question} />
                </TableCell>
                <TableCell className="text-gray-500">
                  {formatDate(question.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <InquiryDetailDialog
        question={selectedQuestion}
        onClose={() => setSelectedId(null)}
      />
    </section>
  );
}
