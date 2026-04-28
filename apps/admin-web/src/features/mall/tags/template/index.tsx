'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { TwoColumnPage } from '@/components/admin-ui-experimental/layout/two-column-page';
import { GroupList } from '../components/group-list';
import { ValueList } from '../components/value-list';

export default function TagsTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selectedGroupId = searchParams.get('groupId') ?? undefined;

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('groupId', groupId);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container className="divide-y-0">
      <Header title="태그 관리" subtitle="태그 그룹과 태그 값을 관리합니다." />
      <div className="p-4">
        <TwoColumnPage>
          <TwoColumnPage.Main>
            <GroupList
              selectedGroupId={selectedGroupId}
              onSelectGroup={handleSelectGroup}
            />
          </TwoColumnPage.Main>
          <TwoColumnPage.Sidebar>
            {selectedGroupId ? (
              <ValueList groupId={selectedGroupId} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                좌측에서 태그 그룹을 선택해 주세요.
              </div>
            )}
          </TwoColumnPage.Sidebar>
        </TwoColumnPage>
      </div>
    </Container>
  );
}
