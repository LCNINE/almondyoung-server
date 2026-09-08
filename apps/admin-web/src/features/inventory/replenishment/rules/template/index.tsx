'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GradesTab } from '../components/grades-tab';
import { RoutesTab } from '../components/routes-tab';
import { SettingsTab } from '../components/settings-tab';
import { SkuOverridesTab } from '../components/sku-overrides-tab';
import { SuppliersTab } from '../components/suppliers-tab';

const TABS = ['settings', 'grades', 'suppliers', 'routes', 'skus'] as const;
type RulesTab = (typeof TABS)[number];

export default function ReplenishmentRulesTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get('tab');
  const tab: RulesTab = TABS.find((t) => t === raw) ?? 'settings';

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container>
      <Header
        title="보충 규칙"
        subtitle="안전재고 계산의 입력. α · 리드타임 · 커버 · 예외는 저장 즉시, 창 · 임계 · 등급 컷 · D0 는 다음 재계산에 반영됩니다."
        right={
          <Button asChild variant="outline">
            <Link href="/inventory/replenishment">보충 제안으로</Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="settings">전역</TabsTrigger>
            <TabsTrigger value="grades">등급</TabsTrigger>
            <TabsTrigger value="suppliers">공급사</TabsTrigger>
            <TabsTrigger value="routes">경로</TabsTrigger>
            <TabsTrigger value="skus">SKU 예외</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="grades">
          <GradesTab />
        </TabsContent>
        <TabsContent value="suppliers">
          <SuppliersTab />
        </TabsContent>
        <TabsContent value="routes">
          <RoutesTab />
        </TabsContent>
        <TabsContent value="skus">
          <SkuOverridesTab />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
