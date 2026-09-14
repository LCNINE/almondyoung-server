'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Trash2,
  Pencil,
  Plus,
  Paperclip,
  X,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Square,
  ArrowDown,
  MessageSquare,
  History,
  Loader2,
  MessageSquarePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  productAiClient,
  type ProductAiMessage,
} from '@/lib/api/domains/products/product-ai.client';
import styles from './product-ai-chat.module.css';
import { useChatScroll } from './use-chat-scroll';
import { useChatImages } from './use-chat-images';
import { ProductAiDraftPreview } from './product-ai-draft-preview';

const starterQuestions = [
  {
    topic: '시작하기',
    icon: '✦',
    label: '어떤 도움을 받을 수 있나요?',
    question: '지금 도와줄 수 있는 일과 아직 지원하지 않는 일을 알려주세요.',
  },
  {
    topic: '가격 · 멤버십',
    icon: '₩',
    label: '가격 기준을 정리하고 싶어요',
    question: '판매가·멤버십가·공급가는 어떻게 다른가요?',
  },
  {
    topic: '재고',
    icon: '▦',
    label: '기존 재고와 연결하려면?',
    question: '기존 재고와 매칭하려면 무엇이 필요한가요?',
  },
  {
    topic: '카테고리',
    icon: '⌘',
    label: '분류 기준이 궁금해요',
    question: '대표카테고리는 무엇이고 어떻게 선택하나요?',
  },
  {
    topic: '콘텐츠',
    icon: '✎',
    label: '이미지는 어떻게 준비하죠?',
    question: '대표·부가·상세페이지 이미지는 어떻게 준비하나요?',
  },
  {
    topic: '검색 · SEO',
    icon: '⌕',
    label: '검색에 잘 보이게 하려면?',
    question: 'SEO 제목·태그·키워드는 어떻게 작성하나요?',
  },
  {
    topic: '상품',
    icon: '+',
    label: '새 상품을 준비하고 있어요',
    question: '상품등록에 필요한 정보를 하나씩 물어봐 주세요.',
  },
  {
    topic: '옵션',
    icon: '◇',
    label: '색상과 사이즈를 구성해요',
    question: '색상·사이즈 옵션은 어떻게 구성하나요?',
  },
];

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : '요청을 처리하지 못했습니다. 다시 시도해 주세요.';
}

export default function ProductAiChat() {
  const router = useRouter();
  const pathname = usePathname();
  const sessionId = useSearchParams().get('sessionId');
  return (
    <ProductAiChatContent
      sessionId={sessionId}
      onSessionChange={(id) =>
        router.replace(
          id ? `${pathname}?sessionId=${encodeURIComponent(id)}` : pathname
        )
      }
    />
  );
}

export function ProductAiChatContent({
  sessionId,
  onSessionChange,
  embedded = false,
  active = true,
  render,
}: {
  sessionId: string | null;
  onSessionChange: (id: string | null) => void;
  embedded?: boolean;
  active?: boolean;
  render?: (content: ReactNode) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = useChatImages(setError);
  const imageInput = useRef<HTMLInputElement>(null);
  const [draggingImages, setDraggingImages] = useState(false);
  const dragDepth = useRef(0);
  const [showHistory, setShowHistory] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [userStopped, setUserStopped] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const activeReply = useRef<{
    sessionId: string;
    messageId: string;
    abort: AbortController;
    stopped: boolean;
  } | null>(null);

  const pending = useRef<{
    sessionId: string | null;
    content: string;
    requestId: string;
    createRequestId: string;
    imageIds: string[];
  } | null>(null);
  const sending = useRef(false);
  const stopRequested = useRef(false);
  const sessions = useQuery({
    queryKey: ['product-ai', 'sessions', page],
    queryFn: () => productAiClient.list(page),
    enabled: active,
  });
  const conversation = useQuery({
    queryKey: ['product-ai', 'conversation', sessionId],
    enabled: active && Boolean(sessionId),
    queryFn: async () => {
      const [session, messages] = await Promise.all([
        productAiClient.get(sessionId!),
        productAiClient.messages(sessionId!),
      ]);
      return { session, messages };
    },
    refetchInterval: (query) =>
      active && query.state.data?.session.replyStatus === 'running'
        ? 2_000
        : false,
  });
  const session = conversation.data?.session;
  const status = session?.replyStatus;
  const messages = conversation.data?.messages ?? [];
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === 'user'
  );
  const scroll = useChatScroll(sessionId, messages[lastUserIndex]?.id);

  const awaitingReply = status === 'pending' || status === 'running';
  const attachmentBlocked =
    busy || stopping || awaitingReply || attachments.uploading;

  useEffect(() => {
    dragDepth.current = 0;
    setDraggingImages(false);
  }, [active, sessionId]);
  const showStopped =
    userStopped ||
    (!generating &&
      session?.replyError ===
        '답변 생성을 중지했습니다. 다시 생성하거나 새 메시지를 보내세요.');
  const canRetry =
    Boolean(session?.lastUserMessageId) &&
    (status === 'pending' ||
      status === 'failed' ||
      (status === 'running' &&
        (!session?.replyLeaseUntil ||
          new Date(session.replyLeaseUntil).getTime() <= Date.now())));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['product-ai'] });
  }

  function selectSession(id: string | null) {
    if (sending.current || stopping || attachments.uploading) return;
    setError(null);
    setText('');
    attachments.clear();
    pending.current = null;
    setShowHistory(false);
    setStreamText('');
    setInterrupted(false);
    setUserStopped(false);
    onSessionChange(id);
  }

  async function receiveReply(id: string, messageId: string) {
    const request = {
      sessionId: id,
      messageId,
      abort: new AbortController(),
      stopped: false,
    };
    activeReply.current = request;
    setGenerating(true);
    setStreamText('');
    setInterrupted(false);
    setUserStopped(false);
    let accumulated = '';
    let frame: number | null = null;
    try {
      await productAiClient.respondStream(
        id,
        messageId,
        (delta) => {
          accumulated += delta;
          if (frame === null)
            frame = requestAnimationFrame(() => {
              setStreamText(accumulated);
              frame = null;
            });
        },
        request.abort.signal
      );
      await refresh();
      setStreamText('');
    } catch (cause) {
      setStreamText(accumulated);
      setInterrupted(true);
      if (!request.stopped) throw cause;
    } finally {
      if (frame !== null) cancelAnimationFrame(frame);
      activeReply.current = null;
      setGenerating(false);
    }
  }

  async function stopReply() {
    const request = activeReply.current;
    if (request?.stopped) return;
    stopRequested.current = true;
    setUserStopped(true);
    setError(null);
    if (!request) return;
    request.stopped = true;
    setUserStopped(true);
    setError(null);
    request.abort.abort();
    setStopping(true);
    try {
      await productAiClient.cancel(request.sessionId, request.messageId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      request.abort.abort();
      setStopping(false);
      await refresh();
    }
  }

  useEffect(() => {
    if (!active || (!busy && !generating)) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void stopReply();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [active, busy, generating]);

  useEffect(() => () => activeReply.current?.abort.abort(), []);

  async function copyAnswer(message: ProductAiMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
    } catch {
      setError(
        '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.'
      );
    }
  }

  async function rateAnswer(message: ProductAiMessage, rating: 'up' | 'down') {
    if (!sessionId || feedbackBusy) return;
    setFeedbackBusy(message.id);
    try {
      await productAiClient.feedback(
        sessionId,
        message.id,
        message.feedback === rating ? null : rating
      );
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setFeedbackBusy(null);
    }
  }

  function renderMessage(message: ProductAiMessage) {
    return (
      <article
        key={message.id}
        className={`max-w-[92%] rounded-xl px-4 py-3 text-sm ${message.role === 'user' ? 'ml-auto rounded-br-sm bg-blue-50 text-slate-800' : 'mr-auto rounded-bl-sm bg-slate-50 text-slate-800'}`}
      >
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {message.role === 'user' ? '나' : '아몬드영 AI'}
        </p>
        <p className="whitespace-pre-wrap break-words leading-6">
          {message.content}
        </p>
        {!!message.attachments?.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((file) => (
              <a
                key={file.fileId}
                href={`/api/proxy/file/files/${file.fileId}/open`}
                target="_blank"
                rel="noopener noreferrer"
                title={file.fileName}
              >
                {/* Authenticated file-service redirect; never feed private images through a public image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/proxy/file/files/${file.fileId}/open`}
                  alt={file.fileName}
                  className="h-24 w-24 rounded-lg border object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}
        {message.role === 'assistant' && (
          <>
            {message.productDraft && sessionId && (
              <ProductAiDraftPreview
                draft={message.productDraft}
                sessionId={sessionId}
                messageId={message.id}
                savedProduct={session?.savedProduct ?? null}
                canSave={
                  !busy &&
                  !awaitingReply &&
                  session?.revision === message.sequence
                }
                onSaved={refresh}
              />
            )}
            {!!message.sources?.length && (
              <div className="mt-3 border-t pt-2">
                <p className="mb-1 text-[11px] text-slate-400">
                  참고한 운영 가이드 · 실시간 상품 조회 아님
                </p>
                {message.sources
                  .filter((source) =>
                    source.href.startsWith('/mall/product-ai/guide#')
                  )
                  .map((source) => (
                    <Link
                      key={source.id}
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-2 inline-block text-xs text-blue-600 underline underline-offset-2"
                    >
                      {source.title}
                    </Link>
                  ))}
              </div>
            )}
            <div className="mt-2 flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={copiedId === message.id ? '복사됨' : '답변 복사'}
                onClick={() => void copyAnswer(message)}
              >
                {copiedId === message.id ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={Boolean(feedbackBusy)}
                aria-label="도움이 됐어요"
                aria-pressed={message.feedback === 'up'}
                onClick={() => void rateAnswer(message, 'up')}
              >
                <ThumbsUp
                  size={14}
                  className={message.feedback === 'up' ? 'text-blue-600' : ''}
                />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={Boolean(feedbackBusy)}
                aria-label="도움이 안 됐어요"
                aria-pressed={message.feedback === 'down'}
                onClick={() => void rateAnswer(message, 'down')}
              >
                <ThumbsDown
                  size={14}
                  className={message.feedback === 'down' ? 'text-blue-600' : ''}
                />
              </Button>
            </div>
          </>
        )}
      </article>
    );
  }

  async function send(message = text) {
    const content =
      message.trim() ||
      (attachments.images.length
        ? '첨부한 이미지에서 상품 정보를 정리하고 필요한 정보를 질문해 주세요.'
        : '');
    const imageIds = attachments.images.flatMap((image) =>
      image.fileId ? [image.fileId] : []
    );
    if (
      !content ||
      attachments.uploading ||
      attachments.hasUnreadyImages ||
      stopping ||
      sending.current ||
      awaitingReply ||
      (sessionId && !session)
    )
      return;
    stopRequested.current = false;
    sending.current = true;
    setBusy(true);
    setError(null);
    setUserStopped(false);
    if (
      !pending.current ||
      pending.current.content !== content ||
      pending.current.sessionId !== sessionId ||
      JSON.stringify(pending.current.imageIds) !== JSON.stringify(imageIds)
    ) {
      pending.current = {
        sessionId,
        content,
        requestId: crypto.randomUUID(),
        createRequestId: crypto.randomUUID(),
        imageIds,
      };
    }
    const request = pending.current;
    try {
      const target =
        session ??
        (await productAiClient.create(
          request.createRequestId,
          content.slice(0, 200)
        ));
      const sent = await productAiClient.send(target.id, {
        requestId: request.requestId,
        expectedRevision: target.revision,
        content,
        imageIds: request.imageIds,
      });
      setText('');
      attachments.clear();
      pending.current = null;
      onSessionChange(target.id);
      await refresh();
      if (stopRequested.current) {
        await productAiClient.cancel(target.id, sent.message.id);
        return;
      }
      await receiveReply(target.id, sent.message.id);
    } catch (cause) {
      if (!stopRequested.current) setError(errorMessage(cause));
    } finally {
      try {
        await refresh();
      } finally {
        sending.current = false;
        setBusy(false);
      }
    }
  }

  async function retryReply() {
    if (!session?.lastUserMessageId || sending.current || stopping) return;
    stopRequested.current = false;
    sending.current = true;
    setBusy(true);
    setError(null);
    setUserStopped(false);
    try {
      await receiveReply(session.id, session.lastUserMessageId);
    } catch (cause) {
      if (!stopRequested.current) setError(errorMessage(cause));
    } finally {
      try {
        await refresh();
      } finally {
        sending.current = false;
        setBusy(false);
      }
    }
  }

  async function renameSession(id: string) {
    if (renaming || !editTitle.trim()) return;
    setRenaming(true);
    try {
      await productAiClient.rename(id, editTitle.trim());
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['product-ai'] });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRenaming(false);
    }
  }

  async function deleteSession(id: string) {
    if (deleting || busy) return;
    setDeleting(id);
    try {
      await productAiClient.remove(id);
      if (sessionId === id) selectSession(null);
      queryClient.removeQueries({
        queryKey: ['product-ai', 'conversation', id],
      });
      await queryClient.invalidateQueries({
        queryKey: ['product-ai', 'sessions'],
      });
      if (sessions.data?.items.length === 1 && page > 1) setPage(page - 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDeleting(null);
    }
  }

  const content = (
    <div
      className={
        embedded
          ? 'flex min-h-0 flex-1 flex-col'
          : 'mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6'
      }
    >
      {!embedded && (
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">아몬드영 AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            운영 중 궁금한 점, 아몬드영 AI와 함께 정리해 보세요.
          </p>
        </header>
      )}
      {embedded && (
        <div className="flex gap-2 border-b px-3 py-2 sm:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
          >
            <History size={16} /> 대화 목록
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => selectSession(null)}
          >
            <MessageSquarePlus size={16} /> 새 대화
          </Button>
        </div>
      )}
      <div
        className={
          embedded
            ? 'grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[200px_1fr]'
            : 'grid min-h-[65vh] gap-4 md:grid-cols-[230px_1fr]'
        }
      >
        <aside
          className={
            embedded
              ? `${showHistory ? 'block' : 'hidden'} min-h-0 overflow-y-auto border-r border-indigo-100/70 bg-[#f4f5fc] p-3 sm:block`
              : 'rounded-xl border bg-muted/20 p-3'
          }
          aria-label="저장된 대화"
        >
          <Button
            variant="outline"
            className="h-10 w-full justify-center gap-2 rounded-full border-0 bg-gradient-to-r from-[#2855ff] to-[#a343ff] px-4 text-base font-semibold text-white shadow-md shadow-indigo-200/60 transition-opacity hover:text-white hover:opacity-90"
            aria-label="새 대화"
            disabled={busy}
            onClick={() => selectSession(null)}
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>
              New <span className="italic">Chat</span>
            </span>
          </Button>
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            최근 대화
          </p>
          {sessions.isPending ? <p className="text-sm">불러오는 중…</p> : null}
          {sessions.error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(sessions.error)}
            </p>
          ) : null}
          {sessions.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 저장된 대화가 없습니다.
            </p>
          ) : null}
          <div className="space-y-1">
            {sessions.data?.items.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-1 rounded-lg hover:bg-white/80"
              >
                {editingId === item.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameSession(item.id);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="대화 제목"
                      maxLength={200}
                      value={editTitle}
                      disabled={renaming}
                      onChange={(event) => setEditTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      aria-label="제목 저장"
                      disabled={renaming || !editTitle.trim()}
                      className="p-1"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="제목 수정 취소"
                      disabled={renaming}
                      onClick={() => setEditingId(null)}
                      className="p-1"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      aria-current={sessionId === item.id ? 'page' : undefined}
                      onClick={() => selectSession(item.id)}
                      className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${sessionId === item.id ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/80'}`}
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquare
                          size={14}
                          className="shrink-0 text-slate-400"
                        />
                        <span className="truncate">{item.title}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(deleting)}
                      aria-label={`${item.title} 제목 수정`}
                      title="제목 수정"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditTitle(item.title);
                      }}
                      className="shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-700"
                    >
                      <Pencil size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy || Boolean(deleting)}
                  onClick={() => void deleteSession(item.id)}
                  aria-label={`${item.title} 대화 삭제`}
                  title="대화 삭제"
                  className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-blue-200 disabled:opacity-40"
                >
                  {deleting === item.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))}
          </div>
          <div
            className={`${page > 1 || sessions.data?.hasMore ? 'flex' : 'hidden'} mt-4 items-center justify-between gap-2`}
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 1 || busy}
              onClick={() => setPage(page - 1)}
            >
              이전
            </Button>
            <span className="text-xs text-muted-foreground">{page}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!sessions.data?.hasMore || busy}
              onClick={() => setPage(page + 1)}
            >
              다음
            </Button>
          </div>
        </aside>
        <section
          className={
            embedded
              ? `${showHistory ? 'hidden sm:flex' : 'flex'} relative min-h-0 min-w-0 flex-col bg-[#fcfcff]`
              : 'relative flex min-w-0 flex-col rounded-xl border bg-background'
          }
          aria-label="AI 대화"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'none';
          }}
          onDrop={(event) => {
            if (event.dataTransfer.types.includes('Files'))
              event.preventDefault();
          }}
        >
          {sessionId && (
            <div className="truncate border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-600">
              {session?.title ?? '대화 불러오는 중'}
            </div>
          )}
          <div
            className={
              embedded
                ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'
                : 'flex max-h-[60vh] min-h-64 flex-1 flex-col gap-4 overflow-y-auto p-5'
            }
            aria-label="메시지 목록"
            ref={scroll.viewportRef}
            onScroll={scroll.onScroll}
            onWheel={scroll.onUserScrollIntent}
            onTouchMove={scroll.onUserScrollIntent}
            onKeyDown={(event) => {
              if (
                [
                  'ArrowUp',
                  'ArrowDown',
                  'PageUp',
                  'PageDown',
                  'Home',
                  'End',
                  ' ',
                ].includes(event.key)
              )
                scroll.onUserScrollIntent();
            }}
            tabIndex={0}
            style={{ overflowAnchor: 'none' }}
          >
            {!sessionId ? (
              <div className={styles.welcome}>
                <div className={styles.welcomeHeading}>
                  <span className={styles.eyebrow}>AI ASSISTANT</span>
                  <h2>
                    안녕하세요,
                    <br />
                    무엇을 도와드릴까요?
                  </h2>
                </div>
                <div className={styles.questionCloud} aria-label="추천 질문">
                  {[
                    starterQuestions.slice(0, 3),
                    starterQuestions.slice(3, 6),
                    starterQuestions.slice(6),
                  ].map((questions, row) => (
                    <div className={styles.questionRow} key={row}>
                      <div className={styles.questionTrack}>
                        {[false, true].map((duplicate) => (
                          <div
                            className={styles.questionGroup}
                            key={String(duplicate)}
                            aria-hidden={duplicate || undefined}
                          >
                            {questions.map(
                              ({ topic, icon, label, question }) => (
                                <button
                                  key={topic}
                                  type="button"
                                  tabIndex={duplicate ? -1 : undefined}
                                  disabled={busy || stopping || awaitingReply}
                                  className={styles.suggestion}
                                  onClick={() => {
                                    setText(question);
                                    void send(question);
                                  }}
                                >
                                  <span aria-hidden="true">{icon}</span>
                                  {label}
                                </button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className={styles.scopeNote}>
                  궁금한 점을 편하게 물어보세요.
                  <br />
                  아몬드영 AI와 함께 하나씩 풀어가요.
                </p>
              </div>
            ) : null}
            {sessionId && conversation.isPending ? (
              <p>대화를 불러오는 중…</p>
            ) : null}
            {conversation.error ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(conversation.error)}
              </p>
            ) : null}
            {messages.slice(0, Math.max(0, lastUserIndex)).map(renderMessage)}
            {lastUserIndex >= 0 && (
              <div
                ref={scroll.turnRef}
                style={{ minHeight: scroll.turnMinHeight }}
                className="flex shrink-0 flex-col gap-4"
              >
                {messages.slice(lastUserIndex).map(renderMessage)}
                {streamText && messages.at(-1)?.role !== 'assistant' && (
                  <article className="mr-auto max-w-[92%] rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    <p className="mb-1 text-xs text-slate-400">
                      {interrupted
                        ? '중단된 답변 · 저장되지 않음'
                        : '아몬드영 AI · 작성 중'}
                    </p>
                    <p className="whitespace-pre-wrap break-words leading-6">
                      {streamText}
                    </p>
                  </article>
                )}
                {!userStopped &&
                !interrupted &&
                !error &&
                !session?.replyError &&
                (generating || status === 'running') ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Loader2 className="animate-spin" size={15} />
                    답변을 준비하고 있습니다…
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <div className="shrink-0 px-3 pb-3 pt-2">
            {scroll.showLatest && (
              <div className="mb-2 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={scroll.toLatest}
                >
                  <ArrowDown size={14} /> 최신 답변
                </Button>
              </div>
            )}
            {(busy || generating) && !userStopped && (
              <div className="mb-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void stopReply()}
                  disabled={stopping}
                >
                  <Square size={12} />{' '}
                  {stopping ? '중지 중…' : '생성 중지 · Esc'}
                </Button>
              </div>
            )}

            {showStopped && !error ? (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                답변 생성을 중지했어요. 다시 생성하거나 새 메시지를 보내세요.
              </p>
            ) : null}
            {error || (!generating && !showStopped && session?.replyError) ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error ?? session?.replyError}
              </p>
            ) : null}
            {canRetry && !generating ? (
              <Button
                className="mb-3"
                variant="outline"
                disabled={busy}
                onClick={retryReply}
              >
                AI 답변 다시 받기
              </Button>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              className={`relative ${styles.composer}`}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                dragDepth.current += 1;
                setDraggingImages(true);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = attachmentBlocked
                  ? 'none'
                  : 'copy';
              }}
              onDragLeave={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.stopPropagation();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDraggingImages(false);
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                dragDepth.current = 0;
                setDraggingImages(false);
                if (attachmentBlocked) return;
                setError(null);
                void attachments.add(Array.from(event.dataTransfer.files));
              }}
            >
              {draggingImages && (
                <div
                  role="status"
                  className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/95 p-3 text-center text-indigo-700"
                >
                  <Paperclip size={32} aria-hidden="true" />
                  <p className="font-semibold">
                    {attachmentBlocked
                      ? '진행 중인 작업이 끝나면 이미지를 첨부해 주세요'
                      : '이미지를 여기에 놓아주세요'}
                  </p>
                  <p className="text-xs text-indigo-500">
                    JPG·PNG·WebP · 장당 5MB · 최대 4장
                  </p>
                </div>
              )}
              {!!attachments.images.length && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {attachments.images.map((file) => (
                    <div key={file.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={file.preview}
                        alt={file.fileName}
                        className="h-20 w-20 rounded-lg border object-cover"
                      />
                      {file.status !== 'ready' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-slate-950/50 text-white backdrop-blur-[1px]">
                          {file.status === 'error' ? (
                            <button
                              type="button"
                              disabled={attachmentBlocked}
                              title={file.error}
                              aria-label={`${file.fileName} 업로드 재시도`}
                              className="rounded-md px-1 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
                              onClick={() => {
                                setError(null);
                                void attachments.retry(file.id);
                              }}
                            >
                              업로드 실패
                              <br />
                              다시 시도
                            </button>
                          ) : file.status === 'queued' ? (
                            <span className="text-xs">대기 중</span>
                          ) : file.progress === null ||
                            file.progress === 100 ? (
                            <>
                              <Loader2
                                size={28}
                                className="animate-spin"
                                aria-hidden="true"
                              />
                              <span role="status" className="text-[10px]">
                                {file.progress === 100
                                  ? '저장 중'
                                  : '업로드 중'}
                              </span>
                            </>
                          ) : (
                            <div
                              role="progressbar"
                              aria-label={`${file.fileName} 업로드`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={file.progress}
                              className="relative h-11 w-11"
                            >
                              <svg
                                viewBox="0 0 44 44"
                                className="h-full w-full -rotate-90"
                                aria-hidden="true"
                              >
                                <circle
                                  cx="22"
                                  cy="22"
                                  r="19"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  opacity="0.25"
                                />
                                <circle
                                  cx="22"
                                  cy="22"
                                  r="19"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  pathLength="100"
                                  strokeDasharray="100"
                                  strokeDashoffset={100 - file.progress}
                                  className="transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
                                />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums">
                                {file.progress}%
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={busy || attachments.uploading}
                        onClick={() => attachments.remove(file.id)}
                        aria-label={`${file.fileName} 첨부 제거`}
                        className="absolute -right-1 -top-1 rounded-full border bg-white p-1 text-slate-500 shadow-sm"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                aria-label="AI에게 메시지"
                value={text}
                maxLength={20_000}
                disabled={busy || stopping || awaitingReply}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files).filter(
                    (file) => file.type.startsWith('image/')
                  );
                  if (files.length) {
                    event.preventDefault();
                    if (!attachmentBlocked) void attachments.add(files);
                  }
                }}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  )
                    return;
                  event.preventDefault();
                  if (!event.repeat) event.currentTarget.form?.requestSubmit();
                }}
                placeholder="아몬드영 AI에게 편하게 물어보세요…"
                className="min-h-28 max-h-44 resize-none border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  aria-label="첨부 이미지 선택"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    void attachments.add(files);
                  }}
                />
                <button
                  type="button"
                  disabled={attachmentBlocked || attachments.images.length >= 4}
                  onClick={() => imageInput.current?.click()}
                  aria-label="이미지 첨부"
                  title="JPG·PNG·WebP, 장당 5MB, 최대 4장"
                  className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                >
                  {attachments.uploading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Paperclip size={16} />
                  )}
                  {attachments.uploading ? '업로드 중…' : '이미지'}
                </button>
                <span className="text-[11px] text-slate-400">
                  {text.length.toLocaleString()} / 20,000
                </span>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    awaitingReply ||
                    attachments.uploading ||
                    attachments.hasUnreadyImages ||
                    (!text.trim() && !attachments.images.length) ||
                    Boolean(sessionId && !session)
                  }
                  aria-label="메시지 보내기"
                  className="h-8 shrink-0 gap-1.5 rounded-full bg-indigo-100 px-3 text-blue-600 shadow-none hover:bg-indigo-200 disabled:opacity-40"
                >
                  <Send size={14} /> 보내기
                </Button>
              </div>
            </form>
            <p className="mt-2.5 text-center text-[11px] text-slate-400">
              대화는 자동 저장됩니다 · 상품 초안은 미리보기에서 저장할 수 있어요
            </p>
          </div>
        </section>
      </div>
    </div>
  );
  return render ? render(content) : content;
}
