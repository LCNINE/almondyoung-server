import { act } from '@testing-library/react';

/** Bubble real DOM events through the focused control and its dialog. */
export function scanHid(
  target: HTMLElement,
  code: string,
  enterCode = 'Enter'
) {
  act(() => {
    for (const key of [...code, 'Enter']) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: key === 'Enter' ? enterCode : undefined,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });
}
