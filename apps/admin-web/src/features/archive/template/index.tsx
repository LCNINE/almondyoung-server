'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="flex h-full min-h-0">
      <ArchiveSidebar
        space={space}
        onSpaceChange={changeSpace}
        activeId={pageId}
        expandedIds={expandedIds}
        onToggleExpanded={toggleExpanded}
        onExpand={expand}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {pageId ? (
          <ArchivePageView
            key={pageId}
            pageId={pageId}
            onLoaded={handlePageLoaded}
          />
        ) : (
          <EmptyState
            onCreate={() => void createRootPage()}
            onSearch={() => setSearchOpen(true)}
            creating={createMutation.isPending}
          />
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
