import { useEffect, useState } from 'react';

/** 화면이 내려가도 앱이 켜져 있는 동안 남는 값. 모듈 상수로 만들어 화면마다 하나씩 둔다. */
export interface Remembered<T> {
  value: T;
}

const resets: Array<() => void> = [];

export function remembered<T>(initial: T): Remembered<T> {
  const box = { value: initial };

  resets.push(() => {
    box.value = initial;
  });

  return box;
}

/** 모든 기억을 처음 값으로 돌린다. 테스트가 서로의 검색어를 물려받지 않게 공통 설정에서 부른다. */
export function resetRemembered() {
  for (const reset of resets) {
    reset();
  }
}

/** useState 와 같되, box 가 있으면 마지막 값을 box 에 남기고 다시 그릴 때 거기서 시작한다. */
export function useRememberedState<T>(box: Remembered<T> | undefined, initial: T) {
  const [value, setValue] = useState<T>(() => (box ? box.value : initial));

  useEffect(() => {
    if (box) {
      box.value = value;
    }
  }, [box, value]);

  return [value, setValue] as const;
}
