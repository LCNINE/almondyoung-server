/**
 * @jest-environment jsdom
 */
import { act, render } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from './sonner';

function mockColorScheme(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

describe('Toaster', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('테마 공급자가 없으면 운영체제가 다크 모드여도 밝은 토스트를 그린다', async () => {
    mockColorScheme(true);
    const { container } = render(<Toaster />);

    await act(async () => {
      toast('저장했어요');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const list = container.ownerDocument.querySelector('[data-sonner-toaster]');
    expect(list?.getAttribute('data-sonner-theme')).toBe('light');
  });
});
