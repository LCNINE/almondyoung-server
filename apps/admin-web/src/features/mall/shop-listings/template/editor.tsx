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
      <ShopListingForm key={data?.id ?? 'new'} listing={data} />
      {data && <ModerationHistory items={data.moderations} />}
    </div>
  );
}
