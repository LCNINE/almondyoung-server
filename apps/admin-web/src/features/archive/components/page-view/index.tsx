'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  flushArchivePageUpdate,
  useArchivePage,
  useDeleteArchivePage,
  useToggleArchiveFavorite,
  useUpdateArchivePage,
} from '@/lib/services/archive';
import type {
  ArchiveBlock,
  UpdateArchivePageDto,
} from '@/lib/types/dto/archive';
import { PageEditor } from '../page-editor';
import { PageHeader } from '../page-header';
import { PageToolbar, type SaveState } from '../page-toolbar';
import { VersionHistory } from '../version-history';

/** 제목·아이콘은 본문보다 짧게 기다린다 — 사이드바 라벨이 바로 따라와야 하기 때문. */
const META_DEBOUNCE_MS = 500;

type Props = {
  pageId: string;
  onLoaded: (info: {
    space: 'team' | 'private';
    ancestorIds: string[];
  }) => void;
};

export function ArchivePageView({ pageId, onLoaded }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: page, isLoading, isError } = useArchivePage(pageId);

  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const updateMutation = useUpdateArchivePage(page?.space ?? 'team');
  const favoriteMutation = useToggleArchiveFavorite();
  const deleteMutation = useDeleteArchivePage(page?.space ?? 'team');

  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 아직 서버로 못 보낸 제목·아이콘·커버 변경분.
  const pendingMeta = useRef<UpdateArchivePageDto | null>(null);

  // 이미 채워 넣은 페이지인지 기억해 둔다. 즐겨찾기 토글처럼 캐시가 갱신될 때마다
  // 다시 채우면, 아직 저장되지 않은 제목이 서버 값으로 되돌아간다.
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!page || hydratedRef.current === page.id) return;
    hydratedRef.current = page.id;
    setTitle(page.title);
    setIcon(page.icon);
    setCoverUrl(page.coverUrl);
    setSaveState('idle');
    setSavedAt(null);
    onLoaded({
      space: page.space,
      ancestorIds: page.breadcrumbs.map((crumb) => crumb.id),
    });
  }, [page, onLoaded]);

  const save = useCallback(
    (dto: UpdateArchivePageDto) => {
      setSaveState('saving');
      updateMutation.mutate(
        { id: pageId, dto },
        {
          onSuccess: () => {
            setSaveState('saved');
            setSavedAt(new Date());
          },
          onError: () => setSaveState('error'),
        }
      );
    },
    [pageId, updateMutation]
  );

  // 스페이스는 페이지가 도착한 뒤에 정해지므로, 언마운트 시점에 읽을 수 있게 ref 로 둔다.
  const spaceRef = useRef<'team' | 'private'>('team');
  if (page) spaceRef.current = page.space;

  const saveMetaDebounced = useCallback(
    (dto: UpdateArchivePageDto) => {
      pendingMeta.current = { ...pendingMeta.current, ...dto };
      if (metaTimer.current) clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(() => {
        const dtoToSend = pendingMeta.current;
        pendingMeta.current = null;
        if (dtoToSend) save(dtoToSend);
      }, META_DEBOUNCE_MS);
    },
    [save]
  );

  /** 제목 입력에서 포커스가 빠지면 기다리지 않고 바로 올린다 — 가장 흔한 «떠나기» 순간이다. */
  const flushMetaNow = useCallback(() => {
    if (metaTimer.current) clearTimeout(metaTimer.current);
    const dtoToSend = pendingMeta.current;
    pendingMeta.current = null;
    if (dtoToSend) save(dtoToSend);
  }, [save]);

  // 그래도 남은 변경분이 있으면 화면이 사라지는 순간에 직접 올린다.
  useEffect(() => {
    return () => {
      if (metaTimer.current) clearTimeout(metaTimer.current);
      const dtoToSend = pendingMeta.current;
      pendingMeta.current = null;
      if (dtoToSend) {
        void flushArchivePageUpdate(
          queryClient,
          pageId,
          spaceRef.current,
          dtoToSend
        );
      }
    };
  }, [pageId, queryClient]);

  // 본문과 달리 제목·아이콘·커버는 탭을 닫을 때 언마운트 정리가 돌지 않는다.
  // 여기서도 보내기를 시작시키고 경고를 띄우는 것까지가 할 수 있는 전부다.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingMeta.current) return;
      flushMetaNow();
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushMetaNow]);

  const handleBodySave = useCallback(
    ({ content, markdown }: { content: ArchiveBlock[]; markdown: string }) => {
      save({ content, contentMarkdown: markdown });
    },
    [save]
  );

  const handleBodyLeave = useCallback(
    ({ content, markdown }: { content: ArchiveBlock[]; markdown: string }) => {
      void flushArchivePageUpdate(queryClient, pageId, spaceRef.current, {
        content,
        contentMarkdown: markdown,
      });
    },
    [pageId, queryClient]
  );

  const handleDirty = useCallback(() => setSaveState('saving'), []);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 pt-16">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">문서를 열 수 없습니다.</p>
        <p className="text-sm text-muted-foreground">
          지워졌거나, 내가 볼 수 없는 개인 스페이스의 문서일 수 있어요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageToolbar
        breadcrumbs={page.breadcrumbs}
        title={title}
        icon={icon}
        isFavorite={page.isFavorite}
        saveState={saveState}
        savedAt={savedAt}
        onToggleFavorite={() =>
          favoriteMutation.mutate({ id: pageId, favorite: !page.isFavorite })
        }
        onOpenHistory={() => setHistoryOpen(true)}
        onDelete={() =>
          deleteMutation.mutate(pageId, {
            onSuccess: () => {
              toast.success('휴지통으로 옮겼습니다.');
              router.push('/archive');
            },
            onError: () => toast.error('삭제하지 못했습니다.'),
          })
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-40">
        <PageHeader
          title={title}
          icon={icon}
          coverUrl={coverUrl}
          onTitleChange={(next) => {
            setTitle(next);
            saveMetaDebounced({ title: next });
          }}
          onTitleBlur={flushMetaNow}
          onIconChange={(next) => {
            setIcon(next);
            saveMetaDebounced({ icon: next ?? '' });
          }}
          onCoverChange={(next) => {
            setCoverUrl(next);
            saveMetaDebounced({ coverUrl: next ?? '' });
          }}
        />

        <div className="mx-auto max-w-3xl px-6 pt-2">
          <PageEditor
            key={pageId}
            pageId={pageId}
            space={page.space}
            initialContent={page.content}
            onSave={handleBodySave}
            onLeave={handleBodyLeave}
            onDirtyChange={handleDirty}
          />
        </div>
      </div>

      <VersionHistory
        pageId={pageId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}
