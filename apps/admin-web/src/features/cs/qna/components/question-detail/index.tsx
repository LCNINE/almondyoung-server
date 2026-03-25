'use client';

import { Suspense } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useQuestion } from '@/lib/services/qna';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  QuestionCategory,
  QuestionStatus,
} from '@/lib/types/dto/qna';
import { Badge } from '@/components/ui/badge';
import { LockIcon } from 'lucide-react';

function QuestionDetailContent({ questionId }: { questionId: string }) {
  const { data } = useQuestion(questionId);

  const rows: { key: string; value: React.ReactNode }[] = [
    { key: '작성자', value: data.nickname },
    {
      key: '카테고리',
      value: data.category ? CATEGORY_LABELS[data.category] : '-',
    },
    {
      key: '비밀글',
      value: data.isSecret ? (
        <span className="flex items-center gap-1">
          <LockIcon className="h-4 w-4" /> 비밀글
        </span>
      ) : (
        '공개'
      ),
    },
    {
      key: '상태',
      value: (
        <Badge
          variant={
            data.status === 'answered'
              ? 'default'
              : data.status === 'deleted'
                ? 'destructive'
                : 'secondary'
          }
        >
          {STATUS_LABELS[data.status]}
        </Badge>
      ),
    },
    { key: '작성일', value: new Date(data.createdAt).toLocaleString('ko-KR') },
  ];

  return (
    <div className="divide-y">
      <div className="p-4">
        <h2 className="text-lg font-semibold">{data.title}</h2>
      </div>
      <div>
        {rows.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-3 p-3">
            <div className="text-sm font-medium text-gray-500">{key}</div>
            <div className="col-span-2 text-sm">{value ?? '-'}</div>
          </div>
        ))}
      </div>
      <div className="p-4">
        <div className="text-sm font-medium text-gray-500 mb-2">문의 내용</div>
        <div className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-md">
          {data.content}
        </div>
      </div>
      {data.mediaFileIds.length > 0 && (
        <div className="p-4">
          <div className="text-sm font-medium text-gray-500 mb-2">
            첨부파일 ({data.mediaFileIds.length}개)
          </div>
          <div className="flex flex-wrap gap-2">
            {data.mediaFileIds.map((fileId) => (
              <span
                key={fileId}
                className="text-xs bg-gray-100 px-2 py-1 rounded"
              >
                {fileId.slice(0, 8)}...
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QuestionDetail({ questionId }: { questionId: string }) {
  return (
    <Container className="divide-y">
      <Header title="문의 상세" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <QuestionDetailContent questionId={questionId} />
      </Suspense>
    </Container>
  );
}
