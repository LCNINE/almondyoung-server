'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBannerGroup } from '@/lib/services/products';
import { GroupForm } from '../components/group-form';
import { BannersTable } from '../components/banners-table';

type Props = {
  id: string;
};

const LIST_PATH = '/mall/banner-groups';

export default function BannerGroupDetailTemplate({ id }: Props) {
  const { data: group, isLoading } = useBannerGroup(id);

  if (isLoading) {
    return (
      <div className="text-muted-foreground p-10 text-sm">불러오는 중...</div>
    );
  }

  if (!group) {
    return (
      <div className="p-10 text-sm">
        <p className="text-muted-foreground">배너 그룹을 찾을 수 없습니다.</p>
        <Button variant="outline" size="sm" className="mt-3" asChild>
          <Link href={LIST_PATH}>목록으로</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-white px-8 py-6">
      <nav className="text-muted-foreground mb-6 flex items-center gap-1 text-[13px]">
        <Link href={LIST_PATH} className="hover:text-foreground">
          배너 그룹
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-semibold">{group.title}</span>
      </nav>

      <GroupForm group={group} />
      <BannersTable groupId={id} />

      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link href={LIST_PATH}>목록으로</Link>
        </Button>
      </div>
    </div>
  );
}
