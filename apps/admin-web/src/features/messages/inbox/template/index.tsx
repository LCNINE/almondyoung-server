'use client';

import { useState } from 'react';
import { useDebounced } from '@/hooks/use-debounced';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSmsConversations } from '@/lib/services/sms-gate';
import { ConversationList } from '../components/conversation-list';
import { ConversationPanel } from '../components/conversation-panel';

export default function SmsInboxTemplate() {
  const [query, setQuery] = useState('');
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useSmsConversations(
    useDebounced(query.trim())
  );
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const conversations = [
    ...new Map((data?.pages.flatMap((page) => page.items) ?? []).map((c) => [c.phoneNumber, c])).values(),
  ];

  return (
    <Container>
      <Header title="받은 문자" subtitle="발송폰으로 들어온 문자를 번호별 대화로 보여줍니다. 답장은 받은 그 폰에서 나갑니다." />

      <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[320px_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Input placeholder="번호·내용 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          {isLoading && <Skeleton className="h-40 w-full" />}
          {isError && <p className="text-destructive text-sm">받은 문자를 불러오지 못했습니다.</p>}
          {data && (
            <ConversationList
              conversations={conversations}
              selectedPhone={selectedPhone}
              onSelect={setSelectedPhone}
            />
          )}
          {hasNextPage && (
            <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? '불러오는 중...' : '더 보기'}
            </Button>
          )}
        </div>
        <ConversationPanel key={selectedPhone ?? 'none'} phoneNumber={selectedPhone} />
      </div>
    </Container>
  );
}
