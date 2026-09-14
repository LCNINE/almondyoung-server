import { PRODUCT_AI_GUIDES } from '@packages/product-ai/guides';
import RouteGuard from '@/components/layout/route-guard';

export default function ProductAiGuidePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <header>
          <h1 className="text-2xl font-semibold">상품등록 운영 가이드</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            챗봇이 참조하는 기능 설명입니다. 실시간 상품·가격·재고 조회 결과가
            아닙니다.
          </p>
        </header>
        {PRODUCT_AI_GUIDES.map((guide) => (
          <section
            key={guide.id}
            id={guide.id}
            className="scroll-mt-24 rounded-xl border p-5"
          >
            <h2 className="mb-3 text-lg font-semibold">{guide.title}</h2>
            <p className="text-sm leading-7">{guide.content}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              문서 버전: {guide.id}
            </p>
          </section>
        ))}
      </main>
    </RouteGuard>
  );
}
