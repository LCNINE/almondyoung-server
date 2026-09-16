'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ArrowUp,
  ClipboardCheck,
  RotateCcw,
  FileSpreadsheet,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolResults, TOOL_LABELS } from './tool-result';
import { createSession, loadMessages, titleFrom } from '../lib/chat-history';
import { SessionSidebar } from './session-sidebar';
import { IconRail } from './icon-rail';
import { matchHints } from '../lib/prompt-hints';
import styles from './assistant-panel.module.css';

/** 같은 이름의 첨부를 구분하려면 파일명이 아니라 키로 식별해야 한다. */
type Attachment = { id: string; file: File };

/**
 * 새로고침해도 대화를 잇는다. 첨부 파일(File)은 직렬화할 수 없으므로 텍스트와
 * 도구 결과만 남긴다 — 이미지가 필요한 작업은 다시 첨부해야 한다.
 */
const STORAGE_KEY = 'almondyoung.assistant.session';

type DraftSession = {
  messages: {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: unknown[];
  }[];
  /** 서버가 들고 있는 대화의 id. 이것만 있으면 이어서 말할 수 있다. */
  sessionId: string | null;
};

function loadSession(): DraftSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DraftSession) : null;
  } catch {
    // 프라이빗 모드나 저장소 차단. 대화가 안 이어질 뿐 기능은 그대로 돈다.
    return null;
  }
}

function saveSession(session: DraftSession) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 용량 초과 등. 저장 실패가 대화를 막으면 안 된다.
  }
}

type Message = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; input?: unknown; result?: unknown }[];
  attachments?: Attachment[];
  /** 지금 도는 도구 이름. 스트리밍 중에만 채워진다. */
  runningTool?: string;
};

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

function ImageAttachment({ file }: { file: File }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Local blob previews do not need Next.js image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={file.name} /> : null;
}

/** 어시스턴트 이름. 헤더·말풍선 작성자 라벨·인사문이 전부 여기서 나온다. */
const ASSISTANT_NAME = '아몬이';

/** 어시스턴트 캐릭터 3컷. public/assistant 에 있다. */
const CHARACTER = {
  idle: '/assistant/character.png',
  wave: '/assistant/character-wave.png',
  thinking: '/assistant/character-thinking.png',
};

function AssistantFace({
  mood = 'idle',
  size = 'sm',
}: {
  mood?: keyof typeof CHARACTER;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'lg'
      ? styles.bigFace
      : size === 'md'
        ? styles.midFace
        : styles.face;
  return (
    <span className={box}>
      {/* 고정 크기 장식이라 최적화가 필요 없다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CHARACTER[mood]} alt="" />
    </span>
  );
}

/** 시작 화면의 알약 버튼. 누르면 그 말을 바로 보낸다. */
const SUGGESTIONS = [
  { icon: Search, label: '상품 찾기', prompt: '상품 목록을 5개 보여줘.' },
  {
    icon: Sparkles,
    label: '상품 등록',
    prompt: '새 상품을 등록하려고 해. 뭐부터 알려주면 될까?',
  },
  {
    icon: FileSpreadsheet,
    label: '엑셀 일괄 등록',
    prompt:
      '엑셀로 상품을 일괄 등록하려고 해. 필요한 양식과 진행 방법을 알려줘.',
  },
  {
    icon: ClipboardCheck,
    label: '진행 상태',
    prompt: '최근 일괄 등록 작업의 진행 상태를 확인해줘.',
  },
];

export function AssistantPanel({ open, onOpenChange }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = loadSession();
    // 첨부(File)는 복원할 수 없으므로 텍스트와 도구 결과만 되살린다.
    return (saved?.messages ?? []) as Message[];
  });
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  /**
   * 대화 원본(도구 호출·결과 포함)은 ai 앱이 들고 있다. 화면은 sessionId 와
   * 보여줄 말풍선만 들면 된다 — 브라우저가 들고 있던 사본을 매번 되돌려주던
   * 방식은 DB 와 갈릴 수 있었고, tool_result 를 고쳐 보내면 모델이 그대로 믿었다.
   *
   * 세션 id. 첫 발화 전에 만들고 그 뒤로 붙여 나간다.
   */
  const sessionIdRef = useRef<string | null>(
    typeof window === 'undefined' ? null : (loadSession()?.sessionId ?? null)
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => sessionIdRef.current
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 목록을 다시 읽게 하는 값. 새 대화가 생기면 올린다. */
  const [sessionRevision, setSessionRevision] = useState(0);
  /** 추천어에서 키보드로 짚은 위치. -1 이면 아무것도 안 짚은 상태. */
  const [hintIndex, setHintIndex] = useState(-1);
  const [hintsHiddenFor, setHintsHiddenFor] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /** 지난 대화를 여는 중인가. 늦게 끝난 조회가 진행 중 대화를 덮어쓰면 안 된다. */
  const loadToken = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 맨 아래를 보고 있는가. 위로 올려 읽는 중이면 자동 스크롤을 멈춘다. */
  const stickToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    dragDepth.current = 0;
    setDragging(false);
  }, [open, pending]);

  // 글자가 바뀌면 짚어 둔 위치는 버린다.
  useEffect(() => {
    setHintIndex(-1);
  }, [input]);

  /**
   * Esc 로 닫았거나 방금 골라 넣은 글이면 띄우지 않는다. 열림 여부를 boolean 으로
   * 들면 «닫자마자 input 이 바뀌어 다시 열리는» 순서 문제가 생긴다.
   */
  const hints =
    !pending && files.length === 0 && input !== hintsHiddenFor
      ? matchHints(input)
      : [];

  function applyHint(hint: string) {
    setInput(hint);
    setHintsHiddenFor(hint);
    inputRef.current?.focus();
  }

  function resetConversation() {
    setMessages([]);
    setFiles([]);
    setInput('');
    setError(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    loadToken.current += 1;
    setLoadingHistory(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장소를 못 써도 화면 상태는 이미 비웠다.
    }
  }

  /**
   * 지난 대화를 이어서 연다. contentBlocks 에 도구 호출·결과가 그대로 있어서,
   * 불러온 뒤에도 이전 턴에 올린 이미지의 fileId 같은 것을 그대로 쓸 수 있다.
   */
  async function openSession(sessionId: string) {
    if (pending || loadingHistory) return;

    const token = ++loadToken.current;
    setLoadingHistory(true);
    const rows = await loadMessages(sessionId);

    // 그 사이 다른 대화를 열었거나 새로 시작했으면 이 결과는 버린다.
    if (token !== loadToken.current) return;
    setLoadingHistory(false);

    if (!rows) {
      setError('대화를 불러오지 못했습니다.');
      return;
    }

    setMessages(
      rows.map((row) => ({
        role: row.role,
        content: row.content ?? '',
        toolCalls: row.toolCalls ?? undefined,
      }))
    );

    sessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
    setFiles([]);
    setInput('');
    setError(null);
    // 좁은 화면에서는 목록이 대화를 덮고 있다. 골랐으면 비켜 준다.
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }

  function dropAttachment(id: string) {
    setFiles((previous) => previous.filter((a) => a.id !== id));
  }

  function attachFiles(selected: File[]) {
    const accepted = selected.filter(
      (file) => file.type.startsWith('image/') || /\.xlsx$/i.test(file.name)
    );
    setFiles((previous) => [
      ...previous,
      ...accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
      })),
    ]);
    setError(
      accepted.length < selected.length
        ? '이미지 또는 엑셀(.xlsx) 파일을 첨부해 주세요.'
        : null
    );
  }

  function persist(shown: Message[], sessionId: string | null) {
    saveSession({
      messages: shown.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
      })),
      sessionId,
    });
  }

  useEffect(() => {
    if (messages.length === 0) return;
    persist(messages, sessionIdRef.current);
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !abortRef.current) return;
      // 처리 중일 때의 Esc 는 패널을 닫지 않고 요청만 멈춘다.
      event.preventDefault();
      event.stopPropagation();
      abortRef.current.abort();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useEffect(() => {
    const box = scrollRef.current;
    // 사용자가 위쪽 대화를 읽는 중이면 끌어내리지 않는다. 카드가 길어서 새 답변이
    // 올 때마다 화면이 튀면 앞 내용을 다시 찾아 올라가야 한다.
    if (!box || !stickToBottom.current) return;
    box.scrollTo({
      top: box.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [messages, pending]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;

    // 입력창이 커진 만큼 대화 영역이 줄어든다. 따라 내리지 않으면 방금 온 답변이
    // 입력창 뒤로 밀려 가려지고, 사용자가 손으로 스크롤해야 보인다.
    const box = scrollRef.current;
    if (box && stickToBottom.current) {
      box.scrollTop = box.scrollHeight;
    }
  }, [input, open]);

  /**
   * 선택지를 누르면 그 값을 그대로 다음 발화로 보낸다.
   * 입력창에 넣고 사용자가 다시 엔터를 치게 하면 두 번 일하는 꼴이다.
   */
  function chooseOption(value: string) {
    if (pending || loadingHistory) return;
    void send(value);
  }

  async function send(spoken?: string) {
    const text = (spoken ?? input).trim();
    if ((!text && files.length === 0) || pending || loadingHistory) return;

    const shownBefore = messages.length;
    const outgoing: Message = {
      role: 'user',
      content: text,
      attachments: files,
    };

    setMessages((previous) => [...previous, outgoing]);
    // 선택지로 보낸 것이면 입력창은 그대로 둔다 — 사용자가 쓰다 만 글이 있을 수 있다.
    if (spoken === undefined) setInput('');
    // 첨부는 여기서 비우지 않는다 — 어시스턴트가 "카테고리 뭘로 할까요" 처럼 되물으면
    // 그 턴에 파일이 사라져서, 사용자가 답할 때 이미지를 다시 첨부해야 한다.
    // 업로드 도구가 실제로 썼다고 알려줄 때(consumedAttachments)만 비운다.
    setError(null);
    setPending(true);

    /**
     * 대화는 서버가 들고 있으므로 세션이 먼저 있어야 말을 보낼 수 있다.
     * 기록이 부가 기능이던 때와 달리, 생성이 실패하면 이 턴은 진행할 수 없다.
     */
    let sessionId = sessionIdRef.current;
    if (!sessionId) {
      const created = await createSession(titleFrom(text || '첨부 파일'));
      if (!created?.id) {
        setMessages((previous) => previous.slice(0, shownBefore));
        setInput(text);
        setPending(false);
        setError('대화를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      sessionId = created.id;
      sessionIdRef.current = sessionId;
      setCurrentSessionId(sessionId);
      // 목록에 방금 만든 대화가 보여야 한다.
      setSessionRevision((n) => n + 1);
    }

    const body = new FormData();
    body.append('content', text);
    for (const { id, file } of files) {
      body.append('files', file);
      body.append('fileIds', id);
    }

    // 이번 전송에 실은 것만 비운다. 세션 생성을 기다리는 동안 사용자가 파일을 더 붙일 수
    // 있는데, 전부 비우면 보내지도 않은 그 파일이 조용히 사라진다.
    const sentIds = new Set(files.map((attachment) => attachment.id));
    setFiles((previous) =>
      previous.filter((attachment) => !sentIds.has(attachment.id))
    );

    /**
     * 서버가 이 발화를 받기 전에 거절했을 때만 쓴다 (4xx). 그 경우 서버는 세션 확인·
     * 동시 턴 검사에서 막은 것이라 발화를 저장하지 않았다.
     * 스트림이 시작된 뒤나 5xx 에는 저장됐을 수 있으므로 되돌리면 같은 말이 두 번 남는다.
     */
    function restoreDraft(message: string) {
      setMessages((previous) => previous.slice(0, shownBefore));
      if (spoken === undefined) setInput(text);
      setFiles(files);
      setError(message);
    }

    // 답변을 받는 즉시 화면에 흘린다. 도구를 여러 번 도는 작업은 20초가 넘어서
    // 아무것도 안 보이면 고장으로 읽힌다.
    //
    // 다만 말풍선은 «보여줄 것이 생겼을 때» 만든다. 미리 넣어두면 첫 글자가
    // 오기 전까지 빈 말풍선이 떠 있고, 아래 "처리하고 있어요" 와 겹쳐 보인다.
    let bubbleAdded = false;
    const ensureBubble = () => {
      if (bubbleAdded) return;
      bubbleAdded = true;
      setMessages((previous) => [
        ...previous,
        { role: 'assistant', content: '' },
      ]);
    };

    const updateLast = (patch: Partial<Message>) => {
      ensureBubble();
      setMessages((previous) => {
        const next = [...previous];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });
    };

    let streamedText = '';
    let toolStarted = false;

    /**
     * 연결이 중간에 끊겼을 때. 저장은 손대지 않는다 — 서버가 자기 쪽에서 끝까지
     * 돌고 이 턴을 저장한다. 여기서 또 쓰면 같은 턴이 두 벌로 남는다.
     */
    function finishInterrupted(message: string) {
      setError(message);
      if (bubbleAdded) updateLast({ runningTool: undefined });
    }

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetchWithRefresh(
        `/api/proxy/ai/assistant/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          body,
          signal: controller.signal,
          credentials: 'include',
        }
      );
      if (!res.ok || !res.body) {
        const fallback = await res
          .json()
          .then((b: { message?: string }) => b.message)
          .catch(() => undefined);
        const message = fallback ?? '요청을 완료하지 못했습니다.';

        if (res.status >= 400 && res.status < 500) {
          restoreDraft(message);
        } else {
          // 5xx 는 발화를 저장한 뒤 터졌을 수 있다. 말풍선을 남기고 알리기만 한다.
          setError(message);
        }
        return;
      }

      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream({ maxBufferSize: 1_000_000 }))
        .getReader();
      let settled = false;
      let data: {
        message?: string;
        toolCalls?: { name: string; input?: unknown; result?: unknown }[];
        consumedIds?: string[];
      } = {};

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (!value.event) continue;

        const parsed = JSON.parse(value.data);
        if (value.event === 'delta') {
          streamedText += parsed.text as string;
          updateLast({ content: streamedText });
        } else if (value.event === 'tool') {
          toolStarted = true;
          updateLast({
            runningTool: parsed.status === 'running' ? parsed.name : undefined,
          });
        } else if (value.event === 'session_title') {
          // 서버가 첫 발화에서 제목을 딴다. 화면에 제목을 쓰는 곳은 없고 목록은
          // 열 때 다시 조회하므로 흘려보낸다 — 다만 done 으로 오인되면 안 된다.
        } else {
          // done · aborted · error 는 모두 마지막 상태를 싣고 온다.
          settled = true;
          data = parsed;
          if (value.event === 'error')
            setError(parsed.message ?? '요청을 처리하지 못했습니다.');
        }
      }

      if (!settled) {
        finishInterrupted(
          '응답이 중간에 끊겼습니다. 일부 작업이 이미 반영됐을 수 있으니 확인한 뒤 다시 요청해 주세요.'
        );
        return;
      }

      updateLast({
        content: data.message ?? streamedText,
        toolCalls: data.toolCalls,
        runningTool: undefined,
      });

      const consumed = data.consumedIds ?? [];
      const unused = files.filter((a) => !consumed.includes(a.id));
      setFiles((previous) => [...unused, ...previous]);
    } catch (error) {
      if (toolStarted) {
        finishInterrupted(
          (error as Error)?.name === 'AbortError'
            ? '중단했습니다. 멈추기 전에 실행된 작업은 이미 반영됐을 수 있으니 확인해 주세요.'
            : '연결이 끊겼습니다. 일부 작업이 이미 반영됐을 수 있으니 확인한 뒤 다시 요청해 주세요.'
        );
      } else if ((error as Error)?.name === 'AbortError') {
        // 사용자가 Esc 로 멈췄다. 보낸 말을 입력창으로 되돌리지 않는다 —
        // 서버는 이 발화를 이미 저장했으므로, 되돌려서 다시 보내면 같은 말이 두 번 남는다.
        finishInterrupted(
          '중단했습니다. 이어서 말씀하시면 그 대화에서 계속됩니다.'
        );
      } else {
        // 헤더까지 받은 뒤의 실패라 서버에 발화가 남았을 수 있다. 같은 이유로 되돌리지 않는다.
        finishInterrupted('연결이 끊겼습니다. 잠시 후 이어서 말씀해 주세요.');
      }
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`${styles.panel} ${sidebarOpen ? styles.withSidebar : ''}`}
        overlayClassName={styles.overlay}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          // Radix 는 document 캡처 단계에서 Esc 를 받는다 — textarea 에서
          // stopPropagation 해 봐야 이미 늦어 패널이 통째로 닫힌다.
          if (hints.length === 0) return;
          event.preventDefault();
          setHintsHiddenFor(input);
        }}
      >
        <IconRail
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((previous) => !previous)}
          onNew={resetConversation}
          disabled={pending || loadingHistory}
        />

        <SessionSidebar
          open={sidebarOpen}
          currentId={currentSessionId}
          revision={sessionRevision}
          onOpen={(id) => void openSession(id)}
          onNew={resetConversation}
          onClose={() => setSidebarOpen(false)}
          onDeleted={(id) => {
            // 지워진 세션에 계속 보내면 404 가 난다. 화면의 대화는 그대로 두고
            // 다음 발화부터 새 세션에 남긴다.
            if (sessionIdRef.current !== id) return;
            sessionIdRef.current = null;
            setCurrentSessionId(null);
            // 저장 effect 는 messages 만 구독한다 — 삭제는 messages 를 안 바꾸므로
            // 여기서 직접 지우지 않으면 새로고침 뒤에 지워진 id 가 되살아난다.
            persist(messages, null);
          }}
          disabled={pending || loadingHistory}
        />

        <div className={styles.main}>
          <SheetHeader className={styles.header}>
            <span aria-hidden className={styles.brandMark}>
              <AssistantFace size="md" />
            </span>
            <div className={styles.heading}>
              <SheetTitle className={styles.title}>{ASSISTANT_NAME}</SheetTitle>
              <SheetDescription className={styles.subtitle}>
                업무는 저한테 맡겨 주세요!
              </SheetDescription>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className={styles.resetButton}
                onClick={resetConversation}
                disabled={pending}
                title="대화 새로 시작"
              >
                <RotateCcw size={15} aria-hidden />
                <span className="sr-only">대화 새로 시작</span>
              </button>
            )}
          </SheetHeader>

          <div
            ref={scrollRef}
            className={styles.conversation}
            onScroll={(event) => {
              const box = event.currentTarget;
              const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
              stickToBottom.current = gap < 80;
            }}
          >
            {messages.length === 0 && (
              <section className={styles.welcome}>
                <div className={styles.hero}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={styles.speech}
                    src="/assistant/bubble-hello.png"
                    alt="안녕하세요!"
                  />
                  <AssistantFace mood="wave" size="lg" />
                </div>

                <p className={styles.greeting}>
                  저는 <strong>{ASSISTANT_NAME}</strong>예요!
                </p>
                <p className={styles.greetingSub}>
                  찾고, 고치고, 한 번에 올리고 — 뭐든 시켜만 주세요!
                </p>

                <div className={styles.chips}>
                  {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.chip}
                      onClick={() => void send(prompt)}
                    >
                      <span className={styles.chipIcon}>
                        <Icon size={17} strokeWidth={1.8} aria-hidden />
                      </span>
                      {label}
                    </button>
                  ))}
                </div>

                <p className={styles.orRow}>
                  <span>또는 아래에 직접 입력하세요</span>
                </p>

                <p className={styles.betaNote}>
                  베타 테스트로 아직은 상품 관련 일만 처리할 수 있어요
                </p>
              </section>
            )}

            <div
              role="log"
              aria-label="대화 내용"
              aria-live="polite"
              aria-relevant="additions"
              className={styles.messages}
            >
              {messages
                .filter(
                  (message) =>
                    message.role === 'user' ||
                    Boolean(message.content) ||
                    Boolean(message.runningTool) ||
                    (message.toolCalls?.length ?? 0) > 0
                )
                .map((message, index) => (
                  <div
                    key={index}
                    className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
                  >
                    <span className={styles.messageAuthor}>
                      {message.role === 'assistant' && <AssistantFace />}
                      {message.role === 'user' ? '나' : ASSISTANT_NAME}
                    </span>
                    <div className={styles.bubble}>
                      {message.role === 'assistant' ? (
                        <div className={styles.markdown}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : message.content ? (
                        <p className={styles.userText}>{message.content}</p>
                      ) : null}
                      {message.attachments &&
                        message.attachments.length > 0 && (
                          <div className={styles.sentAttachments}>
                            {message.attachments.map(({ id, file }) =>
                              file.type.startsWith('image/') ? (
                                // 이미지는 무엇을 보냈는지 바로 보이게 썸네일로 둔다.
                                <span key={id} className={styles.sentImage}>
                                  <ImageAttachment file={file} />
                                </span>
                              ) : (
                                <span key={id}>
                                  <Paperclip size={13} aria-hidden />
                                  <span>{file.name}</span>
                                </span>
                              )
                            )}
                          </div>
                        )}
                      {message.runningTool && (
                        <p className={styles.runningTool}>
                          <Loader2
                            size={13}
                            className={styles.spin}
                            aria-hidden
                          />
                          {TOOL_LABELS[message.runningTool] ?? '처리'} 중…
                        </p>
                      )}
                      {message.toolCalls && message.toolCalls.length > 0 && (
                        <ToolResults
                          calls={message.toolCalls}
                          onNavigate={() => onOpenChange(false)}
                          onChoose={chooseOption}
                          busy={pending || loadingHistory}
                        />
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {pending && (
              <div role="status" className={styles.thinking}>
                <AssistantFace mood="thinking" size="md" />
                <span>
                  요청을 처리하고 있어요
                  <span className={styles.thinkingDots}>…</span>
                </span>
              </div>
            )}
          </div>

          <div className={styles.footer}>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <form
              className={styles.composer}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDragging(true);
              }}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                attachFiles(Array.from(event.dataTransfer.files));
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {dragging && (
                <div className={styles.dropHint} role="status">
                  <Paperclip size={28} aria-hidden />
                  <strong>이미지나 엑셀 파일을 여기에 놓으세요</strong>
                </div>
              )}
              {hints.length > 0 && (
                <div
                  className={styles.hints}
                  role="listbox"
                  aria-label="추천 질문"
                >
                  {hints.map((hint, index) => (
                    <button
                      key={hint}
                      type="button"
                      role="option"
                      aria-selected={index === hintIndex}
                      className={`${styles.hint} ${index === hintIndex ? styles.hintActive : ''}`}
                      // 클릭 전에 blur 가 먼저 나면 입력 포커스가 흔들린다.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyHint(hint)}
                    >
                      <Search size={13} aria-hidden />
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              )}
              {files.length > 0 && (
                <div className={styles.attachments}>
                  {files.map(({ id, file }) => (
                    <span
                      key={id}
                      className={
                        file.type.startsWith('image/')
                          ? styles.imageAttachment
                          : styles.fileChip
                      }
                      title={file.name}
                    >
                      {file.type.startsWith('image/') ? (
                        <ImageAttachment file={file} />
                      ) : (
                        <>
                          <FileSpreadsheet size={15} aria-hidden />
                          <span>{file.name}</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => dropAttachment(id)}
                        aria-label={`${file.name} 첨부 취소`}
                      >
                        <X size={13} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={input}
                readOnly={pending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (hints.length > 0) {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const step = event.key === 'ArrowDown' ? 1 : -1;
                      // -1(입력창)까지 한 자리로 세고 순환시킨다.
                      setHintIndex(
                        (previous) =>
                          ((previous + step + hints.length + 2) %
                            (hints.length + 1)) -
                          1
                      );
                      return;
                    }
                    if (
                      event.key === 'Enter' &&
                      hintIndex >= 0 &&
                      !event.nativeEvent.isComposing &&
                      event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      applyHint(hints[hintIndex]);
                      return;
                    }
                  }
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                aria-label="메시지 입력"
                placeholder="상품명이나 필요한 작업을 입력해 주세요"
                className={styles.textarea}
              />
              <div className={styles.composerActions}>
                <div className={styles.attachAction}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,image/*"
                    multiple
                    hidden
                    onChange={(event) => {
                      attachFiles(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="파일 첨부 (엑셀 양식 · 이미지)"
                    className={styles.attachButton}
                  >
                    <Paperclip size={18} aria-hidden />
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={pending || (!input.trim() && files.length === 0)}
                  aria-label="보내기"
                  className={styles.sendButton}
                >
                  <ArrowUp size={19} aria-hidden />
                </button>
              </div>
            </form>
            <p className={styles.keyboardHint}>
              Enter 전송 <span>·</span> Shift + Enter 줄바꿈
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
