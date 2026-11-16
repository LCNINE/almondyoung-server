import { useState } from 'react';

/**
 * 서버 값으로 시작하고, 서버 값이 바뀌면(refetch) 따라간다.
 * 단 사용자가 그 칸을 고치는 중(이전 서버 값과 다름)이면 입력을 지키지 않고 둔다.
 */
export function useSyncedState<T>(server: T): [T, (v: T) => void] {
  const [value, setValue] = useState(server);
  const [prev, setPrev] = useState(server);
  if (!Object.is(prev, server)) {
    setPrev(server);
    if (Object.is(value, prev)) setValue(server);
  }
  return [value, setValue];
}
