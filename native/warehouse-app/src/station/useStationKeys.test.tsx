import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionRegistryProvider, useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import { useStationKeyCapture } from './useStationKeys';

function Layer({ actions }: { actions: readonly StationAction[] }) {
  useStationActions(actions);
  return <input aria-label="입력" />;
}

function Harness({ actions, onRejected }: { actions: readonly StationAction[]; onRejected: () => void }) {
  useStationKeyCapture(onRejected);
  return <Layer actions={actions} />;
}

function setup(actions: readonly StationAction[], extra?: React.ReactNode) {
  const onRejected = vi.fn();
  render(
    <ActionRegistryProvider>
      <Harness actions={actions} onRejected={onRejected} />
      {extra}
    </ActionRegistryProvider>
  );
  return { onRejected, input: screen.getByLabelText('입력') };
}

const make = (key: StationAction['key'], enabled = true) => {
  const run = vi.fn();
  const action: StationAction = { id: `a-${key}`, key, label: key, enabled, run };
  return { action, run };
};

describe('useStationKeyCapture', () => {
  it('입력칸에 포커스가 있어도 기능키가 액션을 돌리고 기본 동작을 막는다', () => {
    const f7 = make('F7');
    const { input } = setup([f7.action]);
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'F7' })).toBe(false);
    expect(f7.run).toHaveBeenCalledTimes(1);
  });

  it('액션이 없는 F5 도 막는다(웹뷰 새로고침) — 아무것도 돌리지 않고 오류도 아니다', () => {
    const { onRejected } = setup([]);
    expect(fireEvent.keyDown(window, { key: 'F5' })).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('꺼진 액션의 키는 돌리지 않고 거절을 알린다', () => {
    const f9 = make('F9', false);
    const { onRejected } = setup([f9.action]);
    fireEvent.keyDown(window, { key: 'F9' });
    expect(f9.run).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['F4', { altKey: true }],
    ['F5', { ctrlKey: true }],
    ['F10', { shiftKey: true }],
  ] as const)('%s + 수식키 %o 는 건드리지 않는다(Alt+F4 로 창이 닫혀야 한다)', (key, mods) => {
    const target = make(key);
    setup([target.action]);
    expect(fireEvent.keyDown(window, { key, ...mods })).toBe(true);
    expect(target.run).not.toHaveBeenCalled();
  });

  it('누르고 있는 자동 반복은 한 번만 돌린다(반복 이벤트도 기본 동작은 막는다)', () => {
    const f7 = make('F7');
    setup([f7.action]);
    fireEvent.keyDown(window, { key: 'F7' });
    expect(fireEvent.keyDown(window, { key: 'F7', repeat: true })).toBe(false);
    expect(f7.run).toHaveBeenCalledTimes(1);
  });

  it('화면이 Esc 를 선언하지 않았으면 Esc 를 가져가지 않는다(입력칸·확인창의 기존 처리)', () => {
    setup([]);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
  });

  it('화면이 Esc 를 선언했으면 가져가 돌린다', () => {
    const esc = make('Escape');
    setup([esc.action]);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(esc.run).toHaveBeenCalledTimes(1);
  });

  it('확인창이 열려 있으면 Esc 는 확인창 몫, 기능키는 막기만 하고 돌리지 않는다', () => {
    const esc = make('Escape');
    const f10 = make('F10');
    setup([esc.action, f10.action], <div role="dialog" aria-modal="true" />);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
    expect(esc.run).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(window, { key: 'F10' })).toBe(false);
    expect(f10.run).not.toHaveBeenCalled();
  });

  it('셸 밖(Provider 없음)에서는 useStationActions 가 아무 일도 하지 않는다 — 핸드헬드 공유 화면', () => {
    const f7 = make('F7');
    render(<Layer actions={[f7.action]} />);
    expect(fireEvent.keyDown(window, { key: 'F7' })).toBe(true);
    expect(f7.run).not.toHaveBeenCalled();
  });
});
