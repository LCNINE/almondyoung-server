import RouteGuard from '@/components/layout/route-guard';
import QnaListTemplate from '@/features/cs/qna/template';

export default function QnaPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <QnaListTemplate />
      </div>
    </RouteGuard>
  );
}
