'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CancelNoticesPanel } from '../components/cancel-notices';
import { useDirectShipCancelNotices } from '@/lib/services/orders';

// 대기·넘긴 것·올리기·못 보냄 탭은 K3 PR7 Task 4 가 더한다 — 그때까지는 알릴 취소 하나만
export default function DirectShipTemplate() {
  const { data: notices } = useDirectShipCancelNotices();
  const noticeCount = notices?.length ?? 0;

  return (
    <Container>
      <Header title="직배 운영" />
      <Tabs value="cancel-notices" className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="cancel-notices">
              알릴 취소{noticeCount > 0 ? ` ${noticeCount}` : ''}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="cancel-notices">
          <CancelNoticesPanel />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
