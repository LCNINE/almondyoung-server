import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, and, gte, lte, inArray, sql, desc, type SQL } from 'drizzle-orm';
import type {
  TaxInvoice,
  NewTaxInvoice,
  UpdateTaxInvoice,
  TaxInvoiceSnapshot,
  NewTaxInvoiceSnapshot,
  TaxInvoiceSnapshotPayload,
  TaxInvoiceEvent,
  NewTaxInvoiceEvent,
  UserTaxInvoicePreference,
  NewUserTaxInvoicePreference,
  UpdateUserTaxInvoicePreference,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoiceRepository (Unified Data Access Layer)
 *
 * 책임: 세금계산서 도메인의 모든 데이터 접근 (순수 DB 접근만)
 * - 세금계산서 메인 데이터
 * - 스냅샷 (홈택스 제출용)
 * - 감사 이벤트 로그
 * - 사용자 기본 설정
 */
@Injectable()
export class TaxInvoiceRepository {
  private readonly logger = new Logger(TaxInvoiceRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  // ========================================
  // 세금계산서 메인 메소드
  // ========================================

  /**
   * ID로 세금계산서 조회
   */
  async findById(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    const executor = tx || this.db.db;
    const [invoice] = await executor
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.id, invoiceId))
      .limit(1);
    return invoice ?? null;
  }

  /**
   * 주문 ID로 세금계산서 조회
   */
  async findByOrderId(
    orderId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    const executor = tx || this.db.db;
    const [invoice] = await executor
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.orderId, orderId))
      .limit(1);
    return invoice ?? null;
  }

  /**
   * ID로 세금계산서 조회 with 행 잠금 (FOR UPDATE)
   */
  async findByIdForUpdate(
    invoiceId: string,
    tx: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    const [invoice] = await tx
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.id, invoiceId))
      .for('update');

    return invoice ?? null;
  }

  /**
   * 주문 ID로 세금계산서 조회 with 행 잠금 (FOR UPDATE)
   */
  async findByOrderIdForUpdate(
    orderId: string,
    tx: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    const [invoice] = await tx
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.orderId, orderId))
      .for('update');

    return invoice ?? null;
  }

  /**
   * 여러 ID로 세금계산서 일괄 조회 with 행 잠금
   */
  async findManyByIdsForUpdate(
    invoiceIds: string[],
    tx: WalletExecutor,
  ): Promise<TaxInvoice[]> {
    if (invoiceIds.length === 0) return [];

    return await tx
      .select()
      .from(schema.taxInvoices)
      .where(inArray(schema.taxInvoices.id, invoiceIds))
      .for('update');
  }

  /**
   * 세금계산서 생성
   */
  async create(data: NewTaxInvoice, tx?: WalletExecutor): Promise<TaxInvoice> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.taxInvoices)
      .values(data)
      .returning();

    this.logger.log(
      `TaxInvoice created: ${created.id} for order ${created.orderId}`,
    );
    return created;
  }

  /**
   * 세금계산서 업데이트
   */
  async update(
    invoiceId: string,
    data: UpdateTaxInvoice,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.taxInvoices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.taxInvoices.id, invoiceId));

    this.logger.log(`TaxInvoice updated: ${invoiceId}`);
  }

  /**
   * 상태 업데이트
   */
  async updateStatus(
    invoiceId: string,
    status: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.taxInvoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.taxInvoices.id, invoiceId));

    this.logger.log(`TaxInvoice ${invoiceId} status updated to ${status}`);
  }

  /**
   * 여러 세금계산서 상태 일괄 업데이트
   */
  async updateManyStatuses(
    invoiceIds: string[],
    status: string,
    additionalData: Partial<UpdateTaxInvoice>,
    tx: WalletExecutor,
  ): Promise<void> {
    if (invoiceIds.length === 0) return;

    await tx
      .update(schema.taxInvoices)
      .set({ status, ...additionalData, updatedAt: new Date() })
      .where(inArray(schema.taxInvoices.id, invoiceIds));

    this.logger.log(
      `${invoiceIds.length} TaxInvoices updated to status ${status}`,
    );
  }

  /**
   * 사용자별 세금계산서 목록 조회
   */
  async findByUserId(params: {
    userId: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    const conditions = [eq(schema.taxInvoices.userId, params.userId)];

    if (params.status) {
      conditions.push(eq(schema.taxInvoices.status, params.status));
    }
    if (params.fromDate) {
      conditions.push(gte(schema.taxInvoices.supplyDate, params.fromDate));
    }
    if (params.toDate) {
      conditions.push(lte(schema.taxInvoices.supplyDate, params.toDate));
    }

    return await this.db.db
      .select()
      .from(schema.taxInvoices)
      .where(and(...conditions))
      .orderBy(sql`${schema.taxInvoices.createdAt} DESC`)
      .limit(params.limit)
      .offset(params.offset);
  }

  /**
   * 관리자용 세금계산서 목록 조회
   */
  async findAll(params: {
    status?: string;
    userId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    const conditions: SQL<unknown>[] = [];

    if (params.status) {
      conditions.push(eq(schema.taxInvoices.status, params.status));
    }
    if (params.userId) {
      conditions.push(eq(schema.taxInvoices.userId, params.userId));
    }
    if (params.fromDate) {
      conditions.push(gte(schema.taxInvoices.supplyDate, params.fromDate));
    }
    if (params.toDate) {
      conditions.push(lte(schema.taxInvoices.supplyDate, params.toDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db.db
      .select()
      .from(schema.taxInvoices)
      .where(whereClause)
      .orderBy(sql`${schema.taxInvoices.createdAt} DESC`)
      .limit(params.limit)
      .offset(params.offset);
  }

  /**
   * 발행 대기 중인 세금계산서 목록 조회 (REQUESTED 상태)
   */
  async findRequested(limit: number, offset: number): Promise<TaxInvoice[]> {
    return await this.db.db
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.status, 'REQUESTED'))
      .orderBy(sql`${schema.taxInvoices.createdAt} ASC`)
      .limit(limit)
      .offset(offset);
  }

  /**
   * 홈택스 발행번호로 조회 (중복 체크용)
   */
  async findByHometaxIssueNo(
    hometaxIssueNo: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    const executor = tx || this.db.db;
    const [invoice] = await executor
      .select()
      .from(schema.taxInvoices)
      .where(eq(schema.taxInvoices.hometaxIssueNo, hometaxIssueNo))
      .limit(1);
    return invoice ?? null;
  }

  /**
   * 세금계산서 삭제 (소프트 삭제가 아닌 실제 삭제 - 개발 환경에서만 사용)
   */
  async delete(invoiceId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .delete(schema.taxInvoices)
      .where(eq(schema.taxInvoices.id, invoiceId));

    this.logger.warn(`TaxInvoice deleted: ${invoiceId}`);
  }

  // ========================================
  // 스냅샷 메소드
  // ========================================

  /**
   * 세금계산서 ID로 스냅샷 조회
   */
  async findSnapshotByInvoiceId(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceSnapshot | null> {
    const executor = tx || this.db.db;
    const [snapshot] = await executor
      .select()
      .from(schema.taxInvoiceSnapshots)
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId))
      .limit(1);
    return snapshot ?? null;
  }

  /**
   * 스냅샷 생성 (홈택스 제출용 완전한 데이터)
   */
  async createSnapshot(
    data: NewTaxInvoiceSnapshot,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceSnapshot> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.taxInvoiceSnapshots)
      .values(data)
      .returning();

    this.logger.log(
      `TaxInvoiceSnapshot created for invoice: ${created.invoiceId}`,
    );
    return created;
  }

  /**
   * 스냅샷 업데이트 (부분 환불 등으로 금액 변경 시)
   */
  async updateSnapshot(
    invoiceId: string,
    payload: TaxInvoiceSnapshotPayload,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.taxInvoiceSnapshots)
      .set({ payload: payload as any })
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId));

    this.logger.log(`TaxInvoiceSnapshot updated for invoice: ${invoiceId}`);
  }

  /**
   * 스냅샷 삭제
   */
  async deleteSnapshot(invoiceId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .delete(schema.taxInvoiceSnapshots)
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId));

    this.logger.warn(`TaxInvoiceSnapshot deleted for invoice: ${invoiceId}`);
  }

  // ========================================
  // 감사 이벤트 메소드
  // ========================================

  /**
   * 감사 이벤트 생성
   */
  async createEvent(
    data: NewTaxInvoiceEvent,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceEvent> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.taxInvoiceEvents)
      .values(data)
      .returning();

    this.logger.log(
      `TaxInvoiceEvent logged: ${created.eventType} for invoice ${created.invoiceId}`,
    );
    return created;
  }

  /**
   * 특정 세금계산서의 모든 이벤트 조회
   */
  async findEventsByInvoiceId(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceEvent[]> {
    const executor = tx || this.db.db;
    return await executor
      .select()
      .from(schema.taxInvoiceEvents)
      .where(eq(schema.taxInvoiceEvents.invoiceId, invoiceId))
      .orderBy(desc(schema.taxInvoiceEvents.createdAt));
  }

  /**
   * 특정 이벤트 타입으로 조회
   */
  async findEventsByType(
    eventType: string,
    limit: number = 100,
  ): Promise<TaxInvoiceEvent[]> {
    return await this.db.db
      .select()
      .from(schema.taxInvoiceEvents)
      .where(eq(schema.taxInvoiceEvents.eventType, eventType))
      .orderBy(desc(schema.taxInvoiceEvents.createdAt))
      .limit(limit);
  }

  // ========================================
  // 사용자 기본 설정 메소드
  // ========================================

  /**
   * 사용자 ID로 기본 설정 조회
   */
  async findPreferenceByUserId(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference | null> {
    const executor = tx || this.db.db;
    const [preference] = await executor
      .select()
      .from(schema.userTaxInvoicePreferences)
      .where(eq(schema.userTaxInvoicePreferences.userId, userId))
      .limit(1);
    return preference ?? null;
  }

  /**
   * 기본 설정 생성
   */
  async createPreference(
    data: NewUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.userTaxInvoicePreferences)
      .values(data)
      .returning();

    this.logger.log(`TaxInvoicePreference created for user: ${created.userId}`);
    return created;
  }

  /**
   * 기본 설정 업데이트
   */
  async updatePreference(
    userId: string,
    data: UpdateUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.userTaxInvoicePreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.userTaxInvoicePreferences.userId, userId));

    this.logger.log(`TaxInvoicePreference updated for user: ${userId}`);
  }

  /**
   * 기본 설정 생성 또는 업데이트 (Upsert)
   */
  async upsertPreference(
    data: NewUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    const executor = tx || this.db.db;
    const [result] = await executor
      .insert(schema.userTaxInvoicePreferences)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userTaxInvoicePreferences.userId,
        set: {
          defaultEnabled: data.defaultEnabled,
          defaultBusinessInfo: data.defaultBusinessInfo as any,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.logger.log(`TaxInvoicePreference upserted for user: ${result.userId}`);
    return result;
  }

  /**
   * 기본 설정 삭제
   */
  async deletePreference(userId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .delete(schema.userTaxInvoicePreferences)
      .where(eq(schema.userTaxInvoicePreferences.userId, userId));

    this.logger.warn(`TaxInvoicePreference deleted for user: ${userId}`);
  }
}
