import { STATION_KEYS, type StationKey } from './keys';

/**
 * 화면이 한 번 선언하는 작업 액션(스펙 §5.2). 기능키 처리·기능키 바·명령 바코드·명령 시트가 모두 이 선언에서 파생된다.
 * 명령 바코드는 키에서 파생한다(`commandCodeOfKey`) — 바코드 = 그 키를 누른 것.
 */
export interface ActionSpec {
  id: string;
  key: StationKey;
  label: string;
}

export interface StationAction extends ActionSpec {
  enabled: boolean;
  run: () => void;
}

export type KeyDispatch =
  | { kind: 'run'; action: StationAction }
  | { kind: 'disabled'; action: StationAction }
  | { kind: 'none' };

/** 한 층 안에서 같은 키를 두 번 선언하면 어느 쪽이 도는지가 배열 순서에 달린다 — 선언 실수로 본다. */
export function assertUniqueKeys(actions: readonly ActionSpec[]): void {
  const seen = new Map<StationKey, string>();
  for (const action of actions) {
    const other = seen.get(action.key);
    if (other !== undefined) throw new Error(`같은 키 ${action.key} 를 두 액션(${other}, ${action.id})이 선언했다`);
    seen.set(action.key, action.id);
  }
}

/**
 * 층은 바깥(셸) → 안쪽(화면) 순서다. 같은 키면 안쪽이 이긴다 — 꺼져 있어도 이긴다:
 * 화면이 «지금은 안 된다» 고 한 키가 셸의 다른 동작으로 새면 안 된다.
 */
export function resolveActions(layers: readonly (readonly StationAction[])[]): Map<StationKey, StationAction> {
  const resolved = new Map<StationKey, StationAction>();
  for (const layer of layers) for (const action of layer) resolved.set(action.key, action);
  return resolved;
}

export function dispatchKey(resolved: ReadonlyMap<StationKey, StationAction>, key: StationKey): KeyDispatch {
  const action = resolved.get(key);
  if (!action) return { kind: 'none' };
  return action.enabled ? { kind: 'run', action } : { kind: 'disabled', action };
}

/**
 * 기능키 바: 켜진 것만(U2 — 지금 안 되는 것·권한 없는 것은 그리지 않는다), 키 순서(F1…F12, Esc 는 맨 끝).
 * `omit` 은 다른 곳에 이미 그려진 키다 — 탭 바의 F1~F6 을 바에 또 그리지 않는다.
 */
export function functionBarItems(
  resolved: ReadonlyMap<StationKey, StationAction>,
  omit: ReadonlySet<StationKey>
): StationAction[] {
  return STATION_KEYS.flatMap((key) => {
    const action = resolved.get(key);
    return action && action.enabled && !omit.has(key) ? [action] : [];
  });
}

/** 등록을 다시 알릴지 판단하는 서명 — `run` 은 렌더마다 새 함수라 빼고, 그리는 데 쓰는 값만 본다. */
export function actionsSignature(actions: readonly StationAction[]): string {
  return actions.map((a) => [a.id, a.key, a.label, a.enabled ? '1' : '0'].join('\u0000')).join('\u0001');
}
