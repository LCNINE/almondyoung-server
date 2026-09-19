'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Search, X } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import { mainMenus, type MenuItem } from '@/lib/utils/menu';

interface MenuEntry {
  label: string;
  path: string;
  requireRole?: string[];
}

const walk = (items: MenuItem[], trail: string[]): MenuEntry[] =>
  items.flatMap((item) => {
    const t = [...trail, item.title];
    const self =
      item.path && !item.isComingSoon
        ? [{ label: t.join(' > '), path: item.path, requireRole: item.requireRole }]
        : [];
    return [...self, ...walk(item.children ?? [], t)];
  });

const MENU_ENTRIES = mainMenus.flatMap((m) => walk(m.children, [m.title]));

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(keyword); at !== -1; at = lower.indexOf(keyword, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <strong key={at} className="font-bold text-gray-900">
        {text.slice(at, at + keyword.length)}
      </strong>
    );
    from = at + keyword.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function HeaderSearch() {
  const router = useRouter();
  const { hasRole } = usePermission();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const keyword = query.trim().toLowerCase();
  const results = keyword
    ? MENU_ENTRIES.filter(
        (e) =>
          e.label.toLowerCase().includes(keyword) &&
          (!e.requireRole || hasRole(e.requireRole) === true)
      )
    : [];

  const go = (path: string) => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    router.push(path);
  };

  return (
    <Command
      shouldFilter={false}
      label="메뉴 검색"
      className="relative w-[280px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          inputRef.current?.blur();
        }
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="메뉴 검색"
          className="h-9 w-full rounded-[3px] border border-[#d6dae1] bg-white pl-9 pr-8 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500"
        />
        {query && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-gray-300 text-white hover:bg-gray-400"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {open && keyword && (
        <Command.List className="absolute left-0 right-0 top-full z-50 -mt-px max-h-[460px] overflow-y-auto rounded-b-[4px] border border-[#e2e5ea] bg-white py-1 shadow-md">
          <Command.Empty className="px-3 py-2 text-[13px] text-gray-500">
            검색 결과가 없습니다
          </Command.Empty>
          {results.map((e) => (
            <Command.Item
              key={e.label}
              value={e.label}
              onSelect={() => go(e.path)}
              onMouseDown={(ev) => ev.preventDefault()}
              className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-[13px] leading-[18px] text-gray-700 data-[selected=true]:bg-gray-100"
            >
              <Search className="mt-0.5 size-3.5 shrink-0 text-gray-400" />
              <span>
                <span className="text-gray-500">[메뉴] </span>
                <Highlight text={e.label} keyword={keyword} />
              </span>
            </Command.Item>
          ))}
        </Command.List>
      )}
    </Command>
  );
}
