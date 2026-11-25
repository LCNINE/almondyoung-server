import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveToast, useSaveToast } from './SaveToast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SaveToast', () => {
  it('메시지가 없으면 아무것도 그리지 않는다', () => {
    render(<SaveToast message={null} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('보였다가 2초 뒤 사라진다', () => {
    const { result } = renderHook(() => useSaveToast());
    act(() => result.current.show('입고를 저장했어요'));
    expect(result.current.message).toBe('입고를 저장했어요');

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.message).not.toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBeNull();
  });

  it('다시 보이면 타이머가 새로 시작된다', () => {
    const { result } = renderHook(() => useSaveToast());
    act(() => result.current.show('첫째'));
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.show('둘째'));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.message).toBe('둘째');

    act(() => vi.advanceTimersByTime(499));
    expect(result.current.message).toBe('둘째');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBeNull();
  });

  it('언마운트하면 타이머를 정리한다', () => {
    const { result, unmount } = renderHook(() => useSaveToast());
    act(() => result.current.show('x'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('role=status 로 메시지를 그린다', () => {
    render(<SaveToast message="입고를 저장했어요" />);
    expect(screen.getByRole('status').textContent).toBe('입고를 저장했어요');
  });
});
