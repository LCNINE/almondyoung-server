'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormSelect } from '@/components/common/form';
import {
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
  parsePageSize,
} from './products-list-page-size-model';

const OPTIONS = PAGE_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: `${size}개씩`,
}));

export function PageSizeSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = parsePageSize(searchParams.get('size'));

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const size = parsePageSize(next);
    if (size === DEFAULT_PAGE_SIZE) {
      params.delete('size');
    } else {
      params.set('size', String(size));
    }
    // 표시 개수가 바뀌면 기존 page 번호는 범위 밖일 수 있다. 1쪽으로 되돌린다.
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="w-28">
      <FormSelect
        options={OPTIONS}
        value={String(current)}
        onValueChange={handleChange}
      />
    </div>
  );
}
