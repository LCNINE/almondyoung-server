/**
 * 권한 때문에 읽기 전용인 폼 안의 비텍스트 컨트롤(체크박스·스위치·라디오·셀렉트). 네이티브 `disabled` 는 탭 순서에서
 * 빠져 키보드·스크린리더가 값과 이유에 닿지 못한다 — 그래서 `aria-disabled` 로 포커스를 남기고, 폼 위 «보기 전용»
 * 안내를 `aria-describedby` 로 잇고, 값 변경은 이벤트에서 막는다. 원래 `disabled` 인 컨트롤은 그대로 둔다.
 */
export interface ReadOnlyControl {
  readonly disabled: boolean;
  readonly 'aria-disabled'?: true;
  readonly 'aria-describedby'?: string;
  /** true 면 값 변경 이벤트를 막는다. */
  readonly blocked: boolean;
}

export function readOnlyControl({
  readOnly,
  disabled,
  noteId,
}: {
  readOnly: boolean;
  disabled?: boolean;
  noteId?: string;
}): ReadOnlyControl {
  if (disabled === true) return { disabled: true, blocked: false };
  if (!readOnly) return { disabled: false, blocked: false };
  return { disabled: false, 'aria-disabled': true, ...(noteId ? { 'aria-describedby': noteId } : {}), blocked: true };
}

/** 읽기 전용이면 기본 동작(값 바꾸기)을 막고, 아니면 원래 핸들러를 부른다. */
export function blockWhileReadOnly<E extends { preventDefault(): void }>(
  blocked: boolean,
  own?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    own?.(event);
  };
}

/**
 * 읽기 전용이면 키 입력으로 값이 바뀌지 않게 막는다(셀렉트 트리거는 닫혀 있어도 글자 키로 항목을 고른다). Tab 은
 * 포커스를 옮기는 키라 막지 않는다.
 */
export function blockKeysWhileReadOnly<E extends { key: string; preventDefault(): void }>(
  blocked: boolean,
  own?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (blocked && event.key !== 'Tab') {
      event.preventDefault();
      return;
    }
    own?.(event);
  };
}
