import { sql } from 'drizzle-orm';
import { describeFailedRun, type DbService } from '@app/db';

/** 이 두 테이블을 만드는 마이그 이름 — 로그·오류가 사람에게 «무엇을 돌리라»고 말할 때 쓴다 */
export const DEAD_LETTER_MIGRATION_NAME = 'add-event-dead-letters';

/**
 * `event.dead_letters`·`event.failure_actions` 가 있는지 (#1016 8번).
 *
 * 마이그 없이 배포되면(이 저장소에서 실제로 있었다 — 10-10 두 시간 장애) 보류 검사가 매 메시지 던지고 →
 * `DlqDeliveryError` → 커밋되지 않음 → 모든 파티션이 멈춘다. 그래서 `startConsumer` 가 한 번 묻고, 없으면 실패 테이블
 * 모드를 켜지 않는다(옛 `.dlq` 경로). 질의 자체가 실패해도 «없다»로 본다 — 모를 때 소비를 멈추는 쪽보다 옛 경로가 안전하다.
 *
 * 부팅 때라 요청 맥락이 없다. DB 마다(core 는 테넌트 DB 마다) 그 맥락에서 묻고, **모든 DB 가 가졌을 때만** 있다 —
 * 모드는 앱에 하나라, 한 테넌트 DB 에만 없어도 그 테넌트의 메시지가 보류 검사에서 매번 던지고, 파티션은 테넌트끼리 함께
 * 쓰므로 모든 테넌트의 소비가 멈춘다. 그래서 한 DB 가 닿지 않아도 모두 옛 `.dlq` 경로로 간다(소비는 멈추지 않는다).
 */
export async function checkDeadLetterTables(dbService: DbService): Promise<{ present: boolean; queryError?: string }> {
  const runs = await dbService.forEachDatabase(async () => {
    const rows = await dbService.db.execute<{ present: boolean }>(
      sql`select to_regclass('event.dead_letters') is not null and to_regclass('event.failure_actions') is not null as present`,
    );
    return rows[0]?.present === true;
  });
  const errors = runs.flatMap((run) => (run.ok ? [] : [describeFailedRun(run)]));
  if (errors.length > 0) return { present: false, queryError: errors.join('; ') };
  return { present: runs.every((run) => run.ok && run.value) };
}
