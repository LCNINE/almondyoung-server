'use client';

import { PanelLeft, SquarePen } from 'lucide-react';
import styles from './icon-rail.module.css';

type Props = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNew: () => void;
  disabled?: boolean;
};

export function IconRail({
  sidebarOpen,
  onToggleSidebar,
  onNew,
  disabled,
}: Props) {
  return (
    <nav className={styles.rail} aria-label="빠른 작업">
      <button
        type="button"
        className={`${styles.railButton} ${sidebarOpen ? styles.active : ''}`}
        onClick={onToggleSidebar}
        title={sidebarOpen ? '대화 목록 닫기' : '대화 목록 열기'}
      >
        <PanelLeft size={17} aria-hidden />
        <span className="sr-only">대화 목록</span>
      </button>

      <button
        type="button"
        className={styles.railButton}
        onClick={onNew}
        disabled={disabled}
        title="새 대화 시작"
      >
        <SquarePen size={17} aria-hidden />
        <span className="sr-only">새 대화 시작</span>
      </button>
    </nav>
  );
}
