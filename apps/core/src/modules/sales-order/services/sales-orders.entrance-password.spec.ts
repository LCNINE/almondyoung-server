import { resolveEntrancePasswordUpdate } from './entrance-password.rules';

describe('resolveEntrancePasswordUpdate', () => {
  it('이벤트에 비번이 있으면 저장한다', () => {
    expect(resolveEntrancePasswordUpdate({ incoming: '#1234', existing: null })).toEqual({
      shouldWrite: true,
      value: '#1234',
    });
  });

  it('리플레이로 비번이 빠져 들어와도 기존 값을 지우지 않는다', () => {
    expect(resolveEntrancePasswordUpdate({ incoming: undefined, existing: '#1234' })).toEqual({
      shouldWrite: false,
    });
  });

  it('둘 다 없으면 아무것도 쓰지 않는다', () => {
    expect(resolveEntrancePasswordUpdate({ incoming: undefined, existing: null })).toEqual({
      shouldWrite: false,
    });
  });

  it('새 값이 오면 기존 값을 덮어쓴다 — 고객이 중간에 바꾼 경우', () => {
    expect(resolveEntrancePasswordUpdate({ incoming: '#5678', existing: '#1234' })).toEqual({
      shouldWrite: true,
      value: '#5678',
    });
  });
});
