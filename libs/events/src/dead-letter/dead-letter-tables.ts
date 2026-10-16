import { sql } from 'drizzle-orm';
import type { DbService } from '@app/db';

/** 이 두 테이블을 만드는 마이그 이름 — 로그·오류가 사람에게 «무엇을 돌리라»고 말할 때 쓴다 */
export const DEAD_LETTER_MIGRATION_NAME = 'add-event-dead-letters';

/**
 * `event.dead_letters`·`event.failure_actions` 가 있는지 (#1016 8번).
 *
 * 마이그 없이 배포되면(이 저장소에서 실제로 있었다 — 10-10 두 시간 장애) 보류 검사가 매 메시지 던지고 →
 * `DlqDeliveryError` → 커밋되지 않음 → 모든 파티션이 멈춘다. 그래서 `startConsumer` 가 한 번 묻고, 없으면 실패 테이블
 * 모드를 켜지 않는다(옛 `.dlq` 경로). 질의 자체가 실패해도 «없다»로 본다 — 모를 때 소비를 멈추는 쪽보다 옛 경로가 안전하다.
 */
export async function checkDeadLetterTables(dbService: DbService): Promise<{ present: boolean; queryError?: string }> {
  try {
    const rows = await dbService.db.execute<{ present: boolean }>(
      sql`select to_regclass('event.dead_letters') is not null and to_regclass('event.failure_actions') is not null as present`,
    );
    return { present: rows[0]?.present === true };
  } catch (error) {
    return { present: false, queryError: error instanceof Error ? error.message : String(error) };
  }
}
