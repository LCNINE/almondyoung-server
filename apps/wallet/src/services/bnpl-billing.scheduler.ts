// services/bnpl-billing.scheduler.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { generateUUIDv7 } from '../shared/utils/id-generator';
/**
 * BNPL 월별 Billing 배치 스케줄러
 *
 * 📋 플로우:
 * 1. 1분 주기: AUTHORIZED 상태 BNPL 거래 수집 → CMS 출금 신청
 * 2. 1분 후: 출금 조회 → 성공 시 CAPTURED 변환
 */
@Injectable()
export class BnplBillingScheduler {
  private readonly logger = new Logger(BnplBillingScheduler.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * 🎯 1단계: BNPL 출금 신청 배치 (1분 주기 - 테스트용)
   * 실제 운영: 매월 28일 오전 9시
   */
  @Cron('*/1 * * * *', {
    name: 'bnpl-collection-request',
    timeZone: 'Asia/Seoul',
  })
  async processBnplCollectionRequest() {
    this.logger.log('🏦 BNPL 출금 신청 배치 시작');

    try {
      // 1. AUTHORIZED 상태인 BNPL 이벤트들 조회
      const authorizedEvents = await this.dbService.db
        .select({
          id: schema.bnplEvents.id,
          bnplAccountId: schema.bnplEvents.bnplAccountId,
          paymentSessionId: schema.bnplEvents.paymentSessionId,
          amount: schema.bnplEvents.amount,
          createdAt: schema.bnplEvents.createdAt,
        })
        .from(schema.bnplEvents)
        .where(
          and(
            eq(schema.bnplEvents.status, 'AUTHORIZED'),
            eq(schema.bnplEvents.transactionType, 'DEBIT'),
          ),
        );

      if (authorizedEvents.length === 0) {
        this.logger.log('📋 처리할 AUTHORIZED BNPL 거래가 없습니다.');
        return;
      }

      this.logger.log(
        `📊 AUTHORIZED BNPL 거래 ${authorizedEvents.length}건 발견`,
      );

      // 2. 사용자별로 그룹핑하여 Invoice 생성
      const userGroups = this.groupByUser(authorizedEvents);

      for (const [bnplAccountId, events] of userGroups) {
        await this.createInvoiceAndRequestCollection(bnplAccountId, events);
      }

      this.logger.log('✅ BNPL 출금 신청 배치 완료');
    } catch (error) {
      this.logger.error('❌ BNPL 출금 신청 배치 실패', error);
    }
  }

  /**
   * 🎯 2단계: BNPL 출금 조회 및 CAPTURE 배치 (1분 주기 - 테스트용)
   * 실제 운영: 매월 29일 오전 9시
   */
  @Cron('*/1 * * * *', {
    name: 'bnpl-collection-check',
    timeZone: 'Asia/Seoul',
  })
  async processBnplCollectionCheck() {
    this.logger.log('🔍 BNPL 출금 조회 및 CAPTURE 배치 시작');

    try {
      // 1. PROCESSING 상태인 Invoice들 조회 (실제로는 vBnplInvoice VIEW 사용)
      const processingInvoices = await this.dbService.db
        .select()
        .from(schema.bnplInvoices)
        .where(eq(schema.bnplInvoices.status, 'PROCESSING'));

      if (processingInvoices.length === 0) {
        this.logger.log('📋 처리할 PROCESSING Invoice가 없습니다.');
        return;
      }

      this.logger.log(
        `📊 PROCESSING Invoice ${processingInvoices.length}건 발견`,
      );

      for (const invoice of processingInvoices) {
        await this.checkCollectionAndCapture(invoice);
      }

      this.logger.log('✅ BNPL 출금 조회 및 CAPTURE 배치 완료');
    } catch (error) {
      this.logger.error('❌ BNPL 출금 조회 배치 실패', error);
    }
  }

  /**
   * 사용자별로 BNPL 이벤트 그룹핑
   */
  private groupByUser(events: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const event of events) {
      const key = event.bnplAccountId;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(event);
    }

    return groups;
  }

  /**
   * Invoice 생성 및 CMS 출금 신청
   */
  private async createInvoiceAndRequestCollection(
    bnplAccountId: string,
    events: any[],
  ) {
    const totalAmount = events.reduce(
      (sum, event) => sum + parseFloat(event.amount),
      0,
    );
    const invoiceId = generateUUIDv7();

    this.logger.log(
      `💰 Invoice 생성: ${invoiceId} (Account: ${bnplAccountId}, 총액: ${totalAmount}원, 건수: ${events.length})`,
    );

    try {
      // 1. Settlement Batch (Invoice) 생성
      await this.dbService.db.insert(schema.bnplInvoices).values({
        id: invoiceId,
        bnplAccountId: bnplAccountId,
        invoiceNumber: `BNPL_${Date.now()}`,
        totalAmount: totalAmount,
        status: 'PROCESSING', // 출금 신청 중
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 내일까지
        periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30일 전
        periodEnd: new Date(),
      });

      // 2. Settlement Batch Items 생성
      for (const event of events) {
        await this.dbService.db.insert(schema.bnplInvoiceItems).values({
          id: generateUUIDv7(),
          invoiceId: invoiceId,
          bnplEventId: event.id,
          amount: parseFloat(event.amount),
          transactionDate: event.createdAt,
        });
      }

      // 3. Mock CMS 출금 신청 (실제로는 HMS API 호출)
      const collectionEventId = generateUUIDv7();
      await this.dbService.db.insert(schema.bnplCollectionEvents).values({
        id: collectionEventId,
        invoiceId: invoiceId,
        eventType: 'COLLECTION_STARTED',
        status: 'PROCESSING',
        actor: 'SCHEDULER',
        metadata: JSON.stringify({
          totalAmount,
          eventCount: events.length,
          requestedAt: new Date().toISOString(),
        }),
      });

      // 4. 출금 신청만 기록 (상태는 PROCESSING 유지)
      // 실제 결과는 2단계에서 Mock으로 처리
      this.logger.log(
        `🏦 출금 신청 완료: Invoice ${invoiceId} (상태: PROCESSING)`,
      );

      // 🎯 중요: 여기서는 상태를 PROCESSING으로 유지하여 2단계에서 처리할 수 있도록 함
    } catch (error) {
      this.logger.error(`❌ Invoice 생성 실패: ${invoiceId}`, error);
    }
  }

  /**
   * 출금 조회 및 CAPTURE 처리
   */
  private async checkCollectionAndCapture(invoice: any) {
    this.logger.log(`🔍 출금 조회: Invoice ${invoice.id}`);

    try {
      // 🎯 Mock: 랜덤하게 성공/실패 시뮬레이션 (실제로는 HMS API 조회)
      const isSuccess = Math.random() > 0.3; // 70% 성공률

      if (isSuccess) {
        // 성공: 출금 승인 → COMPLETED로 변경
        await this.dbService.db
          .update(schema.bnplInvoices)
          .set({
            status: 'COMPLETED',
            pgTransactionId: `CMS_${Date.now()}`,
          })
          .where(eq(schema.bnplInvoices.id, invoice.id));

        await this.dbService.db.insert(schema.bnplCollectionEvents).values({
          id: generateUUIDv7(),
          invoiceId: invoice.id,
          eventType: 'COLLECTION_COMPLETED',
          status: 'CAPTURED',
          actor: 'SCHEDULER',
          metadata: JSON.stringify({
            pgTransactionId: `CMS_${Date.now()}`,
            capturedAt: new Date().toISOString(),
          }),
        });

        // 성공: 모든 관련 BNPL 이벤트를 CAPTURED로 변환
        await this.captureAllRelatedEvents(invoice.id);
        this.logger.log(
          `✅ Mock 출금 성공 → CAPTURE 완료: Invoice ${invoice.id}`,
        );
      } else {
        // 실패: 출금 거절 → FAILED로 변경
        await this.dbService.db
          .update(schema.bnplInvoices)
          .set({ status: 'FAILED' })
          .where(eq(schema.bnplInvoices.id, invoice.id));

        await this.dbService.db.insert(schema.bnplCollectionEvents).values({
          id: generateUUIDv7(),
          invoiceId: invoice.id,
          invoiceItemId: invoice.id,
          eventType: 'COLLECTION_FAILED',
          status: 'FAILED',
          actor: 'SCHEDULER',
          errorMessage: 'Mock: 잔액 부족 또는 계좌 오류',
          metadata: JSON.stringify({
            failedAt: new Date().toISOString(),
            reason: 'INSUFFICIENT_FUNDS',
          }),
        });

        // 실패: 모든 관련 BNPL 이벤트를 FAILED로 변환
        await this.failAllRelatedEvents(invoice.id);
        this.logger.log(
          `❌ Mock 출금 실패 → FAILED 처리 완료: Invoice ${invoice.id}`,
        );
      }
    } catch (error) {
      this.logger.error(`❌ 출금 조회 실패: Invoice ${invoice.id}`, error);
    }
  }

  /**
   * Invoice의 모든 관련 이벤트를 CAPTURED로 변환
   */
  private async captureAllRelatedEvents(invoiceId: string) {
    // 1. Invoice Items 조회
    const invoiceItems = await this.dbService.db
      .select()
      .from(schema.bnplInvoiceItems)
      .where(eq(schema.bnplInvoiceItems.invoiceId, invoiceId));

    const eventIds = invoiceItems.map((item) => item.bnplEventId);

    if (eventIds.length === 0) return;

    // 2. BNPL Events를 CAPTURED로 변환
    await this.dbService.db
      .update(schema.bnplEvents)
      .set({ status: 'CAPTURED' })
      .where(inArray(schema.bnplEvents.id, eventIds));

    // 3. Payment Intents와 Attempts도 CAPTURED로 변환
    const sessionIds = await this.dbService.db
      .select({ paymentSessionId: schema.bnplEvents.paymentSessionId })
      .from(schema.bnplEvents)
      .where(inArray(schema.bnplEvents.id, eventIds));

    const intentIds = sessionIds.map((s) => s.paymentSessionId);

    if (intentIds.length > 0) {
      await this.dbService.db
        .update(schema.paymentIntents)
        .set({
          status: 'CAPTURED',
          capturedAt: new Date(),
        })
        .where(inArray(schema.paymentIntents.id, intentIds));

      await this.dbService.db
        .update(schema.paymentAttempts)
        .set({ status: 'CAPTURED' })
        .where(inArray(schema.paymentAttempts.intentId, intentIds));
    }

    this.logger.log(
      `🎯 ${eventIds.length}건의 BNPL 거래를 CAPTURED로 변환 완료`,
    );
  }

  /**
   * Invoice의 모든 관련 이벤트를 FAILED로 변환
   */
  private async failAllRelatedEvents(invoiceId: string) {
    // captureAllRelatedEvents와 동일한 로직이지만 FAILED로 변환
    const invoiceItems = await this.dbService.db
      .select()
      .from(schema.bnplInvoiceItems)
      .where(eq(schema.bnplInvoiceItems.invoiceId, invoiceId));

    const eventIds = invoiceItems.map((item) => item.bnplEventId);

    if (eventIds.length === 0) return;

    await this.dbService.db
      .update(schema.bnplEvents)
      .set({ status: 'FAILED' })
      .where(inArray(schema.bnplEvents.id, eventIds));

    const sessionIds = await this.dbService.db
      .select({ paymentSessionId: schema.bnplEvents.paymentSessionId })
      .from(schema.bnplEvents)
      .where(inArray(schema.bnplEvents.id, eventIds));

    const intentIds = sessionIds.map((s) => s.paymentSessionId);

    if (intentIds.length > 0) {
      await this.dbService.db
        .update(schema.paymentIntents)
        .set({ status: 'FAILED' })
        .where(inArray(schema.paymentIntents.id, intentIds));

      await this.dbService.db
        .update(schema.paymentAttempts)
        .set({ status: 'FAILED' })
        .where(inArray(schema.paymentAttempts.intentId, intentIds));
    }

    this.logger.log(`❌ ${eventIds.length}건의 BNPL 거래를 FAILED로 변환 완료`);
  }
}
