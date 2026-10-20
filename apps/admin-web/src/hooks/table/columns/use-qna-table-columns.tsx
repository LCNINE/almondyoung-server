import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { LockIcon } from 'lucide-react';
import { QuestionDto } from '@/lib/types/dto/qna';
import { QnaStatusCell } from '@/components/table/table-cells/qna';
import {
  QnaAuthor,
  type QnaAuthorInfo,
} from '@/features/cs/qna/components/qna-author';
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  SUB_CATEGORY_LABELS,
  getQuestionSource,
} from '@/lib/types/dto/qna';

const columnHelper = createColumnHelper<QuestionDto>();

interface QnaTableColumnContext {
  userMap: Map<string, QnaAuthorInfo>;
  // 문의 대상 상품 masterId → 상품명 매핑 (상품 문의가 아니면 productId 자체가 null)
  productMap: Map<string, string>;
}

function QuestionCell({
  question,
  productName,
}: {
  question: QuestionDto;
  productName: string | undefined;
}) {
  const category = question.category
    ? [
        CATEGORY_LABELS[question.category],
        question.subCategory &&
          (SUB_CATEGORY_LABELS[question.category][question.subCategory] ??
            question.subCategory),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const context = question.productId
    ? (productName ?? '상품 정보를 불러오지 못했어요')
    : category;

  return (
    <div className="min-w-0 py-1">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>{SOURCE_LABELS[getQuestionSource(question)]}</span>
        {context && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{context}</span>
          </>
        )}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-sm font-medium">
        {question.isSecret && (
          <LockIcon
            className="text-muted-foreground size-3.5 shrink-0"
            aria-label="비밀글"
          />
        )}
        <span className="truncate">{question.title}</span>
      </p>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">
        {question.content}
      </p>
    </div>
  );
}

export const useQnaTableColumns = ({
  userMap,
  productMap,
}: QnaTableColumnContext) => {
  return useMemo(
    () => [
      columnHelper.accessor('status', {
        header: '상태',
        meta: { width: 96 },
        cell: ({ row }) => (
          <QnaStatusCell
            status={row.original.status}
            deletedAt={row.original.deletedAt}
          />
        ),
      }),
      columnHelper.display({
        id: 'question',
        header: '문의',
        cell: ({ row }) => (
          <QuestionCell
            question={row.original}
            productName={
              row.original.productId
                ? productMap.get(row.original.productId)
                : undefined
            }
          />
        ),
      }),
      columnHelper.display({
        id: 'author',
        header: '고객',
        meta: { width: 280 },
        cell: ({ row }) => {
          const { userId, nickname } = row.original;
          return (
            <QnaAuthor
              userId={userId}
              nickname={nickname}
              user={userMap.get(userId)}
            />
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '작성일',
        meta: { width: 152 },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {new Date(getValue()).toLocaleString('ko-KR', {
              year: '2-digit',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        ),
      }),
    ],
    [userMap, productMap]
  );
};
