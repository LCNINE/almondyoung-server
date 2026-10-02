'use client';

import { useShopListing } from '@/lib/services/products';
import { ModerationBar } from '../components/moderation-bar';
import { ModerationHistory } from '../components/moderation-history';
import { ShopListingForm } from '../components/shop-listing-form';

type Props = {
  id?: string;
};

export default function ShopListingEditorTemplate({ id }: Props) {
  const { data, isLoading, refetch } = useShopListing(id ?? '');

  if (id && isLoading) {
    return <p className="text-muted-foreground p-4 text-sm">불러오는 중…</p>;
  }

  if (id && !data) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        글을 찾을 수 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {data && (
        <ModerationBar listing={data} onRefresh={() => void refetch()} />
      )}
      {/*
        판정 바와 폼이 같은 판을 보여야 한다 — 409(그사이 회원이 고쳤거나 상태가 바뀜) 뒤
        refetch 되면 ModerationBar 는 새 submittedAt 을 보지만, 폼이 다시 마운트되지 않으면
        예전 본문/미리보기를 그대로 든 채 새 submittedAt 으로 두 번째 승인이 CAS 를 통과해
        검토 안 된 버전이 게시된다. submittedAt 이 바뀌면 폼을 새로 띄운다.
        updatedAt 은 쓰지 않는다 — 상태 전이(숨김·재개 등)만으로도 바뀌어 미저장 편집을 날린다.
      */}
      <ShopListingForm
        key={data ? `${data.id}:${data.submittedAt ?? ''}` : 'new'}
        listing={data}
      />
      {data && <ModerationHistory items={data.moderations} />}
    </div>
  );
}
