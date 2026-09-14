import RouteGuard from '@/components/layout/route-guard';
import { Suspense } from 'react';
import ProductAiChat from '@/features/mall/product-ai/product-ai-chat';

export default function ProductAiPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <Suspense fallback={<p className="p-6">대화를 불러오는 중…</p>}>
        <ProductAiChat />
      </Suspense>
    </RouteGuard>
  );
}
