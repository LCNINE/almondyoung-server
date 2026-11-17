import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { isBlockedWrite, isUncertainWrite } from '../../domains/inbound-shipment/api';
import { useFeedback } from '../feedback/FeedbackProvider';

/**
 * 멱등 키 하나로 보내는 쓰기(확정 취소·리스트에 없는 상자 더하기, 스펙 §6) — 키를 `draftKey` 초안에 남긴 뒤 보낸다.
 * 초안에 키가 있으면 «보냈는데 결과를 모른다» 이다: 다시 보내기는 언제나 그 키다(다시 켜도 초안에서 되살아난다).
 *
 * 러너(`operationRunner.request`)는 결과를 모르는(uncertain) 작업의 약속을 풀지 않는다. 그래서 러너를 구독해
 * 그 키의 작업이 uncertain 이 되면 보내는 중을 풀고, 다른 곳(처리 내역 확인)에서 결과가 나면 같은 키로 다시 불러
 * 기기에 남은 결과를 받는다(서버에 다시 가지 않는다) — 상자 작업(`BoxWork`)의 확정과 같은 결이다.
 *
 * - 확정되면 `onConfirmed` 가 서버 상태를 확인한다. 다음 할 일을 돌려주면 키를 지운 뒤 부르고, false 면(확인 못 함)
 *   키를 둔 채 «결과 모름» 으로 남는다.
 * - 거절되면 키를 지우고 `onRejected` — 다음 보내기는 새 키다.
 * - 러너가 보내기 전에 막으면(같은 자원에 결과가 나지 않은 다른 쓰기, `isBlockedWrite`) 이 키로 나간 것이 없다 —
 *   «결과 모름» 으로 잠그지 않게 기기의 키를 지우고 `blocked` 에 그 까닭을 둔다. 다음 보내기는 새 키여도 안전하다.
 */
export function useKeyedWrite<R>({
  draftKey,
  send,
  onConfirmed,
  onRejected,
}: {
  draftKey: string;
  send(key: string): Promise<R>;
  onConfirmed(result: R): Promise<(() => void) | false>;
  onRejected(error: unknown): void | Promise<void>;
}) {
  const runtime = useWorkRuntime();
  const { signal } = useFeedback();
  const saved = useWorkDraft<string | null>(draftKey, null);
  const [sending, setSendingState] = useState(false);
  const sendingRef = useRef(false);
  const [unsaved, setUnsaved] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const mounted = useRef(true);
  // 이 키의 결과를 이미 처리했다 — 같은 키의 대기가 여럿 풀려도(재전송) 한 번만
  const settled = useRef<string | null>(null);
  // 마지막 전송 — 앞 전송의 늦은 finally 가 뒤 전송의 상태를 풀지 않게
  const seq = useRef(0);
  const handlers = useRef({ send, onConfirmed, onRejected });
  handlers.current = { send, onConfirmed, onRejected };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setSending = useCallback((next: boolean) => {
    sendingRef.current = next;
    setSendingState(next);
  }, []);
  /** 입력을 다시 받는다 — 늦게 끝나는 앞 전송의 finally 는 이제 아무것도 풀지 않는다 */
  const release = useCallback(() => {
    seq.current++;
    setSending(false);
  }, [setSending]);
  /** 키를 지운다 — 실패해도 다음 단계는 막지 않는다(키가 남아도 다음 보내기가 그 결과를 다시 받아 같은 판정을 한다) */
  const drop = () => saved.update(() => null).catch(() => {});

  const transmit = async (key: string) => {
    const mine = ++seq.current;
    setSending(true);
    try {
      let result: R;
      try {
        result = await handlers.current.send(key);
      } catch (error) {
        if (!mounted.current || settled.current === key) return;
        if (isBlockedWrite(error)) {
          await drop();
          if (!mounted.current) return;
          setBlocked(error.message);
          signal('error');
          return;
        }
        if (isUncertainWrite(error)) {
          signal('error');
          return;
        }
        settled.current = key;
        await drop();
        if (mounted.current) await handlers.current.onRejected(error);
        return;
      }
      if (!mounted.current || settled.current === key) return;
      const next = await handlers.current.onConfirmed(result);
      if (next === false || !mounted.current || settled.current === key) return;
      settled.current = key;
      await drop();
      next();
    } finally {
      if (mounted.current && seq.current === mine) release();
    }
  };
  const transmitRef = useRef(transmit);
  transmitRef.current = transmit;

  /** 보낸다 — 초안에 남은 키가 있으면 그 키로, 없으면 새 키를 먼저 기기에 남긴 뒤 */
  const sendNow = async () => {
    if (sendingRef.current || !saved.ready) return;
    setSending(true);
    setUnsaved(false);
    setBlocked(null);
    let key = await saved.read();
    if (!key) {
      const fresh = crypto.randomUUID();
      const stored = await saved.update(() => fresh).then(
        () => true,
        () => false
      );
      if (!mounted.current) return;
      if (!stored) {
        release();
        setUnsaved(true);
        signal('error');
        return;
      }
      key = fresh;
    }
    if (!mounted.current) return;
    await transmit(key);
  };

  // 열 때 남은 키가 있으면 — 그 작업이 이미 끝났으면(확정·거절) 같은 키로 불러 결과를 받는다. 아니면 «결과 모름» 으로 둔다
  const loaded = useRef(false);
  useEffect(() => {
    if (!saved.ready || loaded.current) return;
    loaded.current = true;
    const key = saved.value;
    if (!key || !runtime) return;
    void runtime.store
      .get(key)
      .then((op) => {
        if (!mounted.current || sendingRef.current) return;
        if (op?.status === 'confirmed' || op?.status === 'rejected') void transmitRef.current(key);
      })
      .catch(() => {});
    // 처음 한 번만 — 그 뒤의 키 변경은 이 훅이 낸 것이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.ready]);

  const sentKey = saved.ready ? saved.value : null;
  useEffect(() => {
    if (!runtime || !sentKey) return;
    return runtime.runner.subscribe(() => {
      void runtime.store
        .get(sentKey)
        .then((op) => {
          if (!mounted.current || settled.current === sentKey) return;
          if (op?.status === 'uncertain' && sendingRef.current) {
            release();
            signal('error');
          } else if ((op?.status === 'confirmed' || op?.status === 'rejected') && !sendingRef.current) {
            void transmitRef.current(sentKey);
          }
        })
        .catch(() => {});
    });
  }, [runtime, sentKey, release, signal]);

  return {
    ready: saved.ready,
    loadError: saved.error,
    sending,
    /** 보냈는데 결과를 모른다 — 다시 보내기는 같은 키 */
    uncertain: !!sentKey && !sending,
    /** 키를 기기에 남기지 못해 보내지 않았다 */
    unsaved,
    /** 러너가 보내기 전에 막았다(같은 자원에 결과가 나지 않은 쓰기) — 보일 한 줄. 보낸 것이 없어 잠기지 않는다 */
    blocked,
    send: sendNow,
  };
}
