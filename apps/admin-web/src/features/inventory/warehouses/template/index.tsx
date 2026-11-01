'use client';

import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { useCreateWarehouse } from '@/lib/services/inventory';
import { WarehousesTable } from '../components/table';

export default function WarehousesTemplate() {
  return (
    <Container>
      <Header
        title="창고 관리"
        subtitle="창고가 지원하는 피킹 방식을 설정합니다. 방식이 없으면 출고 배치를 만들 수 없습니다."
        right={
          <Can run={useCreateWarehouse}>
            <Button asChild>
              <Link href="/inventory/warehouses/new">만들기</Link>
            </Button>
          </Can>
        }
      />
      <WarehousesTable />
    </Container>
  );
}
