/**
 * 셀메이트 선반 위치 텍스트(sku_shelf_positions.position_code) → 로케이션 코드 고쳐 읽기.
 * 로케이션 만들기 스크립트·컷오버 판정·#1236(SKU 를 칸에 잇기)이 같은 답을 내도록 한 곳에 둔다.
 *
 * 별칭을 두지 않는다 — 작업자가 스캔하는 건 언제나 자석 값이라, 어긋난 텍스트는 바른 코드로 «고쳐 읽기»만 한다.
 * 입력은 normalizePositionCode(공백 제거·대문자) 를 거친 값이다.
 *
 * scripts/ 의 tsx 가 이 파일을 직접 import 하므로 import 없는 파일(location-code)만 상대 경로로 쓴다.
 */
import { rackBinLocationCode } from './location-code';

type Located = { code: string; column: string; rackNumber: number; bin: string };

export type ShelfCodeReading =
  | ({ kind: 'exact' } & Located)
  | ({ kind: 'fixed'; rule: 'zero-pad' | 'dash-position' } & Located)
  | ({ kind: 'custom-bin' } & Located)
  | { kind: 'exception'; raw: string };

const EXACT = /^([A-Z]{1,2})-(\d{2})-(\d{2,3})$/;
// CC-4-1 → CC-04-01. 이미 바른 꼴은 EXACT 가 먼저 잡는다.
const ZERO_PAD = /^([A-Z]{1,2})-(\d{1,2})-(\d{1,2})$/;
// O21-30- → O-21-30. 대시를 한 칸 늦게 친 꼴로 본다(고친 코드가 칸 많은 기존 랙에 들어간다 — 적용 전 현장 확인).
const DASH_POSITION = /^([A-Z]{1,2})(\d{2})-(\d{2,3})-$/;
const CUSTOM_BIN = /^([A-Z]{1,2})-(\d{2})-([가-힣]+)$/;

function located(column: string, rack: string, bin: string): Located {
  const rackNumber = Number.parseInt(rack, 10);
  return { code: rackBinLocationCode(column, rackNumber, bin), column, rackNumber, bin };
}

export function readShelfCode(normalized: string): ShelfCodeReading {
  let m = EXACT.exec(normalized);
  if (m) return { kind: 'exact', ...located(m[1], m[2], m[3]) };

  m = ZERO_PAD.exec(normalized);
  if (m) return { kind: 'fixed', rule: 'zero-pad', ...located(m[1], m[2], m[3].padStart(2, '0')) };

  m = DASH_POSITION.exec(normalized);
  if (m) return { kind: 'fixed', rule: 'dash-position', ...located(m[1], m[2], m[3]) };

  m = CUSTOM_BIN.exec(normalized);
  if (m) return { kind: 'custom-bin', ...located(m[1], m[2], m[3]) };

  return { kind: 'exception', raw: normalized };
}
