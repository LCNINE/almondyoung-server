'use client';

import type { Permission } from '@permission-catalog';
import { useCan } from '@/hooks/use-permission';
import { permissionLabel } from '@/lib/auth/permission-labels';

export interface ReadGate {
  /** 조회를 보내도 되는가 — 권한을 확인했고 있을 때만 */
  readonly enabled: boolean;
  /** 권한을 아직 확인하는 중 */
  readonly pending: boolean;
  /** 권한을 확인하지 못함 — 값을 못 얻은 것과 같게 그린다 */
  readonly failed: boolean;
  /** 권한이 없어 가린 이유(«가림» 옆 안내). 권한이 있거나 확인 전이면 null */
  readonly hiddenReason: string | null;
}

/**
 * 메인은 진입 권한(통계 조회)과 다른 권한의 조회를 함께 그린다. 권한이 없는 조회는 보내지 않고 «가림»으로 그린다
 * (ADR-0048 §22) — 보내면 403 이 나고, 403 마다 권한을 다시 받아 온다.
 */
export function useReadGate(anyOf: readonly Permission[]): ReadGate {
  const can = useCan(anyOf);
  const ready = can.status === 'ready';
  return {
    enabled: ready && can.allowed,
    pending: can.status === 'loading',
    failed: can.status === 'error',
    hiddenReason: ready && !can.allowed ? `${permissionLabel(anyOf[0])} 권한이 있어야 보입니다` : null,
  };
}
