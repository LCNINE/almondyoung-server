import { useEffect } from 'react';
import { useRegistryApi } from './ActionRegistry';
import { stationKeyOf } from './keys';

/** 열린 확인창이 있으면 그 창이 키를 쓴다(취소 Esc 등) — 셸은 그 뒤의 화면 액션을 돌리지 않는다. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * 창 수준 keydown «캡처 단계» 에서 F1~F12·Esc 를 처리한다(스펙 §5.6) — 입력칸에 포커스가 있어도 기능키는 동작해야 한다.
 * - F1~F12 는 처리 여부와 무관하게 기본 동작을 막는다: WebView2 의 F5 새로고침·F12 개발자 도구·F3 찾기·
 *   F7 캐럿 브라우징·F11 전체 화면. (릴리스 빌드에서 정말 막히는지는 실기 확인 대상 — 스펙 §10.3-1)
 * - Esc 는 화면이 Esc 액션을 선언했을 때만 가져간다 — 아니면 입력칸·확인창의 기존 Esc 처리에 맡긴다.
 * - 수식키가 붙은 조합(Alt+F4 등)은 건드리지 않고, 누르고 있는 자동 반복은 돌리지 않는다.
 */
export function useStationKeyCapture(onRejected: () => void): void {
  const api = useRegistryApi();
  useEffect(() => {
    if (!api) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = stationKeyOf(event);
      if (key === null) return;
      if (key === 'Escape' && (modalOpen() || api.resolveKey('Escape').kind === 'none')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || modalOpen()) return;
      const dispatch = api.resolveKey(key);
      if (dispatch.kind === 'run') dispatch.action.run();
      else if (dispatch.kind === 'disabled') onRejected();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [api, onRejected]);
}
