'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReviewTable } from '../components/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  REVIEW_TABS,
  activeReviewTab,
  nextReviewTabParams,
} from '../lib/review-tabs';

export default function ReviewListTemplate() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const active = activeReviewTab(params);

  const selectTab = (key: string) => {
    const next = nextReviewTabParams(params, key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Container>
      <Header
        title="리뷰 관리"
        right={
          <Button asChild size="sm">
            <Link href="/cs/reviews/new">리뷰 작성</Link>
          </Button>
        }
      />
      <nav
        aria-label="리뷰 구분"
        className="flex flex-wrap gap-2 px-4 py-3"
      >
        {REVIEW_TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={active === tab.key ? 'default' : 'outline'}
            aria-pressed={active === tab.key}
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      <p className="px-4 pb-3 text-sm text-muted-foreground">
        작성 권한과 공개 상태는 별도입니다. 권한 미연결에는 기존 이관 리뷰 등이
        포함되고, 관리자가 이 화면에서 직접 적은 리뷰는 「관리자 수기 작성」에 모입니다.
      </p>
      <ReviewTable />
    </Container>
  );
}
