'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMastersSummary } from '@/lib/services/products/queries';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { cn } from '@/lib/utils';

export type PickedProduct = { id: string; name: string; thumbnail: string | null };

const PAGE_SIZE = 10;

function Thumb({ fileId, name }: { fileId: string | null; name: string }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded border bg-muted">
      <Image
        unoptimized
        src={resolvePublicFileUrl(fileId) ?? '/placeholder.svg'}
        alt={name}
        width={48}
        height={48}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/**
 * 리뷰를 달 상품(core 마스터)을 고른다. 리뷰의 productId 는 마스터 UUID 라 Medusa 상품 선택기를 쓰면 안 된다.
 */
export function ReviewProductPicker({
  value,
  onChange,
  invalid,
}: {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  invalid?: boolean;
}) {
  const [keyword, setKeyword] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching, isError } = useMastersSummary({ q: submitted || undefined, limit: PAGE_SIZE, page: 1 });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Thumb fileId={value.thumbnail} name={value.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{value.id}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
          다른 상품 선택
        </Button>
      </div>
    );
  }

  const products = data?.data ?? [];

  return (
    <div className={cn('flex flex-col gap-2 rounded-md', invalid && 'ring-2 ring-destructive ring-offset-2')}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(keyword.trim());
        }}
      >
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="상품명·품번으로 검색"
          aria-label="상품 검색"
        />
        <Button type="submit" variant="outline" disabled={isFetching}>
          <Search className="h-4 w-4" />
          검색
        </Button>
      </form>
      {isError ? (
        <p className="text-sm text-destructive">상품을 불러오지 못했어요. 다시 검색해 주세요.</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">{isFetching ? '불러오는 중…' : '검색 결과가 없어요.'}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {products.map((product) => (
            <li key={product.masterId} className="flex items-center justify-between gap-3 p-2">
              <div className="flex min-w-0 items-center gap-3">
                <Thumb fileId={product.thumbnail} name={product.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.productCode ?? product.masterId}</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onChange({ id: product.masterId, name: product.name, thumbnail: product.thumbnail })
                }
              >
                선택
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
