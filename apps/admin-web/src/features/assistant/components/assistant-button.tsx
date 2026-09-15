'use client';

import { useState } from 'react';
import { AssistantPanel } from './assistant-panel';
import { AlmondMark } from './almond-mark';
import styles from './assistant-button.module.css';

export function AssistantButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="아몬드영 AI 챗봇 열기"
        className={styles.button}
      >
        <span className={styles.knob}>
          <span className={styles.ring} aria-hidden />
          <AlmondMark className={styles.logo} />
        </span>
        <span className={styles.label}>아몬드영 AI 챗봇</span>
      </button>

      <AssistantPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
