'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useBannerGroup } from '@/lib/services/products';
import { GroupForm } from '../components/group-form';
import { BannersTable } from '../components/banners-table';

type Props = {
  id: string;
};

export default function BannerGroupDetailTemplate({ id }: Props) {
  const { data: group, isLoading } = useBannerGroup(id);

  if (isLoading) {
    return (
      <Container>
        <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
      </Container>
    );
  }

  if (!group) {
    return (
      <Container>
        <div className="p-6 text-sm text-muted-foreground">배너 그룹을 찾을 수 없습니다.</div>
      </Container>
    );
  }

  return (
    <>
      <Container>
        <Header title={group.title} subtitle={`코드: ${group.code}`} />
        <GroupForm group={group} />
      </Container>

      <Container className="mt-3 divide-y-0">
        <Header title="소속 배너" subtitle="이 그룹에 속한 배너를 관리합니다." />
        <BannersTable groupId={id} />
      </Container>
    </>
  );
}
