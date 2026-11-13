import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkRuntime } from './OperationContext';
/** Draft writes finish before their projection is shown or used by a mutation. */
export function useWorkDraft<T>(key: string, initial: T) {
  const runtime = useWorkRuntime();
  const current = useRef(initial);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<unknown>();
  const [ready, setReady] = useState(!runtime);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const id = useCallback(
    async () => `${await runtime!.getScope()}:draft:${key}`,
    [runtime, key]
  );
  // 마지막으로 시작한 불러오기만 결과를 반영한다(다시 불러오기·언마운트).
  const [loads] = useState(() => ({ generation: 0 }));
  const load = useCallback(() => {
    const mine = ++loads.generation;
    if (!runtime) {
      setReady(true);
      return;
    }
    setReady(false);
    setError(undefined);
    // 앞서 시작한 저장이 끝난 뒤에 읽는다 — 저장 순서를 끊지 않는다.
    serial.current = serial.current
      .then(() => id())
      .then((name) => runtime.store.draft<T>(name))
      .then((saved) => {
        if (loads.generation === mine) {
          current.current = saved ?? initial;
          setValue(current.current);
          setReady(true);
        }
      })
      .catch((e) => {
        if (loads.generation === mine) setError(e);
      });
  }, [runtime, id, loads]);
  useEffect(() => {
    load();
    return () => {
      loads.generation++;
    };
  }, [load, loads]);
  const update = useCallback(
    (reduce: (prev: T) => T): Promise<void> => {
      const run = serial.current.then(async () => {
        const next = runtime
          ? await runtime.store.draft<T>(await id(), (old) =>
              reduce(old ?? initial)
            )
          : reduce(current.current);
        current.current = next!;
        setValue(next!);
        setError(undefined);
      });
      serial.current = run.catch((e) => setError(e));
      return run;
    },
    [runtime, id]
  );
  return {
    value,
    update,
    ready,
    error,
    /** 불러오기에 실패했을 때 저장된 작업을 다시 읽는다. */
    reload: load,
    read: async () => {
      await serial.current;
      return current.current;
    },
  };
}
