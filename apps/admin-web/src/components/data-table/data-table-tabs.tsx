'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export type DataTableTabsConfig = {
  /** 탭이 읽고 쓰는 쿼리 파라미터 이름 (prefix 가 붙는다) */
  key: string;
  /** value 가 없는 탭이 "전체" — 파라미터를 지운다 */
  options: { value?: string; label: string; count?: number }[];
};

export function DataTableTabs({
  tabs,
  prefix,
}: {
  tabs: DataTableTabsConfig;
  prefix?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramKey = prefix ? `${prefix}_${tabs.key}` : tabs.key;
  const pageKey = prefix ? `${prefix}_page` : 'page';
  const current = searchParams.get(paramKey) ?? undefined;

  const select = (value: string | undefined) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(paramKey, value);
    else params.delete(paramKey);
    params.delete(pageKey);
    router.replace(`${pathname}?${params}`);
  };

  return (
    <div role="tablist" className="flex flex-wrap gap-1.5 px-6 pt-1">
      {tabs.options.map((tab) => {
        const selected = current === tab.value;
        return (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(tab.value)}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground hover:bg-muted/70'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'tabular-nums',
                  selected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                )}
              >
                {tab.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
