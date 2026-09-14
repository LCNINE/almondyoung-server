'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { ProductsListTable } from '../components/table';
import Link from 'next/link';

export default function ProductsListTemplate() {
  return (
    <Container unstyled>
      <Header
        title="상품 목록"
        subtitle="상품을 관리하고 상태를 변경할 수 있습니다."
        right={
          <Link
            href="/mall/product-ai"
            className="inline-flex shrink-0 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            상품등록 AI
          </Link>
        }
      />
      <ProductsListTable />
    </Container>
  );
}
