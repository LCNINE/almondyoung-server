'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { ShoppingCart } from 'lucide-react';
import { PurchaseOrdersTable } from '../components/table';
import { CartDrawer } from '../components/cart-drawer';

export default function PurchaseOrdersTemplate() {
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <Container className="divide-y-0">
      <Header
        title="발주관리"
        subtitle="공급처별 발주를 생성하고 심사 및 입고 상태를 관리합니다."
        right={
          <Button variant="outline" size="sm" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="mr-1.5 h-4 w-4" />
            발주 카트
          </Button>
        }
      />
      <PurchaseOrdersTable />
      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} />
    </Container>
  );
}
