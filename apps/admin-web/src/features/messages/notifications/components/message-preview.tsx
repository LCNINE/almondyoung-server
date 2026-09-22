'use client';

import { useEffect, useRef } from 'react';
import type { NotificationChannel } from '@/lib/api/domains/notification';
import { fillSample } from '../lib/render';

export function MessagePreview({
  channel,
  subject,
  body,
}: {
  channel: NotificationChannel;
  subject?: string;
  body: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = fillSample(body);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html, channel]);

  if (channel !== 'EMAIL') {
    return (
      <div className="rounded-md bg-sky-50 p-4">
        <p className="rounded-md bg-white p-3 text-sm whitespace-pre-wrap text-gray-800 shadow-sm">
          {fillSample(body) || '본문이 없습니다.'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-md border">
      <div className="border-b bg-gray-50 px-3 py-2 text-sm">
        <span className="text-muted-foreground mr-2">제목</span>
        {subject ? fillSample(subject) : '(제목 없음)'}
      </div>
      <iframe
        title="메일 미리보기"
        sandbox="allow-same-origin"
        ref={frameRef}
        className="h-[480px] w-full bg-white"
      />
    </div>
  );
}
