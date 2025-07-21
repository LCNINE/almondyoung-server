import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../shared/schemas/schema'; // DB 스키마
import { ulid } from 'ulid';
import { and, eq, SQL, desc, lt } from 'drizzle-orm';
import { Cron } from '@nestjs/schedule';

// 💡 1. 역할에 맞는 타입을 명확하게 import 합니다.
// 서비스 로직을 위한 순수 타입만 가져옵니다.

import * as invoiceZod from '../shared/zod/invoice.zod';
const INVOICE_EXPIRATION_MINUTES = 30;

@Injectable()
export class InvoiceService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 데이터베이스에서 관계(events)를 포함한 순수 Invoice 데이터를 조회합니다.
   * @param id Invoice ID
   * @returns 관계가 포함된 Invoice 객체 또는 null
   */
  private async findOneRaw(
    id: string,
  ): Promise<invoiceZod.Invoice['Select'] | null> {
    const result = await this.dbService.db.query.invoice.findFirst({
      where: eq(schema.invoice.id, id),
      with: {
        events: {
          orderBy: [desc(schema.invoiceEvent.occurredAt)],
        },
      },
    });
    // Drizzle-ORM의 타입과 우리 Zod 타입을 맞추기 위해 캐스팅이 필요할 수 있습니다.
    // 이 단계에서는 TypeScript의 타입 시스템을 신뢰합니다.
    return (result as invoiceZod.Invoice['Select']) ?? null;
  }

  /**
   * 단일 Invoice를 조회하여 반환합니다.
   * @param id Invoice ID
   * @returns Invoice 객체 또는 null
   */
  async findOne(id: string): Promise<invoiceZod.Invoice['Select'] | null> {
    return this.findOneRaw(id);
  }

  /**
   * 여러 Invoice를 조회하여 반환합니다.
   * @param userId (선택) 사용자 ID
   * @param status (선택) Invoice 상태
   * @returns Invoice 객체 배열
   */
  async findAll(
    userId?: string,
    status?: schema.InvoiceStatus,
  ): Promise<invoiceZod.Invoice['Select'][]> {
    const conditions: SQL[] = [];
    if (userId) {
      conditions.push(eq(schema.invoice.userId, userId));
    }
    if (status) {
      conditions.push(eq(schema.invoice.status, status));
    }

    const results = await this.dbService.db.query.invoice.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        events: {
          orderBy: [desc(schema.invoiceEvent.occurredAt)],
        },
      },
    });

    return results;
  }

  /**
   * 새로운 Invoice를 생성합니다.
   * @param payload API 요청으로 들어온, 생성을 위한 순수 데이터 객체
   * @returns 생성된 Invoice 객체
   */
  async create(
    payload: invoiceZod.Invoice['Create'],
  ): Promise<invoiceZod.Invoice['Select']> {
    const { userId, invoiceType, amount, currency, dueAt } = payload;
    const now = new Date();

    const newInvoice = await this.dbService.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.invoice)
        .values({
          userId,
          invoiceType,
          amount,
          currency,
          dueAt: dueAt ? new Date(dueAt) : undefined, // 반드시 Date 객체로 변환
          status: 'ISSUED',
          issuedAt: now,
          expiresAt: this.calculateExpirationTime(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(schema.invoiceEvent).values({
        invoiceId: created.id,
        eventType: 'ISSUED',
        occurredAt: now,
        eventUuid: ulid(),
        createdAt: now,
      });

      return created;
    });

    // 💡 생성 후 findOne을 재사용하여 일관된 객체를 반환합니다.
    const result = await this.findOne(newInvoice.id);
    if (!result) {
      // 이 에러는 발생해서는 안됩니다 (트랜잭션이 성공했으므로).
      throw new InternalServerErrorException(
        'Could not retrieve invoice after creation.',
      );
    }
    return result;
  }

  /**
   * Invoice의 상태를 업데이트합니다.
   * @param id Invoice ID
   * @param payload 상태 업데이트에 필요한 순수 데이터 객체
   * @returns 업데이트된 Invoice 객체
   */
  async updateStatus(
    id: string,
    payload: invoiceZod.Invoice['UpdateStatus'],
  ): Promise<invoiceZod.Invoice['Select']> {
    const { status, reason } = payload;
    const now = new Date();

    await this.dbService.db.transaction(async (tx) => {
      // 먼저 대상 인보이스가 존재하는지 확인하여 안정성을 높입니다.
      const existingInvoice = await tx.query.invoice.findFirst({
        where: eq(schema.invoice.id, id),
        columns: { id: true },
      });

      if (!existingInvoice) {
        throw new NotFoundException(`Invoice with ID ${id} not found.`);
      }

      await tx
        .update(schema.invoice)
        .set({ status, updatedAt: now })
        .where(eq(schema.invoice.id, id));

      await tx.insert(schema.invoiceEvent).values({
        invoiceId: id,
        eventType: status,
        reason,
        occurredAt: now,
        eventUuid: ulid(),
        createdAt: now,
      });
    });

    // 💡 업데이트 후 findOne을 재사용하여 일관된 객체를 반환합니다.
    const result = await this.findOne(id);
    // 트랜잭션이 성공하면 null이 될 수 없으므로 Non-null assertion(!) 사용이 비교적 안전합니다.
    return result!;
  }

  /**
   * 만료된 Invoice를 찾아 상태를 'EXPIRED'로 변경하는 Cron Job
   */
  @Cron('*/10 * * * * *') // 예시: 매 10초마다 실행
  async handleExpiredInvoices() {
    const now = new Date();
    const expiredInvoices = await this.dbService.db.query.invoice.findMany({
      where: and(
        eq(schema.invoice.status, 'ISSUED'),
        lt(schema.invoice.expiresAt, now),
      ),
      columns: { id: true },
    });

    // Promise.all을 사용하여 여러 업데이트를 병렬로 처리합니다.
    await Promise.all(
      expiredInvoices.map((invoice) =>
        this.updateStatus(invoice.id, {
          status: 'EXPIRED',
          reason: 'Invoice expired automatically.',
        }),
      ),
    );
  }

  // --- Private Helper Methods ---

  private calculateExpirationTime(): Date {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + INVOICE_EXPIRATION_MINUTES);
    return expiresAt;
  }
}
