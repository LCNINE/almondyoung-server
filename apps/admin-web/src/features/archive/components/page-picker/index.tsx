'use client';

import { useEffect, useState } from 'react';
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

export type PickedArchivePage = {
  id: string;
  title: string;
  icon: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 고를 수 없는 문서 — 자기 자신과 조상(하위로 넣으면 트리가 자기 자신을 물게 된다). */
  excludeIds?: ReadonlySet<string>;
  onPick: (page: PickedArchivePage) => void;
};

/**
 * 이미 있는 문서를 하나 고른다. 검색 다이얼로그와 목록 모양은 같지만, 고른 결과를
 * 「열기」가 아니라 부르는 쪽으로 돌려준다 — 본문에 넣기·옮기기 같은 데 쓴다.
 */
export function ArchivePagePicker({
  open,
  onOpenChange,
  excludeIds,
  onPick,
}: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
    }
  }, [open]);

  const { data: result, isFetching } = useArchiveSearch(debounced);
  const { data: recent } = useArchiveRecent();

  const excluded = (id: string) => Boolean(excludeIds?.has(id));
  const hits = (result?.hits ?? []).filter((hit) => !excluded(hit.id));
  const recents = (recent ?? []).filter((page) => !excluded(page.id));
  const showRecent = debounced.trim().length < 2;

  const heading = result?.hasMore
    ? `가장 최근 ${hits.length}건 — 더 있어요. 검색어를 좁혀보세요`
    : `검색 결과 ${hits.length}건`;

  // 고른 것을 먼저 넘기고 닫는다 — 닫기를 «취소»로 다루는 호출부가 있어서,
  // 순서가 바뀌면 방금 고른 것이 취소로 지워진다.
  const pick = (page: PickedArchivePage) => {
    onPick(page);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>본문에 넣을 문서 고르기</DialogTitle>
          <DialogDescription>
            이미 있는 문서를 골라 이 문서의 하위 페이지로 넣습니다.
          </DialogDescription>
        </DialogHeader>
        {/* 서버가 이미 걸러 온 결과라 cmdk 가 한 번 더 거르면 한글 조합 중에 결과가 사라진다. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="넣을 문서의 제목이나 내용을 입력하세요…"
          />
          <CommandList>
            {showRecent ? (
              <CommandGroup heading="최근 수정한 문서">
                {recents.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={page.id}
                    onSelect={() =>
                      pick({ id: page.id, title: page.title, icon: page.icon })
                    }
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
                        onSelect={() =>
                          pick({ id: hit.id, title: hit.title, icon: hit.icon })
                        }
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
