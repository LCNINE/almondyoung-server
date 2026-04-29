'use client';

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MovementHistoryTable } from '../components/movement-history-table';
import { MoveDialog } from '../components/move-dialog';

type MovementTab = 'move' | 'history';

export default function MovementTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [moveOpen, setMoveOpen] = useState(false);

  const tab = (searchParams.get('tab') as MovementTab) ?? 'move';

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container className="divide-y-0">
      <Header
        title="재고 즉시 이동"
        subtitle="동일 창고 내 위치 간 재고를 즉시 이동합니다. 잡(job) 기반 계획 이동은 재고 이동(잡) 메뉴를 이용하세요."
        right={
          <Button onClick={() => setMoveOpen(true)}>즉시 이동</Button>
        }
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="move">이동 실행</TabsTrigger>
            <TabsTrigger value="history">이동 이력</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="move">
          <div className="p-6">
            <p className="text-sm text-muted-foreground mb-4">
              즉시 이동 버튼을 눌러 창고 내 SKU를 다른 위치로 이동하세요.
              이동은 단일 트랜잭션으로 즉시 반영됩니다.
            </p>
            <Button onClick={() => setMoveOpen(true)}>즉시 이동 실행</Button>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <MovementHistoryTable />
        </TabsContent>
      </Tabs>

      <MoveDialog open={moveOpen} onOpenChange={setMoveOpen} />
    </Container>
  );
}
