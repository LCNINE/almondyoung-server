import { describe, expect, it, vi } from 'vitest';
import {
  actionsSignature,
  assertUniqueKeys,
  dispatchKey,
  functionBarItems,
  resolveActions,
  type StationAction,
} from './actions';
import type { StationKey } from './keys';

const action = (id: string, key: StationKey, enabled = true): StationAction => ({
  id,
  key,
  label: id,
  enabled,
  run: vi.fn(),
});

describe('resolveActions', () => {
  it('같은 키면 안쪽 층(뒤)이 이긴다', () => {
    const resolved = resolveActions([[action('shell-f7', 'F7')], [action('screen-f7', 'F7')]]);
    expect(resolved.get('F7')?.id).toBe('screen-f7');
  });

  it('안쪽이 꺼져 있어도 이긴다 — 화면이 «지금은 안 된다» 고 한 키가 셸 동작으로 새지 않는다', () => {
    const resolved = resolveActions([[action('shell-f7', 'F7')], [action('screen-f7', 'F7', false)]]);
    expect(dispatchKey(resolved, 'F7')).toMatchObject({ kind: 'disabled', action: { id: 'screen-f7' } });
  });
});

describe('dispatchKey', () => {
  const resolved = resolveActions([[action('on', 'F7'), action('off', 'F8', false)]]);
  it.each([
    ['F7', 'run'],
    ['F8', 'disabled'],
    ['F9', 'none'],
  ] as const)('%s → %s', (key, kind) => {
    expect(dispatchKey(resolved, key).kind).toBe(kind);
  });
});

describe('functionBarItems', () => {
  it('켜진 것만, 키 순서대로, Esc 는 맨 끝, omit 한 키(탭)는 빼고', () => {
    const resolved = resolveActions([
      [action('tab-F1', 'F1')],
      [action('esc', 'Escape'), action('f12', 'F12'), action('f7', 'F7'), action('f9', 'F9', false)],
    ]);
    expect(functionBarItems(resolved, new Set<StationKey>(['F1'])).map((a) => a.id)).toEqual(['f7', 'f12', 'esc']);
  });
});

describe('assertUniqueKeys', () => {
  it('한 층에서 같은 키를 두 번 선언하면 던진다', () => {
    expect(() => assertUniqueKeys([action('a', 'F7'), action('b', 'F7')])).toThrow(/F7/);
  });
  it('다른 키면 통과', () => {
    expect(() => assertUniqueKeys([action('a', 'F7'), action('b', 'F8')])).not.toThrow();
  });
});

describe('actionsSignature', () => {
  it('run 만 바뀌면 같고, label·enabled 가 바뀌면 다르다', () => {
    const base = action('a', 'F7');
    expect(actionsSignature([base])).toBe(actionsSignature([{ ...base, run: () => {} }]));
    expect(actionsSignature([base])).not.toBe(actionsSignature([{ ...base, enabled: false }]));
    expect(actionsSignature([base])).not.toBe(actionsSignature([{ ...base, label: '다른 것' }]));
  });
});
