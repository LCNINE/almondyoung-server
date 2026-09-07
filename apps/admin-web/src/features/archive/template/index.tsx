'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { ArchiveSpace } from '@/lib/types/dto/archive';
import { useCreateArchivePage } from '@/lib/services/archive';
import { ArchiveSidebar } from '../components/archive-sidebar';
import { ArchivePageView } from '../components/page-view';
import { ArchiveSearchDialog } from '../components/search-dialog';
import { ArchiveTrashDialog } from '../components/trash-dialog';

const SPACE_STORAGE_KEY = 'admin-web:archive:space';

type Props = {
  pageId?: string;
};

export function ArchiveTemplate({ pageId }: Props) {
  const router = useRouter();
  const [space, setSpace] = useState<ArchiveSpace>('team');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // 좁은 화면에서 문서 목록은 드로어로 뜬다. md 이상에서는 늘 고정으로 붙어 있어 쓰지 않는다.
  const [navOpen, setNavOpen] = useState(false);
  const createMutation = useCreateArchivePage();

  // 마지막으로 보던 스페이스를 기억한다. 저장소를 못 읽는 환경(사생활 보호 모드 등)에서는
  // 기본값 그대로 뜨면 되므로 실패를 삼킨다.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SPACE_STORAGE_KEY);
      if (stored === 'team' || stored === 'private') setSpace(stored);
    } catch {
      // 무시 — 기본 스페이스로 시작한다.
    }
  }, []);

  const changeSpace = useCallback((next: ArchiveSpace) => {
    setSpace(next);
    try {
      localStorage.setItem(SPACE_STORAGE_KEY, next);
    } catch {
      // 무시 — 이번 세션 동안만 유지된다.
    }
  }, []);

  const expand = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setExpandedIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 링크로 바로 들어온 문서도 사이드바에서 위치가 보여야 한다.
  const handlePageLoaded = useCallback(
    ({
      space: pageSpace,
      ancestorIds,
    }: {
      space: ArchiveSpace;
      ancestorIds: string[];
    }) => {
      setSpace((current) => (current === pageSpace ? current : pageSpace));
      expand(ancestorIds);
    },
    [expand]
  );

  // 화면이 넓어지면 목록이 고정으로 붙으므로 드로어는 닫아 둔다.
  // 안 닫으면 포커스가 안 보이는 드로어 안에 갇힌다.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      if (wide.matches) setNavOpen(false);
    };
    sync();
    wide.addEventListener('change', sync);
    return () => wide.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const createRootPage = async () => {
    try {
      const page = await createMutation.mutateAsync({ space });
      router.push(`/archive/${page.id}`);
    } catch {
      toast.error('페이지를 만들지 못했습니다.');
    }
  };

  const sidebarProps = {
    space,
    onSpaceChange: changeSpace,
    activeId: pageId,
    expandedIds,
    onToggleExpanded: toggleExpanded,
    onExpand: expand,
    onOpenSearch: () => setSearchOpen(true),
    onOpenTrash: () => setTrashOpen(true),
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 넓은 화면 — 목록이 늘 붙어 있다. 태블릿 가로(768)면 목록 288 + 본문 480 이라
          두 단이 다 읽히므로, 거기서부터 드로어를 접는다. */}
      <div className="hidden h-full md:flex">
        <ArchiveSidebar {...sidebarProps} />
      </div>

      {/* 좁은 화면 — 목록은 드로어로 뜨고, 문서를 고르면 닫힌다. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-[19rem] max-w-[85vw] gap-0 p-0 sm:max-w-[19rem] md:hidden"
        >
          <SheetTitle className="sr-only">문서 목록</SheetTitle>
          <ArchiveSidebar
            {...sidebarProps}
            variant="drawer"
            onNavigate={() => setNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {pageId ? (
          <ArchivePageView
            key={pageId}
            pageId={pageId}
            onLoaded={handlePageLoaded}
            onOpenNav={() => setNavOpen(true)}
          />
        ) : (
          <>
            {/* 좁은 화면에서 첫 화면이 «아무것도 없는 화면»이면 안 된다 — 목록이 그 자리를 채운다. */}
            <div className="min-h-0 flex-1 md:hidden">
              <ArchiveSidebar {...sidebarProps} variant="inline" />
            </div>
            <div className="hidden min-h-0 flex-1 md:block">
              <EmptyState
                onCreate={() => void createRootPage()}
                onSearch={() => setSearchOpen(true)}
                creating={createMutation.isPending}
              />
            </div>
          </>
        )}
      </main>

      <ArchiveSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ArchiveTrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
    </div>
  );
}

function EmptyState({
  onCreate,
  onSearch,
  creating,
}: {
  onCreate: () => void;
  onSearch: () => void;
  creating: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <BookOpen className="size-10 text-muted-foreground/40" aria-hidden />
      <div>
        <h1 className="text-lg font-semibold">아카이브</h1>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          운영 매뉴얼·회의록·정책처럼 오래 남겨 둘 문서를 여기에 씁니다.
          왼쪽에서 문서를 고르거나 새로 만들어 보세요.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="gap-1.5"
        >
          <Plus className="size-4" aria-hidden />새 페이지
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onSearch}
          className="gap-1.5"
        >
          <Search className="size-4" aria-hidden />
          검색
        </Button>
      </div>
    </div>
  );
}
