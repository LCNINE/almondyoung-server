'use client';

import { useEffect, useState } from 'react';
import { Loader2, SquarePen, Trash2, X } from 'lucide-react';
import {
  deleteSession,
  listSessions,
  type StoredSession,
} from '../lib/chat-history';
import styles from './session-sidebar.module.css';

type Props = {
  open: boolean;
  /** 현재 보고 있는 대화. 목록에서 표시해 준다. */
  currentId: string | null;
  /** 목록을 다시 읽어야 할 때 바뀌는 값. 새 대화가 생기면 올라간다. */
  revision: number;
  onOpen: (sessionId: string) => void;
  /** 현재 보고 있는 대화가 지워졌을 때. 그 세션에 계속 저장하면 404 로 유실된다. */
  onDeleted: (sessionId: string) => void;
  onNew: () => void;
  onClose: () => void;
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

export function SessionSidebar({
  open,
  currentId,
  revision,
  onOpen,
  onDeleted,
  onNew,
  onClose,
  disabled,
}: Props) {
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listSessions(30).then((rows) => {
      if (live) setSessions(Array.isArray(rows) ? rows : []);
    });
    return () => {
      live = false;
    };
  }, [open, revision]);

  return (
    <aside
      className={`${styles.sidebar} ${open ? styles.open : ''}`}
      aria-label="지난 대화"
    >
      <div className={styles.top}>
        <span className={styles.heading}>지난 대화</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          title="목록 닫기"
        >
          <X size={15} aria-hidden />
          <span className="sr-only">목록 닫기</span>
        </button>
      </div>

      <button
        type="button"
        className={styles.newChat}
        onClick={onNew}
        disabled={disabled}
      >
        <SquarePen size={15} aria-hidden />새 대화 시작
      </button>

      <div className={styles.list}>
        {sessions === null && (
          <p className={styles.state}>
            <Loader2 size={13} className={styles.spin} aria-hidden />
            불러오는 중…
          </p>
        )}

        {sessions?.length === 0 && (
          <p className={styles.state}>아직 저장된 대화가 없어요.</p>
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
              disabled={disabled}
              onClick={() => onOpen(session.id)}
            >
              <span className={styles.rowTitle}>
                {session.title ?? '새 대화'}
              </span>
              <span className={styles.rowTime}>{when(session.updatedAt)}</span>
            </button>

            <button
              type="button"
              className={styles.rowDelete}
              title="이 대화 삭제"
              // 답변이 도는 중에 지우면 그 턴의 저장이 외래 키에서 실패한다.
              disabled={disabled}
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
    </aside>
  );
}
