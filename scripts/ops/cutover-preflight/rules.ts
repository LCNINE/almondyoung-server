// DB·파일을 읽지 않는 판정 규칙. 여기만 유닛 테스트한다(rules.spec.ts).
import { PERMISSION_CATALOG } from '../../../libs/authorization/src/permissions/permission-catalog';
import { readShelfCode } from '../../../apps/core/src/modules/inventory/core/shelf-code-reading';

/** 카탈로그가 «첫 등록 때» 그 역할에 주게 적어 둔 권한 키. 라이브 부여의 기대값이다. */
export function catalogGrantsFor(role: string): string[] {
  return PERMISSION_CATALOG.filter((p) => (p.grantOnFirstRegistration as readonly string[]).includes(role))
    .map((p) => p.key)
    .sort();
}

/** 기대 권한 중 라이브에 없는 것. */
export function missingGrants(expected: readonly string[], granted: readonly string[]): string[] {
  const have = new Set(granted);
  return expected.filter((key) => !have.has(key));
}

/** 자리표시 값인가 — 없음·빈 값·'1'·dummy 포함. 정의는 여기 한 곳이다. */
export function isPlaceholderValue(value: string | undefined): boolean {
  return value === undefined || value === '' || value === '1' || value.includes('dummy');
}

/** IaC 파일에서 `KEY: '1'` 같은 자리표시 값을 찾는다. */
export function isPlaceholderEnv(iacText: string, key: string): boolean {
  const quoted = new RegExp(`${key}:\\s*'([^']*)'`).exec(iacText);
  return quoted !== null && isPlaceholderValue(quoted[1]);
}

/**
 * sst shell 이 링크한 Secret 의 값. `SST_RESOURCE_<name>` 가 없으면 null(shell 밖이라 못 잰다).
 * 값 JSON 의 `value` 필드를 읽는다 — SST_RESOURCE_Db 사용례에서 추정한 모양이고 라이브 실측 전이다.
 */
export function linkedSecretValue(name: string, env: NodeJS.ProcessEnv = process.env): string | null | undefined {
  const raw = env[`SST_RESOURCE_${name}`];
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'object' && parsed !== null && 'value' in parsed && typeof parsed.value === 'string')
    return parsed.value;
  return undefined;
}

/**
 * channel-capabilities.ts 에서 채널 블록의 `inventory` 축이 manual 인가.
 * 블록 경계는 «`  <채널>: {` 부터 다음 최상위 채널 키까지»로 잡는다 — 파일 모양이 바뀌면 이 함수도 바꾼다.
 */
export function channelInventoryIsManual(capabilitiesText: string, channel: string): boolean {
  const start = capabilitiesText.indexOf(`\n  ${channel}: {`);
  if (start < 0) return false;
  const rest = capabilitiesText.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}['a-z0-9]+['"]?: \{/);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  return /inventory:\s*\{\s*kind:\s*'manual'/.test(block);
}

/** adapter.module.ts 의 주문 수집 source 배열에 그 클래스가 배선돼 있나. */
export function orderSourceWired(adapterModuleText: string, sourceClass: string): boolean {
  return new RegExp(`createOrderProvider\\(\\s*\\w+\\s*,\\s*translator\\s*\\)`).test(adapterModuleText)
    ? new RegExp(`inject:\\s*\\[[^\\]]*\\b${sourceClass}\\b`).test(adapterModuleText)
    : false;
}

/**
 * 선반 위치 텍스트가 로케이션으로 이어지나 (#1235). 로케이션 만들기 스크립트와 같은 고쳐 읽기(readShelfCode)를 쓴다 —
 * 원문을 그대로 비교하면 CC-4-1 같은 텍스트가 CC-04-01 로케이션이 생겨도 영원히 «없음»이다.
 * 꼴에 안 맞는 텍스트(exception)는 사람이 정할 몫이라 «없음»과 따로 센다.
 */
export function shelfCodeLinks(
  shelfCodes: readonly string[],
  locationCodes: readonly string[],
): { linked: number; unlinked: string[]; exceptions: string[] } {
  const have = new Set(locationCodes);
  const out = { linked: 0, unlinked: [] as string[], exceptions: [] as string[] };
  for (const raw of shelfCodes) {
    const reading = readShelfCode(raw);
    if (reading.kind === 'exception') out.exceptions.push(raw);
    else if (have.has(reading.code)) out.linked += 1;
    else out.unlinked.push(raw);
  }
  return out;
}

// ── Medusa 예약 투영 축 (#1247) ─────────────────────────────────────────────────────────────

/** 마지막으로 끝까지 돈(applied·halted) 대사 회차가 이보다 오래전이면 크론(매일 04:30 KST)이 멎었거나 매번 건너뛴다. */
export const RECONCILE_STALE_HOURS = 26;

export type AxisFinding = { level: 'ok' | 'bad' | 'info'; msg: string; fix?: string };

export interface ReservationAxisInput {
  phase: 'before' | 'after';
  /** channel_adapter.reservation_projection_settings.cutover_at */
  cutoverAt: Date | null;
  openHalted: number;
  /** 마지막으로 끝까지 돈(applied·halted) 회차의 finished_at — skipped 는 «돌았다»가 아니다. 없으면 null. */
  lastFinishedAt: Date | null;
  /** 마지막 회차가 아직 도는 중이면 true — 오래된 finished_at 으로 세지 않는다. */
  lastRunning: boolean;
  now: Date;
  /** T 이후 주문 중 «Medusa 예약 ≠ 목표» 로 센 줄 수. */
  mismatches: number;
}

/** 투영 축의 판정. DB 를 읽지 않는다 — 입력은 호출자가 모아 온다. */
export function reservationAxisFindings(i: ReservationAxisInput): AxisFinding[] {
  const out: AxisFinding[] = [];
  if (!i.cutoverAt) {
    if (i.phase === 'after')
      out.push({
        level: 'bad',
        msg: '--after-cutover 인데 예약 투영 전환 시각 T 가 비어 있다 — 투영이 아무 것도 쓰지 않는다',
        fix: 'set-reservation-cutover --at T --apply (#1247)',
      });
    else out.push({ level: 'info', msg: '예약 투영 T 가 비어 있다 — 투영은 쉬는 중(컷오버 전 정상)' });
    return out;
  }
  out.push({ level: 'info', msg: `예약 투영 T = ${i.cutoverAt.toISOString()}` });
  if (i.openHalted > 0)
    out.push({
      level: 'bad',
      msg: `열린 멈춘(halted) 대사 회차 ${i.openHalted}건`,
      fix: '/order/channel-mismatches 의 Medusa 예약 대사 멈춤 섹션에서 확인하고 고치기 또는 사유 종결 (#1247)',
    });
  else out.push({ level: 'ok', msg: '열린 멈춘 대사 회차 0' });

  if (!i.lastFinishedAt && !i.lastRunning)
    out.push({
      level: 'bad',
      msg: '대사 회차가 한 번도 끝까지 돌지 않았다(applied·halted 0 — skipped 만 있거나 없음)',
      fix: 'channel-adapter 대사 크론·로그와 회차의 error 확인 (#1247)',
    });
  else if (i.lastFinishedAt) {
    const hours = (i.now.getTime() - i.lastFinishedAt.getTime()) / 3_600_000;
    if (hours > RECONCILE_STALE_HOURS)
      out.push({
        level: 'bad',
        msg: `마지막으로 끝까지 돈 대사 회차가 ${hours.toFixed(1)}시간 전이다 (기준 ${RECONCILE_STALE_HOURS}시간) — 크론이 멎었거나 매번 건너뛴다`,
        fix: 'channel-adapter 대사 크론·로그와 skipped 회차의 error 확인 — 화면에는 강제 재실행이 없다(«확인했으니 고치기»는 멈춘 회차에만) (#1247)',
      });
    else out.push({ level: 'ok', msg: `마지막으로 끝까지 돈 대사 회차 ${hours.toFixed(1)}시간 전 종료` });
  }

  if (i.mismatches > 0)
    out.push({
      level: 'bad',
      msg: `T 이후 주문의 «Medusa 예약 ≠ 목표» ${i.mismatches}줄`,
      fix: '다음 대사(매일 04:30 KST)가 고친다 — 한도를 넘어 멈추면 /order/channel-mismatches 의 멈춘 회차에서 «확인했으니 고치기» (#1247)',
    });
  else out.push({ level: 'ok', msg: 'T 이후 주문의 Medusa 예약 ≠ 목표 0' });
  return out;
}

export interface RecountLine {
  lineItemId: string;
  ordered: number;
  canceledBeforeShipment: number;
  /** 구성 SKU 의 출고·예약이 아직 하나도 없는 줄만 recount 에 들어오므로 heldUnits 는 0 이다. */
  current: number;
}

/**
 * 목표를 앱과 같은 함수로 다시 세어 현재 예약과 다른 줄. `target` 은 주입한다(= reservationTarget) —
 * 공식을 이 파일에 복사하지 않는다.
 */
export function reservationMismatches(
  lines: readonly RecountLine[],
  target: (line: { demand: number; heldUnits: number }) => number,
): RecountLine[] {
  return lines.filter(
    (l) => target({ demand: l.ordered - l.canceledBeforeShipment, heldUnits: 0 }) !== l.current,
  );
}
