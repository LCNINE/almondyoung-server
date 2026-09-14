'use client';

import { lazy, type ReactNode, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './product-ai-panel.module.css';

const ProductAiChatContent = lazy(() =>
  import('./product-ai-chat').then((module) => ({
    default: module.ProductAiChatContent,
  }))
);

function ChatLoading() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="text-sm text-muted-foreground">도우미를 준비하고 있어요</p>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col gap-4 motion-safe:animate-pulse"
      >
        <div className="h-10 w-2/3 rounded-xl bg-muted" />
        <div className="ml-auto h-16 w-3/4 rounded-xl bg-orange-100/50" />
        <div className="h-16 w-4/5 rounded-xl bg-muted" />
        <div className="mt-auto h-24 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export function ProductAiPanel() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [contentHost, setContentHost] = useState<HTMLDivElement | null>(null);

  // 채팅 상태는 닫아도 유지하고, 로딩 여부와 무관하게 같은 패널 본문에만 렌더링한다.
  const renderChat = (chat: ReactNode) =>
    contentHost ? createPortal(chat, contentHost) : null;

  const panel = (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15" />
      <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-[760px] flex-col border-l bg-background shadow-2xl outline-none data-[state=closed]:hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:animate-none">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-5 py-4 pr-12">
          <Image
            src="/images/almondyoung-symbol.webp"
            alt=""
            width={32}
            height={32}
          />
          <div>
            <div className="flex items-center gap-3">
              <Dialog.Title className="text-sm font-semibold text-slate-800">
                아몬드영 AI 챗봇
              </Dialog.Title>
              <Link
                href={
                  sessionId
                    ? `/mall/product-ai?sessionId=${encodeURIComponent(sessionId)}`
                    : '/mall/product-ai'
                }
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Maximize2 size={13} /> 전체보기
              </Link>
            </div>
            <Dialog.Description className="mt-1 text-xs leading-5 text-slate-400">
              운영의 일상을 함께하는 나의 어시스턴트
            </Dialog.Description>
          </div>
        </div>
        <Dialog.Close asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 rounded-full text-slate-400 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-200"
            aria-label="AI 채팅 닫기"
          >
            <X size={18} />
          </Button>
        </Dialog.Close>
        <div ref={setContentHost} className="flex min-h-0 flex-1 flex-col" />
      </Dialog.Content>
    </Dialog.Portal>
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setMounted(true);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-label="아몬드영 AI 챗봇"
        >
          <span className={styles.triggerContent}>
            <Image
              src="/images/almondyoung-symbol.webp"
              alt=""
              width={24}
              height={24}
            />
            <span className="hidden sm:inline">아몬드영 AI 챗봇</span>
            <span className="sm:hidden">AI 챗봇</span>
          </span>
        </button>
      </Dialog.Trigger>
      {panel}
      {mounted && (
        <Suspense fallback={renderChat(<ChatLoading />)}>
          <ProductAiChatContent
            embedded
            active={open}
            sessionId={sessionId}
            onSessionChange={setSessionId}
            render={renderChat}
          />
        </Suspense>
      )}
    </Dialog.Root>
  );
}
