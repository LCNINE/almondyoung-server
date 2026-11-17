/**
 * 컷오버 재고 이동(#1236) — SKU 하나의 입고기본존 재고를 셀메이트 위치 선반으로 옮길지 정하는 순수 함수.
 * 이동 스크립트(scripts/sellmate/move-stock-to-shelf.ts)와 컷오버 판정 스크립트가 같은 답을 내도록 한 곳에 둔다.
 *
 * «위치가 하나»는 DB 텍스트로만 판정한다(설계 §4 A, 2026-11-17 결정). 한 칸에 여럿 적힌 텍스트는 readShelfCode 가
 * exception 으로 돌려 자연히 남는다. 고쳐 읽은 코드(fixed·custom-bin)는 현장 확인 전이라 규칙별 스위치로만 켠다.
 *
 * scripts/ 의 tsx 가 이 파일을 직접 import 하므로 import 없는 파일(shelf-code-reading)만 상대 경로로 쓴다.
 */
import { readShelfCode } from './shelf-code-reading';

export type ShelfMoveRule = 'zero-pad' | 'dash-position' | 'custom-bin';
export const SHELF_MOVE_RULES: readonly ShelfMoveRule[] = ['zero-pad', 'dash-position', 'custom-bin'];

export type ShelfKeepReason = 'no-position' | 'stale' | 'unreadable' | 'unconfirmed' | 'no-location' | 'elsewhere';

export type ShelfMoveInput = {
  position: { code: string; updatedAt: Date } | null;
  /** 이보다 앞서 쓰인 위치 행은 T 당일 적재가 다시 쓰지 않은 것이다. null 이면 보지 않는다(판정 스크립트) */
  freshSince: Date | null;
  /** 그 창고의 활성 standard 비시스템 로케이션 코드 */
  locationCodes: ReadonlySet<string>;
  /** 이 SKU 가 이미 ON_HAND > 0 인 standard 로케이션 코드 */
  shelvesWithStock: readonly string[];
  includeRules: ReadonlySet<ShelfMoveRule>;
};

export type ShelfMoveVerdict =
  | { kind: 'move'; toCode: string; rule: 'exact' | ShelfMoveRule }
  | { kind: 'keep'; reason: ShelfKeepReason };

const keep = (reason: ShelfKeepReason): ShelfMoveVerdict => ({ kind: 'keep', reason });

export function judgeShelfMove(input: ShelfMoveInput): ShelfMoveVerdict {
  const { position } = input;
  if (!position) return keep('no-position');
  if (input.freshSince && position.updatedAt < input.freshSince) return keep('stale');

  const reading = readShelfCode(position.code);
  if (reading.kind === 'exception') return keep('unreadable');
  const rule: 'exact' | ShelfMoveRule =
    reading.kind === 'exact' ? 'exact' : reading.kind === 'fixed' ? reading.rule : 'custom-bin';
  if (rule !== 'exact' && !input.includeRules.has(rule)) return keep('unconfirmed');

  if (!input.locationCodes.has(reading.code)) return keep('no-location');
  // 다른 선반에 이미 재고가 있으면 옮겼을 때 한 SKU 가 선반 두 곳에 나뉜다 — 실사로 넘긴다.
  if (input.shelvesWithStock.some((code) => code !== reading.code)) return keep('elsewhere');
  return { kind: 'move', toCode: reading.code, rule };
}
