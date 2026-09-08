'use client';

import Link from 'next/link';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { ReplenishmentTable } from '../components/table';

export default function ReplenishmentTemplate() {
  return (
    <Container>
      <Header
        title="보충 제안"
        subtitle="판매 창고 부족은 이동으로, 전사 부족은 발주로. 발주잔량·이동중·중국 재고를 반영합니다."
        right={
          <Button asChild variant="outline">
            <Link href="/inventory/replenishment/rules">보충 규칙</Link>
          </Button>
        }
      />
      <ReplenishmentTable />
    </Container>
  );
}
