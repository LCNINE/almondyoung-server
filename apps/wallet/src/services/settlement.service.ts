import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { BatchCmsService, HmsWithdrawalRequest } from './batch-cms.service';
import { WalletTx } from '../shared/database';

/**
 * SettlementService (All-or-Nothing, Idempotent)
 *
 * 스키마 제약과 enum을 엄격히 준수하는 정기 정산 서비스.
 *
 * - 정산 단위: (bnplAccountId, 기간[KST]) 한 번의 출금 시도.
 * - 부분 캡처 미지원: 성공 시 해당 기간의 모든 세션 CAPTURED, 실패 시 AUTHORIZED 유지.
 * - 멱등성: invoiceId = SETTLE:{bnplAccountId}:{YYYY-MM-DD start}:{YYYY-MM-DD end}
 * - 외부 I/O(HMS)는 DB 트랜잭션 밖에서 호출.
 * - 전송 중복 방지: settlement_batch.status를 PENDING/FAILED → PROCESSING으로 CAS.
 * - 스키마 적합성:
 *    * settlement_batch_item.bnpl_transaction_id (NOT NULL) → 세션별 bnpl_transaction 생성.
 *    * settlement_process_event의 eventType/status 값은 스키마에 정의된 집합만 사용.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly batchCmsService: BatchCmsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Period & Idempotency helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * KST 기준의 월간 정산 기간을 계산한다.
   * - periodEnd: 매월 10일 00:00:00.000 KST (exclusive)
   * - periodStart: periodEnd - 1개월 (inclusive)
   * - 반환은 UTC Date(=DB 비교용)
   */
  private getMonthlyPeriodKST(base: Date = new Date()): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const toKst = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const toUtc = (d: Date) => new Date(d.getTime() - 9 * 60 * 60 * 1000);

    const kst = toKst(base);
    const endKst = new Date(kst);
    endKst.setDate(10);
    endKst.setHours(0, 0, 0, 0);
    const startKst = new Date(endKst);
    startKst.setMonth(startKst.getMonth() - 1);

    return { periodStart: toUtc(startKst), periodEnd: toUtc(endKst) };
  }

  /**
   * 멱등성 Invoice ID (계정+기간 고정)
   */
  private settlementInvoiceId(
    bnplAccountId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const d = (dt: Date) => dt.toISOString().slice(0, 10);
    return `SETTLE:${bnplAccountId}:${d(periodStart)}:${d(periodEnd)}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 월별 정산 실행(계획 → 실행)
   *
   * 1) 계획(트랜잭션): 기간 내 AUTHORIZED 이벤트를 userId→bnplAccountId로 매핑하여
   *    세션별 bnpl_transaction(AUTHORIZED)과 settlement_batch(PENDING),
   *    settlement_batch_item(각 트랜잭션당 1개)을 생성한다.
   * 2) 실행(트랜잭션 밖): 배치별 CAS로 PROCESSING 잠금 → HMS 호출 → 결과 반영(COMPLETED/FAILED)
   *
   * @param runDate KST 기준 기준일(기본: now)
   */
  async runMonthlySettlement(runDate?: Date) {
    const { periodStart, periodEnd } = this.getMonthlyPeriodKST(runDate);

    this.logger.log(
      `정산 실행[KST]: ${periodStart.toISOString()} ~ ${periodEnd.toISOString()}`,
    );

    // 1) 계획
    const planned = await this.planMonthlySettlement(periodStart, periodEnd);

    // 2) 실행
    for (const p of planned) {
      try {
        await this.executeSingleBatch(
          p.batchId,
          p.bnplAccountId,
          p.totalAmount,
          periodStart,
          periodEnd,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`배치 실행 실패: batch=${p.batchId}, err=${msg}`);
      }
    }

    return {
      plannedCount: planned.length,
      totalAmount: planned.reduce((a, x) => a + x.totalAmount, 0),
      batchIds: planned.map((x) => x.batchId),
    };
  }

  /**
   * 실패한 배치 전체 재시도
   * - 재시도 이벤트는 settlement_process_event에 ITEM_PROCESSING + metadata.type='RETRY_ATTEMPT'
   */
  async retryAllFailedBatches(maxRetries = 3) {
    const failed = await this.db.db
      .select()
      .from(schema.settlementBatch)
      .where(eq(schema.settlementBatch.status, 'FAILED'));

    if (!failed.length) {
      return {
        processedCount: 0,
        successCount: 0,
        failureCount: 0,
        results: [] as any[],
      };
    }

    const results: Array<{
      batchId: string;
      success: boolean;
      finalStatus: string;
      message: string;
    }> = [];
    let successCount = 0,
      failureCount = 0;

    for (const b of failed) {
      const r = await this.retryFailedSettlement(b.id, maxRetries);
      results.push({
        batchId: b.id,
        success: r.success,
        finalStatus: r.finalStatus,
        message: r.message,
      });
      if (r.success) successCount++;
      else failureCount++;
    }

    return {
      processedCount: failed.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * 배치 상태 조회
   */
  async getBatchStatus(batchId: string) {
    const [batch] = await this.db.db
      .select()
      .from(schema.settlementBatch)
      .where(eq(schema.settlementBatch.id, batchId))
      .limit(1);
    if (!batch) throw new Error(`정산 배치 없음: ${batchId}`);

    const items = await this.db.db
      .select()
      .from(schema.settlementBatchItem)
      .where(eq(schema.settlementBatchItem.batchId, batchId));

    const events = await this.db.db
      .select()
      .from(schema.settlementProcessEvent)
      .where(eq(schema.settlementProcessEvent.batchId, batchId))
      .orderBy(schema.settlementProcessEvent.createdAt);

    return {
      batch,
      items,
      events,
      summary: {
        totalItems: items.length,
        totalAmount: Number(batch.totalAmount),
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Plan Phase (TX-in)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 계획 단계:
   * - 기간 내 `payment_events.status='AUTHORIZED'` + `payment_sessions` 조인(userId 획득)
   * - userId → bnplAccountId 매핑 후, **세션 단위**로 bnpl_transaction(AUTHORIZED) 생성
   * - account별 settlement_batch(PENDING) 생성(없으면), 각 세션 트랜잭션마다 settlement_batch_item 생성
   * - settlement_process_event: ITEM_PROCESSING(status: PROCESSING, metadata.stage='ENQUEUED') 기록
   */
  private async planMonthlySettlement(periodStart: Date, periodEnd: Date) {
    return await this.db.db.transaction(async (tx) => {
      // AUTHORIZED 이벤트 + 세션 조인
      const authorized = await tx
        .select({
          eventId: schema.paymentEvents.id,
          sessionId: schema.paymentEvents.paymentSessionId,
          methodId: schema.paymentEvents.paymentMethodId,
          amount: schema.paymentEvents.amount,
          userId: schema.paymentSessions.userId,
          createdAt: schema.paymentEvents.createdAt,
        })
        .from(schema.paymentEvents)
        .innerJoin(
          schema.paymentSessions,
          eq(schema.paymentEvents.paymentSessionId, schema.paymentSessions.id),
        )
        .where(
          and(
            eq(schema.paymentEvents.status, 'AUTHORIZED'),
            gte(schema.paymentEvents.createdAt, periodStart),
            lt(schema.paymentEvents.createdAt, periodEnd),
          ),
        );

      if (!authorized.length)
        return [] as Array<{
          batchId: string;
          bnplAccountId: string;
          totalAmount: number;
        }>;

      // user → bnplAccount
      const userIds = [...new Set(authorized.map((x) => x.userId))];
      const accounts = await tx
        .select()
        .from(schema.bnplAccount)
        .where(inArray(schema.bnplAccount.userId, userIds));

      // account별 세션 묶기
      const byAccount = new Map<
        string,
        { sessionRows: typeof authorized; total: number }
      >();
      for (const row of authorized) {
        const acc = accounts.find((a) => a.userId === row.userId);
        if (!acc) {
          this.logger.error(`BNPL 계좌 없음: userId=${row.userId}`);
          continue;
        }
        const key = acc.id;
        if (!byAccount.has(key))
          byAccount.set(key, { sessionRows: [], total: 0 });
        const bucket = byAccount.get(key)!;
        bucket.sessionRows.push(row);
        bucket.total += Number(row.amount);
      }

      const planned: Array<{
        batchId: string;
        bnplAccountId: string;
        totalAmount: number;
      }> = [];

      for (const [bnplAccountId, bucket] of byAccount.entries()) {
        const batchNumber = `BATCH-${bnplAccountId}-${periodEnd.toISOString().slice(0, 10)}`;

        // 기존 배치 존재 확인
        const existing = await tx
          .select({
            id: schema.settlementBatch.id,
            totalAmount: schema.settlementBatch.totalAmount,
          })
          .from(schema.settlementBatch)
          .where(
            and(
              eq(schema.settlementBatch.bnplAccountId, bnplAccountId),
              eq(schema.settlementBatch.batchNumber, batchNumber),
            ),
          )
          .limit(1);

        let batchId: string;
        if (existing.length) {
          batchId = existing[0].id;
        } else {
          // 배치(PENDING) 생성
          const [batch] = await tx
            .insert(schema.settlementBatch)
            .values({
              bnplAccountId,
              batchNumber,
              totalAmount: bucket.total,
              status: 'PENDING', // BATCH_JOB_STATUS
              dueDate: periodEnd,
              batchPeriodStart: periodStart,
              batchPeriodEnd: periodEnd,
            })
            .returning();
          batchId = batch.id;

          // 배치 시작 이벤트 (BATCH_STARTED, PROCESSING)
          await tx.insert(schema.settlementProcessEvent).values({
            batchId,
            eventType: 'BATCH_STARTED',
            status: 'PROCESSING',
            actor: 'SCHEDULER',
            metadata: JSON.stringify({
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            }),
          });
        }

        // 세션별 bnpl_transaction(AUTHORIZED) + settlement_batch_item 생성
        for (const row of bucket.sessionRows) {
          const [txn] = await tx
            .insert(schema.bnplTransaction)
            .values({
              bnplAccountId,
              paymentSessionId: row.sessionId, // NOT NULL 요구 충족
              transactionType: 'DEBIT',
              status: 'AUTHORIZED', // TRANSACTION_STATUS
              amount: Number(row.amount),
            })
            .returning();

          await tx.insert(schema.settlementBatchItem).values({
            batchId,
            bnplTransactionId: txn.id, // NOT NULL 요구 충족
            amount: Number(row.amount),
            transactionDate: new Date(),
          });

          // 큐잉 이벤트 (ITEM_PROCESSING, PROCESSING) - stage=ENQUEUED
          await tx.insert(schema.settlementProcessEvent).values({
            batchId,
            eventType: 'ITEM_PROCESSING',
            status: 'PROCESSING',
            actor: 'SCHEDULER',
            metadata: JSON.stringify({
              stage: 'ENQUEUED',
              sessionId: row.sessionId,
              amount: Number(row.amount),
            }),
          });
        }

        planned.push({ batchId, bnplAccountId, totalAmount: bucket.total });
      }

      return planned;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Execute Phase (I/O out of TX)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 단일 배치를 실행:
   * - CAS: PENDING/FAILED → PROCESSING (중복 전송 방지)
   * - HMS 호출 (트랜잭션 밖, 멱등 invoiceId 사용)
   * - 성공 시: 모든 세션/이벤트 CAPTURED, 배치 COMPLETED
   * - 실패 시: 세션 AUTHORIZED 유지, 배치 FAILED
   */
  private async executeSingleBatch(
    batchId: string,
    bnplAccountId: string,
    totalAmount: number,
    periodStart: Date,
    periodEnd: Date,
  ) {
    // 1) CAS (PROCESSING으로 전이)
    const locked = await this.db.db.transaction(async (tx) =>
      this.tryMarkBatchProcessing(tx, batchId),
    );
    if (!locked) {
      this.logger.warn(`배치 잠금 실패 또는 이미 처리됨: ${batchId}`);
      return;
    }

    // 2) "보냄" 표시(스키마 eventType 범주 내에서 ITEM_PROCESSING + stage=SENT)
    await this.db.db.insert(schema.settlementProcessEvent).values({
      batchId,
      eventType: 'ITEM_PROCESSING',
      status: 'PROCESSING',
      actor: 'SCHEDULER',
      metadata: JSON.stringify({
        stage: 'SENT',
        sentAt: new Date().toISOString(),
      }),
    });

    // 3) HMS 호출 (I/O)
    const withdrawal = await this.callHmsWithdrawal(
      bnplAccountId,
      totalAmount,
      periodStart,
      periodEnd,
    );

    // 관련 세션 수집 (기간 내 AUTHORIZED)
    const relatedSessions = await this.db.db
      .select({ sessionId: schema.paymentEvents.paymentSessionId })
      .from(schema.paymentEvents)
      .innerJoin(
        schema.paymentSessions,
        eq(schema.paymentEvents.paymentSessionId, schema.paymentSessions.id),
      )
      .innerJoin(
        schema.bnplAccount,
        eq(schema.paymentSessions.userId, schema.bnplAccount.userId),
      )
      .where(
        and(
          eq(schema.bnplAccount.id, bnplAccountId),
          eq(schema.paymentEvents.status, 'AUTHORIZED'),
          gte(schema.paymentEvents.createdAt, periodStart),
          lt(schema.paymentEvents.createdAt, periodEnd),
        ),
      );

    const sessionIds = [...new Set(relatedSessions.map((r) => r.sessionId))];

    // 4) 결과 반영 (새 트랜잭션)
    if (withdrawal.success) {
      await this.db.db.transaction(async (tx) => {
        // 세션 CAPTURED + 이벤트 CAPTURED + payment_events CAPTURED
        for (const sessionId of sessionIds) {
          await tx
            .update(schema.paymentSessions)
            .set({
              status: 'CAPTURED', // PAYMENT_SESSION_STATUS
              capturedAt: new Date(),
              updatedAt: new Date(),
              metadata: JSON.stringify({
                settlementBatchId: batchId,
                settledAt: new Date().toISOString(),
                hmsTransactionId: withdrawal.transactionId,
              }),
            })
            .where(eq(schema.paymentSessions.id, sessionId));

          await tx.insert(schema.paymentSessionEvents).values({
            paymentSessionId: sessionId,
            eventType: 'PAYMENT_CAPTURED', // PAYMENT_SESSION_EVENT_TYPE
            eventData: JSON.stringify({
              reason: 'SETTLEMENT_COMPLETED',
              settlementBatchId: batchId,
              hmsTransactionId: withdrawal.transactionId,
              capturedAt: new Date().toISOString(),
            }),
          });

          await tx
            .update(schema.paymentEvents)
            .set({
              status: 'CAPTURED', // TRANSACTION_STATUS
              pgTransactionId: withdrawal.transactionId,
              updatedAt: new Date(),
              metadata: JSON.stringify({
                settlementBatchId: batchId,
                hmsTransactionId: withdrawal.transactionId,
                capturedAt: new Date().toISOString(),
              }),
            })
            .where(
              and(
                eq(schema.paymentEvents.paymentSessionId, sessionId),
                eq(schema.paymentEvents.status, 'AUTHORIZED'),
              ),
            );
        }

        // 배치 COMPLETED
        await tx
          .update(schema.settlementBatch)
          .set({
            status: 'COMPLETED', // BATCH_JOB_STATUS
            pgTransactionId: withdrawal.transactionId,
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, batchId));

        // 프로세스 이벤트: ITEM_CAPTURED / BATCH_COMPLETED
        await tx.insert(schema.settlementProcessEvent).values([
          {
            batchId,
            eventType: 'ITEM_CAPTURED',
            status: 'CAPTURED',
            paymentEventId: withdrawal.transactionId,
            actor: 'SCHEDULER',
            metadata: JSON.stringify({
              hmsTransactionId: withdrawal.transactionId,
            }),
          },
          {
            batchId,
            eventType: 'BATCH_COMPLETED',
            status: 'CAPTURED', // 완료 시 CAPTURED로 표시(스키마 status 집합 내)
            actor: 'SCHEDULER',
            metadata: JSON.stringify({ completedAt: new Date().toISOString() }),
          },
        ]);

        // OPTIONAL: idempotency_keys 기록 (내부 멱등 추적)
        await this.upsertIdempotencyKey(tx, {
          id: this.settlementInvoiceId(bnplAccountId, periodStart, periodEnd),
          userId: await this.findUserIdByAccount(tx, bnplAccountId),
          requestPath: '/hms/withdrawal',
          requestHash: 'v1', // 필요 시 바이트 해시 적용
          status: 'COMPLETED',
          responseCode: 200,
          responseBody: JSON.stringify({ txId: withdrawal.transactionId }),
        });

        // (성공 경로 트랜잭션 내부)
        await this.captureBnplTransactionsForSessions(
          tx,
          bnplAccountId,
          sessionIds,
        );
      });

      this.logger.log(
        `정산 성공: batch=${batchId}, sessions=${sessionIds.length}, amount=${totalAmount}`,
      );
    } else {
      await this.db.db.transaction(async (tx) => {
        // 배치 FAILED
        await tx
          .update(schema.settlementBatch)
          .set({
            status: 'FAILED', // BATCH_JOB_STATUS
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, batchId));

        // 프로세스 이벤트: ITEM_FAILED / BATCH_FAILED
        await tx.insert(schema.settlementProcessEvent).values([
          {
            batchId,
            eventType: 'ITEM_FAILED',
            status: 'FAILED',
            actor: 'SCHEDULER',
            errorMessage: withdrawal.error || '출금 실패',
            metadata: JSON.stringify({
              failureReason: withdrawal.error || 'UNKNOWN',
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            }),
          },
          {
            batchId,
            eventType: 'BATCH_FAILED',
            status: 'FAILED',
            actor: 'SCHEDULER',
            errorMessage: withdrawal.error || '출금 실패',
          },
        ]);

        // 세션은 AUTHORIZED 유지 + 실패 이벤트 기록
        for (const sessionId of sessionIds) {
          await tx.insert(schema.paymentSessionEvents).values({
            paymentSessionId: sessionId,
            eventType: 'PAYMENT_FAILED',
            eventData: JSON.stringify({
              reason: 'SETTLEMENT_FAILED',
              settlementBatchId: batchId,
              failureReason: withdrawal.error || '출금 실패',
              failedAt: new Date().toISOString(),
              willRetryNextMonth: true,
            }),
          });
        }

        // OPTIONAL: idempotency_keys 실패 기록
        await this.upsertIdempotencyKey(tx, {
          id: this.settlementInvoiceId(bnplAccountId, periodStart, periodEnd),
          userId: await this.findUserIdByAccount(tx, bnplAccountId),
          requestPath: '/hms/withdrawal',
          requestHash: 'v1',
          status: 'COMPLETED', // 멱등키 엔트리는 응답 고정 목적. 실패도 COMPLETED로 고정 가능.
          responseCode: 502,
          responseBody: JSON.stringify({ error: withdrawal.error || 'FAILED' }),
        });
      });

      this.logger.error(
        `정산 실패: batch=${batchId}, error=${withdrawal.error}, amount=${totalAmount}`,
      );
    }
  }

  /**
   * 배치를 PROCESSING으로 마킹(CAS)
   * - PENDING/FAILED 상태인 경우에만 PROCESSING으로 전이된다.
   */
  private async tryMarkBatchProcessing(
    tx: WalletTx,
    batchId: string,
  ): Promise<boolean> {
    const updated = await tx
      .update(schema.settlementBatch)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(
        and(
          eq(schema.settlementBatch.id, batchId),
          inArray(schema.settlementBatch.status, [
            'PENDING',
            'FAILED',
          ] as const),
        ),
      )
      .returning({ id: schema.settlementBatch.id });

    return updated.length === 1;
  }

  /**
   * HMS 출금 호출 (트랜잭션 밖)
   * - 멱등 invoiceId(계정+기간)를 사용.
   */
  private async callHmsWithdrawal(
    bnplAccountId: string,
    amount: number,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    const rows = await this.db.db
      .select({
        bnplAccount: schema.bnplAccount,
        batchCmsMethod: schema.batchCmsMethod,
      })
      .from(schema.bnplAccount)
      .innerJoin(
        schema.batchCmsMethod,
        eq(
          schema.bnplAccount.paymentMethodId,
          schema.batchCmsMethod.paymentMethodId,
        ),
      )
      .where(eq(schema.bnplAccount.id, bnplAccountId))
      .limit(1);

    if (!rows[0])
      return {
        success: false,
        error: `BNPL 계정/HMS 정보 없음: ${bnplAccountId}`,
      };

    const { batchCmsMethod } = rows[0];
    const req: HmsWithdrawalRequest = {
      memberId: batchCmsMethod.hmsMemberId,
      amount,
      paymentDate: new Date().toISOString().split('T')[0],
      invoiceId: this.settlementInvoiceId(
        bnplAccountId,
        periodStart,
        periodEnd,
      ),
    };

    return await this.batchCmsService.requestWithdrawal(req);
  }

  /**
   * 실패한 정산 배치 재시도
   * - 재시도 시도 이벤트는 ITEM_PROCESSING(status: PROCESSING) + metadata.type='RETRY_ATTEMPT'
   * - 실제 호출은 커밋 후 executeSingleBatch 재사용
   */
  async retryFailedSettlement(
    batchId: string,
    maxRetries = 3,
  ): Promise<{
    success: boolean;
    retryCount: number;
    finalStatus: string;
    message: string;
  }> {
    const queued = await this.db.db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(schema.settlementBatch)
        .where(eq(schema.settlementBatch.id, batchId))
        .limit(1);
      if (!batch) throw new Error(`정산 배치 없음: ${batchId}`);
      if (batch.status !== 'FAILED') {
        return {
          success: false,
          retryCount: 0,
          finalStatus: batch.status,
          message: `재시도 불가 상태: ${batch.status}`,
        };
      }

      const retryEvents = await tx
        .select()
        .from(schema.settlementProcessEvent)
        .where(
          and(
            eq(schema.settlementProcessEvent.batchId, batchId),
            eq(schema.settlementProcessEvent.eventType, 'ITEM_PROCESSING'),
          ),
        );

      const count = retryEvents.filter((e) => {
        try {
          if (!e.metadata) return false;
          const m = JSON.parse(e.metadata) as { type?: string };
          return m.type === 'RETRY_ATTEMPT';
        } catch {
          return false;
        }
      }).length;

      if (count >= maxRetries) {
        await tx.insert(schema.settlementProcessEvent).values({
          batchId,
          eventType: 'ITEM_FAILED',
          status: 'FAILED',
          actor: 'SCHEDULER',
          errorMessage: `최대 재시도 초과(${maxRetries})`,
          metadata: JSON.stringify({
            type: 'MAX_RETRY_EXCEEDED',
            finalRetryCount: count,
          }),
        });
        return {
          success: false,
          retryCount: count,
          finalStatus: 'FAILED',
          message: `최대 재시도 초과(${maxRetries})`,
        };
      }

      await tx.insert(schema.settlementProcessEvent).values({
        batchId,
        eventType: 'ITEM_PROCESSING',
        status: 'PROCESSING',
        actor: 'SCHEDULER',
        metadata: JSON.stringify({
          type: 'RETRY_ATTEMPT',
          retryCount: count + 1,
        }),
      });

      return {
        success: true,
        retryCount: count,
        finalStatus: batch.status,
        message: '재시도 큐잉',
      };
    });

    if (!queued.success) return queued;

    const [batch] = await this.db.db
      .select()
      .from(schema.settlementBatch)
      .where(eq(schema.settlementBatch.id, batchId))
      .limit(1);
    if (!batch) throw new Error(`정산 배치 없음: ${batchId}`);

    await this.executeSingleBatch(
      batchId,
      batch.bnplAccountId,
      Number(batch.totalAmount),
      batch.batchPeriodStart,
      batch.batchPeriodEnd,
    );

    const [updated] = await this.db.db
      .select()
      .from(schema.settlementBatch)
      .where(eq(schema.settlementBatch.id, batchId))
      .limit(1);

    return {
      success: updated.status === 'COMPLETED',
      retryCount: queued.retryCount + 1,
      finalStatus: updated.status,
      message:
        updated.status === 'COMPLETED'
          ? '재시도 성공'
          : `상태: ${updated.status}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async upsertIdempotencyKey(
    tx: WalletTx,
    args: {
      id: string;
      userId: string;
      requestPath: string;
      requestHash: string;
      status: schema.IdempotencyStatus;
      responseCode?: number;
      responseBody?: string;
    },
  ) {
    // 간단한 upsert(없으면 insert, 있으면 update) — DB 제약/컨벤션에 맞게 조정
    const existing = await tx
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.id, args.id))
      .limit(1);

    if (!existing.length) {
      await tx.insert(schema.idempotencyKeys).values({
        id: args.id,
        userId: args.userId,
        requestPath: args.requestPath,
        requestHash: args.requestHash,
        status: args.status,
        responseCode: args.responseCode,
        responseBody: args.responseBody,
        // expiresAt은 운영 정책에 맞게 설정(예: +90일)
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });
    } else {
      await tx
        .update(schema.idempotencyKeys)
        .set({
          status: args.status,
          responseCode: args.responseCode,
          responseBody: args.responseBody,
        })
        .where(eq(schema.idempotencyKeys.id, args.id));
    }
  }

  /**
   * 지정된 세션들에 대응하는 BNPL 트랜잭션을 CAPTURED로 일괄 전환
   * @param tx Drizzle 트랜잭션
   * @param bnplAccountId 대상 계정
   * @param sessionIds payment_sessions.id 배열 (중복 제거된 상태 권장)
   */
  private async captureBnplTransactionsForSessions(
    tx: WalletTx,
    bnplAccountId: string,
    sessionIds: string[],
  ) {
    if (sessionIds.length === 0) return;

    // 세션 수가 많다면(예: 1k+) DB 드라이버의 IN 한계나 성능을 고려해 chunking
    const chunkSize = 500;
    for (let i = 0; i < sessionIds.length; i += chunkSize) {
      const chunk = sessionIds.slice(i, i + chunkSize);

      await tx
        .update(schema.bnplTransaction)
        .set({ status: 'CAPTURED' }) // TRANSACTION_STATUS 집합 내 값
        .where(
          and(
            eq(schema.bnplTransaction.bnplAccountId, bnplAccountId),
            eq(schema.bnplTransaction.status, 'AUTHORIZED'),
            inArray(schema.bnplTransaction.paymentSessionId, chunk),
          ),
        );
    }
  }

  private async findUserIdByAccount(
    tx: WalletTx,
    bnplAccountId: string,
  ): Promise<string> {
    const [acc] = await tx
      .select({ userId: schema.bnplAccount.userId })
      .from(schema.bnplAccount)
      .where(eq(schema.bnplAccount.id, bnplAccountId))
      .limit(1);
    return acc?.userId ?? 'unknown';
  }
}
