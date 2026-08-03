import { formatInTimeZone } from 'date-fns-tz';

/**
 * 집계 일자 버킷의 기준 타임존.
 *
 * 레포 관례는 `Asia/Seoul` 이다 — core 의
 * `apps/core/src/modules/inventory/shared/services/time.util.ts` 가 같은 상수(`SEOUL_TZ`)로
 * 영업일 로직을 돌린다. 그 파일을 그대로 import 하지 않는 이유는 둘이다:
 * (1) app 경계를 넘는 import 라 nest 빌드 그래프가 core 를 analytics 번들로 끌고 온다
 *     (`@app/*` 처럼 tsconfig path 로 노출된 공유 지점이 아니다).
 * (2) 그 모듈은 `Date → 'YYYY-MM-DD'` 를 내주는 함수를 노출하지 않는다 (`toSeoulTime`/
 *     `isSameSeoulDay`/`nowSeoul` 뿐).
 * 그래서 오프셋을 손으로 더하는 대신 **같은 라이브러리(`date-fns-tz`)와 같은 타임존 상수**를
 * 쓴다. 손으로 더한 +9h 는 IANA DB 가 관리하는 역사적 오프셋(한국은 과거 DST 시행 이력이 있다)을
 * 무시하므로 채택하지 않는다.
 */
export const SEOUL_TZ = 'Asia/Seoul';

/**
 * 타임스탬프를 KST 기준 `YYYY-MM-DD` 집계 키로 변환한다.
 *
 * **UTC 가 아니라 KST 인 것이 핵심이다.** `toISOString().slice(0, 10)` 은 UTC+9 에서
 * 00:00–09:00 KST 에 들어온 주문을 전부 전날 버킷에 넣는다 — 한국 시장에서 이 구간은
 * 무시할 수 있는 꼬리가 아니라 하루 매출의 실질적인 부분이고, 일별 그래프가 매일 아침
 * 9시간치를 어제로 흘려보내게 된다.
 *
 * 모든 `agg_*_daily.aggDate` 는 이 함수를 통해서만 만들어져야 한다. 백필(계획 2)도
 * 같은 함수를 써야 실시간 구간과 백필 구간의 경계에서 하루가 어긋나지 않는다.
 */
export function toSeoulDateOnly(value: Date): string {
  return formatInTimeZone(value, SEOUL_TZ, 'yyyy-MM-dd');
}
