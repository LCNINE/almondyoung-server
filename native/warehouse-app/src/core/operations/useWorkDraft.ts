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
  useEffect(() => {
    let live = true;
    if (!runtime) {
      setReady(true);
      return;
    }
    setReady(false);
    serial.current = id()
      .then((name) => runtime.store.draft<T>(name))
      .then((saved) => {
        if (live) {
          current.current = saved ?? initial;
          setValue(current.current);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [runtime, key, id]);
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
    read: async () => {
      await serial.current;
      return current.current;
    },
  };
}
