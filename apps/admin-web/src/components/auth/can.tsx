'use client';

import type { Permission } from '@permission-catalog';
import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import { showTrigger } from '@/lib/auth/permission-check';
import { useCan, useCanOpen, useCanRun } from '@/hooks/use-permission';

type CanProps =
  | { anyOf: readonly Permission[]; run?: never; fallback?: React.ReactNode; children: React.ReactNode }
  | { run: PermissionedAction | readonly PermissionedAction[]; anyOf?: never; fallback?: React.ReactNode; children: React.ReactNode };

const isActionList = (run: PermissionedAction | readonly PermissionedAction[]): run is readonly PermissionedAction[] => Array.isArray(run);

/**
 * `anyOf` — 권한이 확인됐을 때만 보인다(읽기 섹션 등). 확인 중·확인 실패엔 `fallback`(기본 없음) — 거부 문구를 띄우지 않는다.
 * `run` — 쓰기 트리거. 동작(뮤테이션 훅)이 선언한 권한이 «확인돼서» 있을 때만 보인다. 조회 실패는 셸 배너가 알린다.
 */
export function Can(props: CanProps) {
  if (props.run !== undefined) {
    return (
      <CanRun run={isActionList(props.run) ? props.run : [props.run]} fallback={props.fallback ?? null}>
        {props.children}
      </CanRun>
    );
  }
  return (
    <CanAny anyOf={props.anyOf} fallback={props.fallback ?? null}>
      {props.children}
    </CanAny>
  );
}

function CanAny({ anyOf, fallback, children }: { anyOf: readonly Permission[]; fallback: React.ReactNode; children: React.ReactNode }) {
  const can = useCan(anyOf);
  return <>{can.status === 'ready' && can.allowed ? children : fallback}</>;
}

function CanRun({ run, fallback, children }: { run: readonly PermissionedAction[]; fallback: React.ReactNode; children: React.ReactNode }) {
  const state = useCanRun(...run);
  return <>{showTrigger(state) ? children : fallback}</>;
}

/** 다른 화면으로 가는 링크·버튼. 그 화면이 들여보내 줄 때만 보인다(화면 진입 권한표가 정본). */
export function CanOpen({ screen, fallback = null, children }: { screen: string; fallback?: React.ReactNode; children: React.ReactNode }) {
  const state = useCanOpen(screen);
  return <>{showTrigger(state) ? children : fallback}</>;
}
