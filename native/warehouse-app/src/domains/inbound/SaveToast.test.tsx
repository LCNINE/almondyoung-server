import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboundToastDetail, SaveToast, useSaveToast, type InboundToast } from './SaveToast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const saved: InboundToast = { kind: 'saved', detail: '면봉 12개' };
const cancelled: InboundToast = { kind: 'cancelled', detail: '면봉 12개' };

describe('SaveToast', () => {
  it('알림이 없으면 아무것도 그리지 않는다', () => {
    render(<SaveToast toast={null} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('저장은 초록 「입고 완료」, 취소는 진한 회색 「입고 취소」에 무엇을 몇 개인지 붙인다', () => {
    const { rerender } = render(<SaveToast toast={saved} />);
    expect(screen.getByRole('status').textContent).toBe('입고 완료면봉 12개');
    expect(screen.getByRole('status').className).toContain('bg-green-700');

    rerender(<SaveToast toast={cancelled} />);
    expect(screen.getByRole('status').textContent).toBe('입고 취소면봉 12개');
    expect(screen.getByRole('status').className).toContain('bg-gray-800');
  });

  it('보였다가 2초 뒤 사라진다', () => {
    const { result } = renderHook(() => useSaveToast());
    act(() => result.current.show(saved));
    expect(result.current.toast).toEqual(saved);

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.toast).not.toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it('다시 보이면 타이머가 새로 시작된다', () => {
    const { result } = renderHook(() => useSaveToast());
    act(() => result.current.show(saved));
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.show(cancelled));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.toast).toEqual(cancelled);

    act(() => vi.advanceTimersByTime(499));
    expect(result.current.toast).toEqual(cancelled);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it('언마운트하면 타이머를 정리한다', () => {
    const { result, unmount } = renderHook(() => useSaveToast());
    act(() => result.current.show(saved));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('inboundToastDetail', () => {
  it('하나면 이름과 개수, 여럿이면 첫 이름 외 N건', () => {
    expect(inboundToastDetail([{ name: '면봉', quantity: 12 }])).toBe('면봉 12개');
    expect(
      inboundToastDetail([
        { name: '면봉', quantity: 12 },
        { name: '이쑤시개', quantity: 3 },
        { name: '솜', quantity: 1 },
      ])
    ).toBe('면봉 외 2건');
    expect(inboundToastDetail([])).toBe('');
  });
});
