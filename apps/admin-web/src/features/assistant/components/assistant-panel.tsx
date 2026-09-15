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
  ArrowRight,
  ArrowUp,
  ClipboardCheck,
  RotateCcw,
  FileSpreadsheet,
  Loader2,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlmondMark } from './almond-mark';
import { ToolResults, TOOL_LABELS } from './tool-result';
import {
  appendMessage,
  createSession,
  loadMessages,
  titleFrom,
} from '../lib/chat-history';
import { HistoryMenu } from './history-menu';
import buttonStyles from './assistant-button.module.css';
import styles from './assistant-panel.module.css';

/** 같은 이름의 첨부를 구분하려면 파일명이 아니라 키로 식별해야 한다. */
type Attachment = { id: string; file: File };

/**
 * 새로고침해도 대화를 잇는다. 첨부 파일(File)은 직렬화할 수 없으므로 텍스트와
 * 도구 결과만 남긴다 — 이미지가 필요한 작업은 다시 첨부해야 한다.
 */
const STORAGE_KEY = 'almondyoung.assistant.session';

type DraftSession = {
  messages: { role: 'user' | 'assistant'; content: string; toolCalls?: unknown[] }[];
  conversation: unknown[];
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

const SUGGESTIONS = [
  {
    icon: Search,
    title: '상품 찾아보기',
    description: '상품 목록과 상세 정보를 확인해요',
    prompt: '상품 목록을 5개 보여줘.',
  },
  {
    icon: FileSpreadsheet,
    title: '엑셀로 일괄 등록',
    description: '양식과 등록 방법을 안내해요',
    prompt:
      '엑셀로 상품을 일괄 등록하려고 해. 필요한 양식과 진행 방법을 알려줘.',
  },
  {
    icon: ClipboardCheck,
    title: '진행 중인 작업 확인',
    description: '최근 업로드한 작업의 상태를 살펴봐요',
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
   * 보냈지만 아직 업로드에 쓰이지 않은 첨부. 입력창에서는 치우고(보낸 것처럼 보이게)
   * 다음 요청에 조용히 함께 보낸다 — 어시스턴트가 "카테고리 뭘로 할까요" 하고 되물었을 때
   * 사용자가 같은 이미지를 다시 고르지 않아도 되도록.
   */
  const carriedRef = useRef<Attachment[]>([]);
  /**
   * 서버가 돌려준 대화 원본(도구 호출·결과 포함). 화면용 messages 와 달리
   * 이전 턴에 받은 fileId 같은 것이 들어 있어서, 다음 요청에 그대로 보내야
   * 모델이 이미 올린 이미지를 다시 달라고 하지 않는다.
   */
  const conversationRef = useRef<unknown[]>([]);
  /** 서버에 남기는 대화의 세션 id. 첫 발화 때 만들고 그 뒤로 붙여 나간다. */
  const sessionIdRef = useRef<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /**
   * 기록 저장은 순서대로 처리한다. 세션 생성보다 답변이 먼저 끝나면
   * 저장할 세션이 아직 없어 그 답변이 통째로 누락된다.
   */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * 진행 중인 세션 생성. 첫 턴의 생성이 끝나기 전에 다음 턴을 보내면
   * 세션이 하나 더 만들어져 같은 대화가 둘로 쪼개진다.
   */
  const pendingSession = useRef<Promise<string | null> | null>(null);
  /** 지난 대화를 여는 중인가. 늦게 끝난 조회가 진행 중 대화를 덮어쓰면 안 된다. */
  const loadToken = useRef(0);

  function enqueueSave(task: () => Promise<unknown>) {
    // 저장 실패가 다음 저장을 막지 않게 체인을 끊어 둔다.
    saveQueue.current = saveQueue.current.then(task, task);
  }
  const restored = useRef(false);

  // 새로고침 뒤 첫 렌더에 한 번만 복원한다.
  if (typeof window !== 'undefined' && !restored.current) {
    restored.current = true;
    const saved = loadSession();
    if (saved?.messages?.length) {
      conversationRef.current = saved.conversation ?? [];
    }
  }
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

  /** 첨부를 완전히 버린다 — 입력창과 다음 요청에 따라갈 대기 목록 양쪽에서. */
  function resetConversation() {
    setMessages([]);
    setFiles([]);
    setInput('');
    setError(null);
    carriedRef.current = [];
    conversationRef.current = [];
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    pendingSession.current = null;
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

    // 모델에 되돌려줄 원본은 마지막으로 저장된 것이 가장 완전하다.
    const lastBlocks = [...rows]
      .reverse()
      .find((row) => Array.isArray(row.contentBlocks))?.contentBlocks;
    conversationRef.current = (lastBlocks as unknown[]) ?? [];

    sessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
    pendingSession.current = null;
    carriedRef.current = [];
    setFiles([]);
    setInput('');
    setError(null);
  }

  function dropAttachment(id: string) {
    setFiles((previous) => previous.filter((a) => a.id !== id));
    carriedRef.current = carriedRef.current.filter((a) => a.id !== id);
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

  useEffect(() => {
    if (messages.length === 0) return;
    saveSession({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
      })),
      conversation: conversationRef.current,
    });
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

  async function send() {
    const text = input.trim();
    if ((!text && files.length === 0) || pending || loadingHistory) return;

    const outgoing: Message = {
      role: 'user',
      content: text,
      attachments: files,
    };
    const history = [
      ...(conversationRef.current.length > 0
        ? conversationRef.current
        : messages.map((message) => ({
            role: message.role,
            content: message.content || '(첨부 파일만 보냄)',
          }))),
      { role: 'user', content: text || '(첨부 파일만 보냄)' },
    ];

    setMessages((previous) => [...previous, outgoing]);
    setInput('');
    // 첨부는 여기서 비우지 않는다 — 어시스턴트가 "카테고리 뭘로 할까요" 처럼 되물으면
    // 그 턴에 파일이 사라져서, 사용자가 답할 때 이미지를 다시 첨부해야 한다.
    // 업로드 도구가 실제로 썼다고 알려줄 때(consumedAttachments)만 비운다.
    setError(null);
    setPending(true);

    // 이번에 새로 고른 것 + 아직 안 쓰인 이전 첨부를 함께 보낸다.
    const sending = [
      ...carriedRef.current.filter((c) => !files.some((f) => f.id === c.id)),
      ...files,
    ];
    carriedRef.current = sending;

    /**
     * 이 턴이 저장될 세션을 «여기서 고정»한다.
     *
     * 큐 안에서 sessionIdRef 를 읽으면, 저장이 밀린 사이 사용자가 다른 대화를 열었을 때
     * 이 턴의 답변이 그 대화에 가서 붙는다. 세션을 promise 로 묶어 두면 나중에
     * 무엇을 열든 이 턴은 자기 세션에만 저장된다.
     */
    let turnSession: Promise<string | null>;
    if (sessionIdRef.current !== null) {
      turnSession = Promise.resolve(sessionIdRef.current);
    } else if (pendingSession.current) {
      // 같은 대화의 다음 턴. 진행 중인 생성을 함께 기다린다.
      turnSession = pendingSession.current;
    } else {
      const started: Promise<string | null> = createSession(
        titleFrom(text || '첨부 파일')
      ).then((session) => {
        const id = session?.id ?? null;

        // 실패한 결과를 물고 있으면 이후 턴이 전부 그 null 을 받아 기록이
        // 영영 안 남는다. 다만 그 사이 새 대화가 시작됐을 수 있으므로
        // 아직 «내가 걸어둔» 생성일 때만 비운다.
        if (!id) {
          if (pendingSession.current === started) pendingSession.current = null;
          return null;
        }

        // 그 사이 다른 대화를 열었으면 현재 세션을 덮지 않는다.
        if (sessionIdRef.current === null && pendingSession.current === started) {
          sessionIdRef.current = id;
          setCurrentSessionId(id);
        }
        return id;
      });
      pendingSession.current = started;
      turnSession = started;
    }

    // 기록 저장은 대화를 막지 않는다 — 실패해도 답변은 그대로 진행된다.
    enqueueSave(async () => {
      const id = await turnSession;
      if (!id) return;
      await appendMessage(id, { role: 'user', content: text });
    });

    const body = new FormData();
    body.append('messages', JSON.stringify(history));
    for (const { id, file } of sending) {
      body.append('files', file);
      body.append('fileIds', id);
    }

    // 입력창은 비운다. 보낸 파일은 위 대화 말풍선에 파일명으로 남는다.
    setFiles([]);

    function restoreDraft(message: string) {
      setMessages((previous) => previous.slice(0, -1));
      setInput(text);
      setFiles(files);
      const returned = new Set(files.map((a) => a.id));
      carriedRef.current = carriedRef.current.filter((a) => !returned.has(a.id));
      setError(message);
    }

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetchWithRefresh('/api/ai/assistant/chat', {
        method: 'POST',
        body,
        signal: controller.signal,
        credentials: 'include',
      });
      if (!res.ok || !res.body) {
        const fallback = await res
          .json()
          .then((b: { message?: string }) => b.message)
          .catch(() => undefined);
        restoreDraft(fallback ?? '요청을 완료하지 못했습니다.');
        return;
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
        setMessages((previous) => [...previous, { role: 'assistant', content: '' }]);
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedText = '';
      let data: {
        message?: string;
        toolCalls?: { name: string; input?: unknown; result?: unknown }[];
        consumedIds?: string[];
        conversation?: unknown[];
      } = {};

      const updateLast = (patch: Partial<Message>) => {
        ensureBubble();
        setMessages((previous) => {
          const next = [...previous];
          next[next.length - 1] = { ...next[next.length - 1], ...patch };
          return next;
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const payload = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !payload) continue;

          const parsed = JSON.parse(payload);
          if (event === 'delta') {
            streamedText += parsed.text as string;
            updateLast({ content: streamedText });
          } else if (event === 'tool') {
            updateLast({ runningTool: parsed.status === 'running' ? parsed.name : undefined });
          } else {
            // done · aborted · error 는 모두 마지막 상태를 싣고 온다.
            data = parsed;
            if (event === 'error') setError(parsed.message ?? '요청을 처리하지 못했습니다.');
          }
        }
      }

      if (Array.isArray(data.conversation)) {
        conversationRef.current = data.conversation;
      }

      updateLast({
        content: data.message ?? streamedText,
        toolCalls: data.toolCalls,
        runningTool: undefined,
      });

      // 이 답변이 «시작될 때의» 세션에 저장한다. 큐에 넣어 두면 세션 생성이
      // 늦게 끝나도 순서가 지켜진다.
      const answer = data.message ?? streamedText;
      enqueueSave(async () => {
        const id = await turnSession;
        if (!id) return;
        await appendMessage(id, {
          role: 'assistant',
          content: answer,
          // 원본을 통째로 남겨야 나중에 불러왔을 때 도구 결과까지 이어진다.
          contentBlocks: data.conversation,
          toolCalls: data.toolCalls,
        });
      });

      const consumed = data.consumedIds ?? [];
      if (consumed.length > 0) {
        carriedRef.current = carriedRef.current.filter(
          (a) => !consumed.includes(a.id)
        );
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        // 사용자가 Esc 로 멈춘 것이다. 실패가 아니므로 보낸 말과 첨부를 되돌린다.
        setMessages((previous) => previous.slice(0, -1));
        setInput(text);
        setFiles(files);
        const returned = new Set(files.map((a) => a.id));
        carriedRef.current = carriedRef.current.filter((a) => !returned.has(a.id));
        // conversationRef 는 건드리지 않는다. 이번 턴은 서버 응답을 받아야 들어가므로
        // 여기서 자르면 직전에 성공한 턴이 날아간다.
      } else {
        restoreDraft('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
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
        className={styles.panel}
        overlayClassName={styles.overlay}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <SheetHeader className={styles.header}>
          <span aria-hidden className={styles.brandMark}>
            <span className={buttonStyles.knob}>
              <span className={`${buttonStyles.ring} ${styles.brandRing}`} />
              <AlmondMark className={buttonStyles.logo} />
            </span>
          </span>
          <div className={styles.heading}>
            <SheetTitle className={styles.title}>아몬드영 AI 챗봇</SheetTitle>
            <SheetDescription className={styles.subtitle}>
              상품 관리부터 엑셀 일괄 작업까지
            </SheetDescription>
          </div>
          <HistoryMenu
            currentId={currentSessionId}
            onOpen={(id) => void openSession(id)}
            onDeleted={(id) => {
              // 지워진 세션에 계속 저장하면 404 로 조용히 사라진다.
              // 화면의 대화는 그대로 두고 다음 발화부터 새 세션에 남긴다.
              if (sessionIdRef.current !== id) return;
              sessionIdRef.current = null;
              setCurrentSessionId(null);
              pendingSession.current = null;
            }}
            disabled={pending || loadingHistory}
          />
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
              <span className={styles.eyebrow}>함께하는 상품 관리</span>
              <h2>
                어떤 작업을
                <br />
                도와드릴까요?
              </h2>
              <p>
                상품을 찾고 수정하거나,
                <br />
                엑셀로 여러 상품을 한 번에 관리하세요.
              </p>
              <div className={styles.suggestions}>
                {SUGGESTIONS.map(
                  ({ icon: Icon, title, description, prompt }) => (
                    <button
                      key={title}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => {
                        setInput(prompt);
                        inputRef.current?.focus();
                      }}
                    >
                      <span className={styles.suggestionIcon}>
                        <Icon size={18} aria-hidden />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <ArrowRight size={15} aria-hidden />
                    </button>
                  )
                )}
              </div>
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
                  {message.role === 'user' ? '나' : '아몬드영 AI'}
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
                  {message.attachments && message.attachments.length > 0 && (
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
                      <Loader2 size={13} className={styles.spin} aria-hidden />
                      {TOOL_LABELS[message.runningTool] ?? '처리'} 중…
                    </p>
                  )}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <ToolResults
                      calls={message.toolCalls}
                      onNavigate={() => onOpenChange(false)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {pending && (
            <div role="status" className={styles.thinking}>
              <Loader2 size={16} className={styles.spinner} aria-hidden />
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
                      onClick={() =>
                        dropAttachment(id)
                      }
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
      </SheetContent>
    </Sheet>
  );
}
