/**
 * wallet 아웃박스 디스패처 설정 (ADR-0029 §5-1, Task 6-C-3)
 *
 * 공용 디스패처는 앱마다 기본값이 하나지만, wallet 로컬 디스패처는 자기 기본값과 환경변수
 * 레버를 갖고 있었다. **회수는 재시도 의미론을 바꾸지 않는 것이 원칙**이므로(6-C-2 가 core 에서
 * 백오프 표가 같음을 먼저 확인한 것과 같은 이유) 옮길 수 있는 것은 옮기고, 옮길 수 없는 것은
 * 아래에 이유와 함께 적어 둔다.
 *
 * | 옛 레버 | 새 자리 |
 * |---|---|
 * | `WALLET_OUTBOX_BATCH_SIZE` (100) | `batchSize` |
 * | `WALLET_OUTBOX_MAX_ATTEMPTS` (10) | `maxRetries` |
 * | `WALLET_OUTBOX_PROCESSING_TIMEOUT_SECONDS` (300) | `processingTimeoutMs` |
 * | `WALLET_OUTBOX_DISPATCH_CRON` (`*&#47;5 * * * * *`) | **없다** — 공용 크론이 같은 5초 고정이다 |
 * | `WALLET_OUTBOX_BASE_DELAY_MS` / `MAX_DELAY_MS` | **없다** — 아래 참조 |
 * | `WALLET_OUTBOX_DEAD_LETTER_ENABLED` | **없다** — 아래 참조 |
 *
 * **백오프 표는 바뀐다 — 이것이 이 조각에서 유일하게 바뀌는 재시도 성질이다.**
 * 옛 판본은 지수(5s → 10 → 20 → … → 300 상한), 공용은 고정 표(10/30/60/300, 마지막이 상한).
 * 회차별 대기는 초반이 조금 길고 후반이 같으며, 총 소요는 같은 자릿수다. 표를 wallet 만 다르게
 * 두려면 공용 상수를 설정으로 열어야 하는데, 그러면 "표가 한 벌"이라는 6-C-2 의 결론이
 * 무너진다 — 두 벌이 갈라지는 순간은 조용하다. **소진 임계(10회)는 보존한다** — 결제 이벤트의
 * 포기 시점을 이 조각의 부수효과로 줄이지 않는다.
 *
 * **`DEAD_LETTER` 상태는 공용 테이블에 없다.** 옛 테이블은 최종 실패를 `FAILED` 와
 * `DEAD_LETTER` 로 나눠 적었고 후자에 `dead_lettered_at`/`dead_letter_reason` 이 붙었다.
 * 공용은 `FAILED` 하나이고 `error_message` 에 사유가 남는다. 두 상태를 나눠 쓰는 코드는
 * wallet 에 없었으므로(대시보드도 없다) 구분을 되살리지 않는다 — 진단에 필요한 것은 사유
 * 문자열이고 그건 남는다.
 */

import type { OutboxConfig } from '@app/events';

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 300;

export const WALLET_OUTBOX_CONFIG: OutboxConfig = {
  batchSize: positiveInt(process.env.WALLET_OUTBOX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
  maxRetries: positiveInt(process.env.WALLET_OUTBOX_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
  processingTimeoutMs:
    positiveInt(process.env.WALLET_OUTBOX_PROCESSING_TIMEOUT_SECONDS, DEFAULT_PROCESSING_TIMEOUT_SECONDS) * 1000,

  /**
   * **wallet 만 켠다.** 옛 로컬 디스패처의 acquire 술어에 같은 조건이 있었다 — 같은
   * `partition_key` 의 더 이른 미발행 행이 있으면 뒤 행을 고르지 않는다. 그게 없으면
   * `payment.intent.created` 가 재시도를 도는 동안 `payment.intent.captured` 가 먼저 도착할 수
   * 있고, 파티션 키를 인텐트/구독자로 잡아 둔 이유가 바로 그 순서다.
   */
  strictPartitionOrdering: true,
};
