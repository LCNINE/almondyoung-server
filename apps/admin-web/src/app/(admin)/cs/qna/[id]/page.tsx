import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { QuestionDetail } from '@/features/cs/qna/components/question-detail';
import { AnswerForm } from '@/features/cs/qna/components/answer-form';
import RouteGuard from '@/components/layout/route-guard';

export default async function QnaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TwoColumnPage>
          <QuestionDetail questionId={id} />
          <AnswerForm questionId={id} />
        </TwoColumnPage>
      </div>
    </RouteGuard>
  );
}
