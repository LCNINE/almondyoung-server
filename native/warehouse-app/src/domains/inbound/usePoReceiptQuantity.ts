import { useRef, useState } from 'react';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import {
  normalizePoReceiveDraft,
  type PoReceiveDraft,
  type ReceiptQuantity,
} from './poReceiveDraft';

/** Immediate input preview, with ordered durable writes before a scan may apply. */
export function usePoReceiptQuantity(draft: {
  value: PoReceiveDraft;
  update: (
    reduce: (previous: PoReceiveDraft) => PoReceiveDraft
  ) => Promise<void>;
}) {
  const pending = useRef<ReceiptQuantity[]>([]);
  const running = useRef<Promise<void> | null>(null);
  const failed = useRef(false);
  const retrying = useRef(false);
  const waiters = useRef<Array<() => void>>([]);
  const [preview, setPreview] = useState<ReceiptQuantity | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const quantity = preview ?? normalizePoReceiveDraft(draft.value).quantity;
  const latestText = useRef(quantity?.text ?? '');
  if (!pending.current.length) latestText.current = quantity?.text ?? '';
  useUnsavedWork(preview !== null);

  function pump(): Promise<void> {
    if (running.current) return running.current;
    running.current = (async () => {
      while (pending.current.length && !failed.current) {
        const next = pending.current[0];
        try {
          await draft.update((previous) => ({ ...previous, quantity: next }));
        } catch {
          failed.current = true;
          setSaveFailed(true);
          return;
        }
        pending.current.shift();
      }
      if (!pending.current.length) {
        setPreview(null);
        waiters.current.splice(0).forEach((resolve) => resolve());
      }
    })().finally(() => {
      running.current = null;
      if (pending.current.length && !failed.current) void pump();
    });
    return running.current;
  }

  return {
    text: quantity?.text ?? '',
    getText: () => latestText.current,
    pending: preview !== null,
    isPending: () => pending.current.length > 0,
    saveFailed,
    change(text: string) {
      const next: ReceiptQuantity = { text, source: 'manual' };
      latestText.current = text;
      pending.current.push(next);
      setPreview(next);
      void pump();
    },
    async retry() {
      if (retrying.current) return;
      retrying.current = true;
      try {
        if (running.current) await running.current;
        failed.current = false;
        setSaveFailed(false);
        await pump();
      } finally {
        retrying.current = false;
      }
    },
    async waitUntilSaved() {
      if (pending.current.length)
        await new Promise<void>((resolve) => waiters.current.push(resolve));
    },
  };
}
