'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { productAiClient } from '@/lib/api/domains/products/product-ai.client';
import styles from './product-ai-chat.module.css';

const starterQuestions = [
  '상품등록에 필요한 정보를 하나씩 물어봐 주세요',
  '대표카테고리가 뭐예요?',
  '맞는 카테고리가 없으면 어떻게 하나요?',
  '판매가·멤버십가·공급가는 어떻게 다른가요?',
  '색상·사이즈 옵션은 어떻게 구성하나요?',
  '기존 재고와 매칭하려면 무엇이 필요한가요?',
  '매칭할 재고가 없으면 새로 만들어야 하나요?',
  '대표·부가·상세페이지 이미지는 어떻게 준비하나요?',
  'SEO 제목·태그·키워드는 어떻게 작성하나요?',
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
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    sessionId: string | null;
    content: string;
    requestId: string;
    createRequestId: string;
  } | null>(null);
  const sending = useRef(false);
  const sessions = useQuery({
    queryKey: ['product-ai', 'sessions', page],
    queryFn: () => productAiClient.list(page),
  });
  const conversation = useQuery({
    queryKey: ['product-ai', 'conversation', sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const [session, messages] = await Promise.all([
        productAiClient.get(sessionId!),
        productAiClient.messages(sessionId!),
      ]);
      return { session, messages };
    },
    refetchInterval: (query) =>
      query.state.data?.session.replyStatus === 'running' ? 2_000 : false,
  });
  const session = conversation.data?.session;
  const status = session?.replyStatus;
  const awaitingReply = status === 'pending' || status === 'running';
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
    if (sending.current) return;
    setError(null);
    setText('');
    pending.current = null;
    router.replace(
      id ? `${pathname}?sessionId=${encodeURIComponent(id)}` : pathname
    );
  }

  async function send(message = text) {
    const content = message.trim();
    if (!content || sending.current || awaitingReply || (sessionId && !session))
      return;
    sending.current = true;
    setBusy(true);
    setError(null);
    if (
      !pending.current ||
      pending.current.content !== content ||
      pending.current.sessionId !== sessionId
    ) {
      pending.current = {
        sessionId,
        content,
        requestId: crypto.randomUUID(),
        createRequestId: crypto.randomUUID(),
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
      });
      setText('');
      pending.current = null;
      router.replace(`${pathname}?sessionId=${target.id}`);
      await refresh();
      await productAiClient.respond(target.id, sent.message.id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  async function retryReply() {
    if (!session?.lastUserMessageId || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await productAiClient.respond(session.id, session.lastUserMessageId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          상품등록 도우미
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상품 정보를 함께 정리하고 궁금한 용어를 물어보세요. 실제 상품
          저장·파일 첨부는 아직 지원하지 않습니다.
        </p>
      </header>
      <div className="grid min-h-[65vh] gap-4 md:grid-cols-[230px_1fr]">
        <aside
          className="rounded-xl border bg-muted/20 p-3"
          aria-label="저장된 대화"
        >
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            disabled={busy}
            onClick={() => selectSession(null)}
          >
            <MessageSquarePlus size={16} />새 대화
          </Button>
          <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
            내 상품등록 대화
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
              <button
                key={item.id}
                type="button"
                disabled={busy}
                aria-current={sessionId === item.id ? 'page' : undefined}
                onClick={() => selectSession(item.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${sessionId === item.id ? 'bg-primary/10 font-medium' : 'hover:bg-muted'}`}
              >
                <span className="block truncate">{item.title}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
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
          className="flex min-w-0 flex-col rounded-xl border bg-background"
          aria-label="상품등록 대화"
        >
          <div className="border-b px-5 py-3 font-medium">
            {session?.title ?? '새 상품등록 대화'}
          </div>
          <div
            className="flex max-h-[60vh] min-h-64 flex-1 flex-col gap-4 overflow-y-auto p-5"
            aria-label="메시지 목록"
          >
            {!sessionId ? (
              <div className="my-auto space-y-3 text-sm text-muted-foreground">
                <div
                  aria-hidden="true"
                  className="pointer-events-none relative isolate mx-auto mb-6 flex h-40 w-40 shrink-0 items-center justify-center sm:h-48 sm:w-48"
                >
                  <div className={styles.brandGlow} />
                  <div className="absolute inset-6 rounded-full bg-background/80 blur-md" />
                  <Image
                    src="/images/almondyoung-symbol.webp"
                    alt=""
                    width={128}
                    height={128}
                    className="relative h-28 w-28 opacity-35 sm:h-32 sm:w-32"
                  />
                </div>
                <p className="text-base font-medium text-foreground">
                  어떤 상품을 등록할까요?
                </p>
                <p>
                  상품명, 옵션, 가격 등 알고 계신 내용을 편하게 적어주세요.
                  대화는 자동으로 저장됩니다.
                </p>
                <p className="text-xs">
                  아래 질문을 누르면 바로 전송되고 도우미가 답해드려요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {starterQuestions.map((question) => (
                    <Button
                      key={question}
                      type="button"
                      variant="outline"
                      disabled={busy || awaitingReply}
                      className="h-auto max-w-full whitespace-normal py-2 text-left"
                      onClick={() => {
                        setText(question);
                        void send(question);
                      }}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
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
            {conversation.data?.messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[92%] rounded-xl px-4 py-3 text-sm ${message.role === 'user' ? 'ml-auto bg-primary/10' : 'mr-auto bg-muted/50'}`}
              >
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {message.role === 'user' ? '나' : '상품등록 도우미'}
                </p>
                <p className="whitespace-pre-wrap break-words leading-6">
                  {message.content}
                </p>
              </article>
            ))}
            {busy || status === 'running' ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="animate-spin" size={15} />
                답변을 준비하고 있습니다…
              </p>
            ) : null}
          </div>
          <div className="border-t p-4">
            {error || session?.replyError ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error ?? session?.replyError}
              </p>
            ) : null}
            {canRetry ? (
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
              className="flex items-end gap-2"
            >
              <Textarea
                aria-label="상품등록 요청"
                value={text}
                maxLength={20_000}
                disabled={busy || awaitingReply}
                onChange={(event) => setText(event.target.value)}
                placeholder="상품명, 옵션, 가격 또는 궁금한 점을 입력하세요"
                className="min-h-24 resize-y"
              />
              <Button
                type="submit"
                disabled={
                  busy ||
                  awaitingReply ||
                  !text.trim() ||
                  Boolean(sessionId && !session)
                }
                aria-label="메시지 보내기"
              >
                <Send size={16} />
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
