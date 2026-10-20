'use client';

import { Suspense } from 'react';
import { ExternalLink } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Copy } from '@/components/admin-ui-experimental/common/copy/copy';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useQuestion } from '@/lib/services/qna';
import { useOptionalAdminUser } from '@/lib/services/users/queries';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { QuestionDeleteButton } from '../question-delete-button';
import { openCustomerWindow } from '../qna-author';

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground w-16 shrink-0 text-[13px]">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1">
        {value ? (
          <>
            <span className="truncate">{value}</span>
            <Copy content={value} />
          </>
        ) : (
          <span className="text-muted-foreground">없음</span>
        )}
      </dd>
    </div>
  );
}

function CustomerCard({ questionId }: { questionId: string }) {
  const { data: question } = useQuestion(questionId);
  const { data: author, isLoading } = useOptionalAdminUser(question.userId);

  return (
    <Container className="p-5">
      <h3 className="text-muted-foreground text-xs">고객</h3>
      {isLoading ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : !author ? (
        <>
          <p className="mt-1 text-base font-bold">{question.nickname}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            회원 정보를 찾지 못했어요. 탈퇴한 회원일 수 있어요.
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-base font-bold">
            {author.username || question.nickname}
          </p>
          <dl className="mt-3">
            <InfoRow label="아이디" value={author.loginId} />
            <InfoRow label="이메일" value={author.email} />
            <InfoRow
              label="전화번호"
              value={
                author.profile?.phoneNumber
                  ? formatPhoneNumber(author.profile.phoneNumber)
                  : null
              }
            />
          </dl>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={() => openCustomerWindow(question.userId)}
          >
            고객 상세 보기
            <ExternalLink className="size-3.5" />
          </Button>
        </>
      )}
    </Container>
  );
}

function QuestionSidebarContent({ questionId }: { questionId: string }) {
  const { data: question } = useQuestion(questionId);

  return (
    <>
      <CustomerCard questionId={questionId} />
      {!question.deletedAt && (
        <div className="flex justify-end">
          <QuestionDeleteButton questionId={questionId} />
        </div>
      )}
    </>
  );
}

export function QuestionSidebar({ questionId }: { questionId: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      }
    >
      <QuestionSidebarContent questionId={questionId} />
    </Suspense>
  );
}
