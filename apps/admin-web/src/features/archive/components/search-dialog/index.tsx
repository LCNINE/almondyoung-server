'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2 } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useArchiveRecent, useArchiveSearch } from '@/lib/services/archive';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ArchiveSearchDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // 글자마다 서버를 때리지 않는다 — 검색은 본문 전체를 훑는 조회다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { data: result, isFetching } = useArchiveSearch(debounced);
  const { data: recent } = useArchiveRecent();

  const hits = result?.hits ?? [];
  const showRecent = debounced.trim().length < 2;

  /**
   * 상한에 걸린 결과를 «N건»으로 쓰면 그게 전체 건수로 읽힌다.
   * 잘렸을 때는 잘렸다고 쓰고, 좁히라는 안내를 같이 준다.
   */
  const heading = result?.hasMore
    ? `가장 최근 ${hits.length}건 — 더 있어요. 검색어를 좁혀보세요`
    : `검색 결과 ${hits.length}건`;

  const go = (id: string) => {
    onOpenChange(false);
    router.push(`/archive/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 헤더가 DialogContent 밖에 있으면 닫혀 있을 때도 이 문구가 화면 본문에 남아 읽힌다. */}
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>아카이브 검색</DialogTitle>
          <DialogDescription>
            제목과 본문에서 문서를 찾습니다.
          </DialogDescription>
        </DialogHeader>
        {/* 서버가 이미 걸러 온 결과라 cmdk 가 한 번 더 거르면 한글 조합 중에 결과가 사라진다. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="문서 제목이나 본문 내용을 입력하세요…"
          />
          <CommandList>
            {showRecent ? (
              <CommandGroup heading="최근 수정한 문서">
                {(recent ?? []).map((page) => (
                  <CommandItem
                    key={page.id}
                    value={page.id}
                    onSelect={() => go(page.id)}
                  >
                    <span className="w-5 text-base leading-none">
                      {page.icon ? (
                        page.icon
                      ) : (
                        <FileText className="size-4 opacity-60" aria-hidden />
                      )}
                    </span>
                    <span className="truncate">
                      {page.title || '제목 없음'}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <>
                {isFetching ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    찾는 중…
                  </div>
                ) : (
                  <CommandEmpty>일치하는 문서가 없습니다.</CommandEmpty>
                )}

                {hits.length > 0 ? (
                  <CommandGroup heading={heading}>
                    {hits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={hit.id}
                        onSelect={() => go(hit.id)}
                        className="items-start gap-2 py-2"
                      >
                        <span className="w-5 pt-0.5 text-base leading-none">
                          {hit.icon ? (
                            hit.icon
                          ) : (
                            <FileText
                              className="size-4 opacity-60"
                              aria-hidden
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {hit.title || '제목 없음'}
                          </span>
                          {hit.breadcrumbs.length > 0 ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {hit.breadcrumbs
                                .map((crumb) => crumb.title || '제목 없음')
                                .join(' / ')}
                            </span>
                          ) : null}
                          {hit.snippet ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {hit.snippet}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
