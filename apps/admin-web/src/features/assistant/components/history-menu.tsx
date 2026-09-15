'use client';

import { useEffect, useState } from 'react';
import { History, Loader2, Trash2 } from 'lucide-react';
import {
  deleteSession,
  listSessions,
  type StoredSession,
} from '../lib/chat-history';
import styles from './history-menu.module.css';

type Props = {
  /** 현재 보고 있는 대화. 목록에서 표시해 준다. */
  currentId: string | null;
  onOpen: (sessionId: string) => void;
  /** 현재 보고 있는 대화가 지워졌을 때. 그 세션에 계속 저장하면 404 로 유실된다. */
  onDeleted: (sessionId: string) => void;
  disabled?: boolean;
};

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

export function HistoryMenu({ currentId, onOpen, onDeleted, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setSessions(null);
    void listSessions(30).then((rows) => setSessions(Array.isArray(rows) ? rows : []));
  }, [open]);

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className={styles.wrapper} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((previous) => !previous)}
        disabled={disabled}
        title="지난 대화"
      >
        <History size={15} aria-hidden />
        <span className="sr-only">지난 대화</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {sessions === null && (
            <p className={styles.state}>
              <Loader2 size={13} className={styles.spin} aria-hidden />
              불러오는 중…
            </p>
          )}

          {sessions?.length === 0 && (
            <p className={styles.state}>저장된 대화가 없습니다.</p>
          )}

          {sessions?.map((session) => (
            <div
              key={session.id}
              className={`${styles.row} ${
                session.id === currentId ? styles.current : ''
              }`}
            >
              <button
                type="button"
                className={styles.rowMain}
                onClick={() => {
                  onOpen(session.id);
                  setOpen(false);
                }}
              >
                <span className={styles.rowTitle}>{session.title ?? '새 대화'}</span>
                <span className={styles.rowTime}>{when(session.updatedAt)}</span>
              </button>

              <button
                type="button"
                className={styles.rowDelete}
                title="이 대화 삭제"
                onClick={async () => {
                  // 기록 삭제라 되돌릴 수 없다. 상품이 지워지는 것은 아니다.
                  if (!window.confirm('이 대화를 삭제할까요?')) return;
                  const removed = await deleteSession(session.id);
                  if (!removed) return;
                  setSessions((previous) =>
                    (previous ?? []).filter((row) => row.id !== session.id)
                  );
                  onDeleted(session.id);
                }}
              >
                <Trash2 size={13} aria-hidden />
                <span className="sr-only">삭제</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
