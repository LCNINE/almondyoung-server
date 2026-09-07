'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, FolderTree, Loader2 } from 'lucide-react';
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
import {
  useArchiveRecent,
  useArchiveSearch,
  useArchiveTree,
} from '@/lib/services/archive';
import type { ArchiveSpace } from '@/lib/types/dto/archive';

export type PickedArchivePage = {
  id: string;
  title: string;
  icon: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: ArchiveSpace;
  /** 이 문서의 본문에 넣는다. 바로 밑 자식들을 맨 위에 따로 보여 주는 기준이기도 하다. */
  hostPageId: string;
  /** 고를 수 없는 문서 — 자기 자신과 조상(하위로 넣으면 트리가 자기 자신을 물게 된다). */
  excludeIds?: ReadonlySet<string>;
  /** 이미 본문에 들어 있는 문서 — 두 번 넣어도 소용이 없으니 목록에서 뺀다. */
  alreadyInBody?: ReadonlySet<string>;
  onPick: (pages: PickedArchivePage[]) => void;
};

/** 서버 검색은 본문까지 훑는 대신 상한이 있다. 제목으로 찾는 건 이미 받아 둔 트리가 더 정확하다. */
const TITLE_MATCH_LIMIT = 20;

/**
 * 이미 있는 문서를 골라 본문에 넣는다.
 *
 * 🔴 **바로 밑 자식을 맨 위에 따로 둔다.** 서버 검색은 제목·본문 부분일치라 상한(30건)에 걸리고,
 * 「리테일」 밑의 「AK FORM 발급 메뉴얼」처럼 부모 이름을 안 가진 자식은 부모 이름으로 검색해도
 * 안 나온다. 정작 제일 많이 하는 일이 «내 밑에 있는 걸 본문에 늘어놓기»인데 그게 제일 어려웠다.
 */
export function ArchivePagePicker({
  open,
  onOpenChange,
  space,
  hostPageId,
  excludeIds,
  alreadyInBody,
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

  const { data: nodes } = useArchiveTree(space);
  const { data: result, isFetching } = useArchiveSearch(debounced);
  const { data: recent } = useArchiveRecent();

  const trimmed = debounced.trim();

  const hidden = useMemo(() => {
    const ids = new Set<string>(excludeIds ?? []);
    for (const id of alreadyInBody ?? []) ids.add(id);
    return ids;
  }, [alreadyInBody, excludeIds]);

  /** 바로 밑 자식. 사이드바가 이미 받아 둔 트리라 추가 요청이 없다. */
  const children = useMemo(
    () =>
      (nodes ?? [])
        .filter((node) => node.parentId === hostPageId && !hidden.has(node.id))
        .map((node) => ({ id: node.id, title: node.title, icon: node.icon })),
    [hidden, hostPageId, nodes]
  );

  /** 제목 부분일치 — 서버 상한과 무관하게 이름만 알면 찾을 수 있어야 한다. */
  const titleMatches = useMemo(() => {
    if (trimmed.length === 0) return [];
    const needle = trimmed.toLowerCase();
    return (nodes ?? [])
      .filter(
        (node) =>
          !hidden.has(node.id) && node.title.toLowerCase().includes(needle)
      )
      .slice(0, TITLE_MATCH_LIMIT)
      .map((node) => ({ id: node.id, title: node.title, icon: node.icon }));
  }, [hidden, nodes, trimmed]);

  const titleMatchIds = useMemo(
    () => new Set(titleMatches.map((page) => page.id)),
    [titleMatches]
  );

  // 제목으로 이미 보여 준 것을 본문 검색 결과에 또 늘어놓지 않는다.
  const hits = (result?.hits ?? []).filter(
    (hit) => !hidden.has(hit.id) && !titleMatchIds.has(hit.id)
  );
  const recents = (recent ?? []).filter((page) => !hidden.has(page.id));
  const showRecent = trimmed.length < 2;

  const heading = result?.hasMore
    ? `본문에서 찾은 결과 ${hits.length}건 — 더 있어요. 검색어를 좁혀보세요`
    : `본문에서 찾은 결과 ${hits.length}건`;

  // 고른 것을 먼저 넘기고 닫는다 — 닫기를 «취소»로 다루는 호출부가 있어서,
  // 순서가 바뀌면 방금 고른 것이 취소로 지워진다.
  const pick = (pages: PickedArchivePage[]) => {
    if (pages.length > 0) onPick(pages);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>본문에 넣을 문서 고르기</DialogTitle>
          <DialogDescription>
            이미 있는 문서를 골라 이 문서의 본문에 하위 페이지로 넣습니다.
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
            {children.length > 0 ? (
              <CommandGroup
                heading={`이 문서의 하위 문서 ${children.length}개 — 아직 본문에 없는 것`}
              >
                {children.length > 1 ? (
                  <CommandItem
                    value="__all-children__"
                    onSelect={() => pick(children)}
                    className="gap-2 font-medium"
                  >
                    <FolderTree className="size-4" aria-hidden />
                    {children.length}개 모두 넣기
                  </CommandItem>
                ) : null}
                {children.map((page) => (
                  <PageRow
                    key={page.id}
                    page={page}
                    onSelect={() => pick([page])}
                  />
                ))}
              </CommandGroup>
            ) : null}

            {trimmed.length > 0 && titleMatches.length > 0 ? (
              <CommandGroup heading="제목이 맞는 문서">
                {titleMatches.map((page) => (
                  <PageRow
                    key={page.id}
                    page={page}
                    onSelect={() => pick([page])}
                  />
                ))}
              </CommandGroup>
            ) : null}

            {showRecent ? (
              recents.length > 0 ? (
                <CommandGroup heading="최근 수정한 문서">
                  {recents.map((page) => (
                    <PageRow
                      key={page.id}
                      page={page}
                      onSelect={() => pick([page])}
                    />
                  ))}
                </CommandGroup>
              ) : null
            ) : (
              <>
                {isFetching ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    찾는 중…
                  </div>
                ) : titleMatches.length === 0 && hits.length === 0 ? (
                  <CommandEmpty>일치하는 문서가 없습니다.</CommandEmpty>
                ) : null}

                {hits.length > 0 ? (
                  <CommandGroup heading={heading}>
                    {hits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={hit.id}
                        onSelect={() =>
                          pick([
                            { id: hit.id, title: hit.title, icon: hit.icon },
                          ])
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

function PageRow({
  page,
  onSelect,
}: {
  page: PickedArchivePage;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={page.id} onSelect={onSelect}>
      <span className="w-5 text-base leading-none">
        {page.icon ? (
          page.icon
        ) : (
          <FileText className="size-4 opacity-60" aria-hidden />
        )}
      </span>
      <span className="truncate">{page.title || '제목 없음'}</span>
    </CommandItem>
  );
}
