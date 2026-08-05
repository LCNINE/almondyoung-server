import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDb, DbService } from '@app/db';
import { and, eq, gt, notInArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type PimSchema, productFormExports, productFormExportItems } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportSnapshotReader } from './form-export.snapshot.reader';
import { FormExportFileClient } from './form-export-file.client';
import { buildFormWorkbook } from './form-export.workbook';

/**
 * 30분. `runExport` 는 슬라이스로 나뉘지 않고 lease 를 중간에 갱신하지도 않는다 —
 * `buildPrefill` 은 masterId 하나당 로더를 여러 번 부르는 직렬 N+1 루프이고(스냅샷
 * 리더 참조), 상한은 요청 5,000개(스펙 §7)다. 5분으로는 큰 배치가 lease 보다 먼저
 * 죽어(=여전히 조립 중인데 만료로 보임) 다른 태스크가 같은 잡을 겹쳐 잡을 수 있다 —
 * 단일 인스턴스면 토큰 등호 CAS 가 있어 무해하지만(늦게 끝난 쪽이 조용히 진다), 인스턴스가
 * 둘 이상이면 이중 조립·이중 업로드가 되고 file-service 에 orphan cleanup 이 없어 진 쪽의
 * xlsx 가 영원히 고아로 남는다. lease 를 너무 길게 잡아 생기는 비용은 "진짜 죽은 워커"의
 * 회수가 늦어지는 것뿐이고(운영자가 잡을 수 있다), 너무 짧게 잡아 생기는 비용은 영구적인
 * 고아 업로드다 — 그래서 넉넉하게 30분을 기본값으로 둔다. 이걸로도 부족하면 진짜 해법은
 * 사이드 커넥션으로 도는 lease 갱신(product-import 의 renewLease 와 같은 것)이지 상수를
 * 더 올리는 게 아니다 — 지금은 구현하지 않는다.
 */
export const DEFAULT_EXPORT_LEASE_MS = 1_800_000;
/**
 * 상한에 닿으면 잡을 failed 로 확정한다. 실제 소요는 상한 × FORM_EXPORT_RETRY_DELAY_MS
 * (1분) ≈ 2~3분이다 — 재시도 주기가 lease 만료가 아니라 이 대기값이기 때문이다.
 *
 * 상한을 임포트의 10 이 아니라 3 으로 두는 이유는 조립이 통짜 작업이라 부분 진척이 없기
 * 때문이다 — 세 번 연속 터진 조립이 네 번째에 성공할 가능성보다, 화면에 실패를 빨리
 * 보여주고 사람이 다시 누르게 하는 편이 낫다. 좀비 워커가 후임의 살아있는 잡을 잘못
 * 확정시키는 창은 recordJobError 의 토큰 CAS 가 닫는다(아래 참조) — 예전에는 그 CAS 가
 * 없어 상한 3 이 위험 요소였지만, 지금은 좀비의 실패가 후임의 카운터에 닿지 못한다.
 */
export const MAX_CONSECUTIVE_EXPORT_FAILURES = 3;
/**
 * 실패 후 다음 시도까지의 대기. **lease 와 다른 축이다** — lease(30분)는 조립 중 점유를
 * 지키는 값이고, 이 값은 "실패한 잡을 얼마 뒤에 다시 집을까"다. recordJobError 는 예외가
 * 던져진 뒤에 불리므로 그 시점엔 조립이 이미 끝났고, lease 의 점유 보호 역할도 끝났다 —
 * 그래서 여기서만 짧게 되돌려도 살아있는 작업을 뺏지 않는다. 워커 틱이 10초라 3회
 * 결론까지 약 2~3분이다.
 */
export const FORM_EXPORT_RETRY_DELAY_MS = 60_000;

/**
 * `recordJobError` 가 손대면 안 되는 종결 상태. 한번 닿으면 다시 claim 되지 않는다.
 * `notInArray` 가 mutable 배열을 요구해(readonly tuple 은 타입 에러) `as const` 를 안 쓴다.
 */
const TERMINAL_EXPORT_STATUSES: Array<'completed' | 'failed'> = ['completed', 'failed'];

export interface ClaimedExport {
  exportId: string;
  leaseToken: string;
}

@Injectable()
export class FormExportJobManager {
  private readonly logger = new Logger(FormExportJobManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly snapshot: FormExportSnapshotReader,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  private get leaseMs(): number {
    const raw = Number.parseInt(this.config.get<string>('FORM_EXPORT_LEASE_MS') ?? '', 10);
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_EXPORT_LEASE_MS;
  }

  /**
   * 대기 잡 하나를 원자적으로 잡는다. lease 를 미래로 밀어 두므로 롤링 배포로 태스크가
   * 잠시 둘이어도 같은 잡을 겹쳐 조립하지 않는다. running 을 다시 잡는 것은 재개 경로다 —
   * lease 가 만료됐다는 건 처리하던 프로세스가 죽었다는 뜻이다.
   *
   * product-import-job.manager.ts:148-192 의 claim 과 같은 알고리즘이다(컬럼만 다르다) —
   * lease 소유권은 이 레포에서 목이 초록인 채 세 번 깨졌고, 그때 얻은 결론이 "만료시각은
   * DB 시계가 만들고 소유권은 uuid 등호로 본다" 다. `product_form_exports` 에는 임포트
   * 세션의 `cancel_requested_at` 에 대응하는 취소 컬럼이 없다 — 이 잡에는 취소 기능이
   * 없으므로 그 가드는 옮기지 않는다.
   */
  async claim(tx?: DbTransaction): Promise<ClaimedExport | null> {
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      // lease_token 이 남아 있는 행을 집었다는 건 **직전 소유자가 못 끝내고 죽었다**는
      // 뜻이다(정상 종료는 완료/실패로 lease 를 푼다). recordJobError 의 토큰 CAS 는
      // 그 좀비의 뒤늦은 예외를 버리므로, 그 실패를 여기서 원자적으로 센다 — 이게 없으면
      // 매 시도가 lease 를 넘기는 잡은 카운터가 영원히 안 올라 무한 재시도가 된다.
      // 첫 클레임(queued, 토큰 NULL)은 실패가 아니므로 세지 않는다.
      const rows = await trx.execute<{ id: string; consecutive_failures: number }>(sql`
        UPDATE product_form_exports
           SET status = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid,
               consecutive_failures = consecutive_failures
                                    + CASE WHEN lease_token IS NULL THEN 0 ELSE 1 END,
               updated_at = NOW()
         WHERE id = (
           SELECT id
             FROM product_form_exports
            WHERE status IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id, consecutive_failures
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 원소 타입까지
      // 좁혀주지 않는다 — fulfillment-order-reservation-retry.worker.ts:111 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string; consecutive_failures: number }>;
      if (!row) return null;

      // 재클레임 카운트가 상한을 채웠다면 조립할 이유가 없다 — 바로 확정하고 이 틱은 쉰다.
      if (row.consecutive_failures >= MAX_CONSECUTIVE_EXPORT_FAILURES) {
        await trx
          .update(productFormExports)
          .set({ status: 'failed', leaseUntil: null, leaseToken: null })
          .where(eq(productFormExports.id, row.id));
        this.logger.error(`양식 생성 잡 ${row.id} 이 재클레임 누적으로 연속 실패 상한에 닿아 failed 로 확정됐습니다`);
        return null;
      }

      return { exportId: row.id, leaseToken };
    }, tx);
  }

  /**
   * 조립 전체를 한 번에 돈다. 임포트와 달리 슬라이스로 나누지 않는 이유는 워크북이
   * **하나의 파일**이라 부분 산출물이 없기 때문이다. 대신 lease 를 길게(30분) 잡고,
   * 죽으면 처음부터 다시 조립한다(멱등하다 — 매번 현재 active 를 다시 읽는다).
   *
   * 반환값은 "내가 여전히 이 잡의 소유자였는가" 다. `false` 면 lease 를 이미 잃었다는
   * 뜻이고(후임이 인수했거나 상한에 닿아 failed 로 확정됐거나) — 호출자(워커)는 이때
   * `clearConsecutiveFailures` 를 부르면 안 된다. 그건 좀비 자신의 상태가 아니라
   * **후임의 살아있는 잡**에 대고 카운터를 리셋하는 것이라 상한이 영원히 발화하지
   * 못하게 만들 수 있다.
   */
  async runExport(claimed: ClaimedExport): Promise<boolean> {
    const { exportId, leaseToken } = claimed;

    const [job] = await this.db.run((trx) =>
      trx.select().from(productFormExports).where(eq(productFormExports.id, exportId)).limit(1),
    );
    if (!job) return false;

    const { data, items } = await this.db.run((trx) =>
      this.snapshot.buildPrefill(trx, job.requestedMasterIds, exportId),
    );

    const buffer = await buildFormWorkbook(data);
    const fileName = `상품일괄양식_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const { fileId } = await this.fileClient.upload({ buffer, fileName, userId: job.requestedBy });

    return this.db.run(async (trx) => {
      // 마감 CAS 를 트랜잭션의 **첫 문장**으로 둔다. items 델리트/인서트보다 먼저 소유권을
      // 확인해야 한다 — 이전 구현은 CAS 를 마지막에 둬서, CAS 가 0행을 매치해도(=lease 를
      // 이미 잃었어도) 그 앞의 items 델리트/인서트는 별개 문장이라 그대로 커밋됐다. 그
      // 결과 좀비가 후임의 product_form_export_items 를 자기 것으로 덮어써, product_count
      // 는 후임 값인데 실제 items 행은 좀비 것으로 섞이는 데이터 손상이 났다(리뷰에서 실
      // Postgres 로 재현됨). CAS 를 먼저 실행하고 0행이면 **트랜잭션 전체를 여기서 끝낸다**
      // — items 쪽 문장에 아예 도달하지 않는다.
      const [row] = await trx
        .update(productFormExports)
        .set({
          status: 'completed',
          fileId,
          productCount: items.length,
          errorMessage: null,
          leaseUntil: null,
          leaseToken: null,
          updatedAt: new Date(),
        })
        .where(and(eq(productFormExports.id, exportId), eq(productFormExports.leaseToken, leaseToken)))
        .returning({ id: productFormExports.id });

      if (!row) {
        // 두 번째 인자 없이도 이건 "예상 못 한 예외"가 아니라 "레이스에서 졌다" 는
        // 정상적인 경합 결과다 — 그래도 로그가 없으면 운영자는 이중 조립이 있었다는
        // 신호를 전혀 못 받는다(product-import-job.manager.ts:273,374,492 의 renewLease
        // 경고와 같은 이유).
        this.logger.warn(`양식 생성 잡 lease 를 잃어 결과를 반영하지 못했습니다 (export=${exportId})`);
        return false;
      }

      // 재조립(lease 만료 후 재개)이면 옛 항목이 남아 UNIQUE 를 때린다. 먼저 비운다.
      // CAS 가 위에서 이미 통과했으므로 이 시점에 이 트랜잭션이 이 잡의 유일한 소유자다.
      await trx.delete(productFormExportItems).where(eq(productFormExportItems.exportId, exportId));
      if (items.length > 0) {
        await trx.insert(productFormExportItems).values(items.map((item) => ({ exportId, ...item })));
      }
      return true;
    });
  }

  /**
   * 조립 중 예외를 기록하고 다음 시도를 예약한다.
   *
   * **토큰 CAS 를 건다.** 이건 재시도 단축의 전제조건이다 — CAS 없이 lease_until 을
   * 짧게 쓰면 좀비(lease 를 잃고도 살아있던 워커)가 **후임의 살아있는 잡**의 lease 를
   * 깎아 제3의 워커가 그 잡을 집어가고, 이중 조립·이중 업로드가 되어 file-service 에
   * 고아 정리 잡이 없으니 진 쪽 xlsx 가 영구 고아로 남는다.
   *
   * CAS 가 뚫는 구멍(좀비의 실패가 안 세어져 연속 실패 상한에 영원히 못 닿음)은 claim
   * 이 막는다 — 거기서 "lease 안에 못 끝낸 시도"를 재클레임 시점에 센다. 두 곳을 합치면
   * 실패한 시도가 정확히 한 번씩, 올바른 잡에 귀속된다.
   *
   * 종결 상태(completed/failed)는 WHERE 에서 계속 제외한다. 토큰 CAS 만으로도 대부분
   * 막히지만, 성공한 잡을 되돌리는 사고는 대가가 커서 가드를 이중으로 둔다.
   */
  async recordJobError(exportId: string, leaseToken: string, message: string): Promise<void> {
    await this.db.run(async (trx) => {
      const [row] = await trx
        .update(productFormExports)
        .set({
          errorMessage: message,
          consecutiveFailures: sql`${productFormExports.consecutiveFailures} + 1`,
          leaseUntil: sql`NOW() + ${FORM_EXPORT_RETRY_DELAY_MS} * interval '1 millisecond'`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productFormExports.id, exportId),
            eq(productFormExports.leaseToken, leaseToken),
            notInArray(productFormExports.status, TERMINAL_EXPORT_STATUSES),
          ),
        )
        .returning({ failures: productFormExports.consecutiveFailures });

      if (!row) {
        this.logger.warn(
          `양식 생성 잡 ${exportId} 의 실패 기록을 건너뜁니다 — lease 토큰이 일치하지 않습니다(좀비 워커)`,
        );
        return;
      }

      if (row.failures >= MAX_CONSECUTIVE_EXPORT_FAILURES) {
        await trx
          .update(productFormExports)
          .set({ status: 'failed', leaseUntil: null, leaseToken: null })
          .where(eq(productFormExports.id, exportId));
        this.logger.error(`양식 생성 잡 ${exportId} 이 연속 실패 상한에 닿아 failed 로 확정됐습니다`);
      }
    });
  }

  /**
   * 슬라이스(조립)가 예외 없이 끝났으면 연속 실패를 0 으로 되돌린다. `> 0` 조건을 붙여
   * 흔한 경우(이미 0)에는 실제 행에 닿지 않게 한다(product-import-job.manager.ts:730-737
   * 과 같은 이유) — 매 틱 도는 왕복이라 write 를 만들지 않는 편이 낫다. 부수 효과로, 이
   * 호출이 실은 소유권을 잃은 좀비가 부른 것이라도(runExport 가 false 를 돌려줬는데
   * 워커가 실수로 이걸 부른 경우) 후임의 카운터가 이미 0 이면 이 가드가 무의미한 write
   * 를 한 번 더 막아준다 — 다만 그 경우를 막는 진짜 방어선은 워커가 false 일 때 아예
   * 이 메서드를 안 부르는 것이다(form-export-job.worker.ts 참조).
   */
  async clearConsecutiveFailures(exportId: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productFormExports)
        .set({ consecutiveFailures: 0 })
        .where(and(eq(productFormExports.id, exportId), gt(productFormExports.consecutiveFailures, 0))),
    );
  }
}
