'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReviewTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';

const PROVIDER_TABS = [
  { value: '', label: '전체' },
  { value: 'order', label: '주문 권한 리뷰' },
  { value: 'admin', label: '관리자 권한 리뷰' },
  { value: 'unassigned', label: '권한 미연결' },
] as const;

export default function ReviewListTemplate() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const provider = params.get('provider') ?? '';

  const selectProvider = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('provider', value);
    else next.delete('provider');
    next.delete('page');
    next.delete('batchId');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Container>
      <Header title="리뷰 관리" />
      <nav
        aria-label="리뷰 작성 권한"
        className="flex flex-wrap gap-2 px-4 py-3"
      >
        {PROVIDER_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={provider === tab.value ? 'default' : 'outline'}
            aria-pressed={provider === tab.value}
            onClick={() => selectProvider(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      <p className="px-4 pb-3 text-sm text-muted-foreground">
        작성 권한과 공개 상태는 별도입니다. 권한 미연결에는 기존 이관 리뷰 등이
        포함됩니다.
      </p>
      <ReviewTable />
    </Container>
  );
}
