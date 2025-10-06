import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DbTx } from '../../../database/schemas/demo-schema';
import { test_records } from '../../../database/schemas/test.schema';
import { outbox_events } from '../../../database/schemas/outbox.schema';
import { CreateTestRecordDto } from '../dto/create-test-record.dto';

@Injectable()
export class TestService {
  private readonly logger = new Logger(TestService.name);

  constructor(
    @Inject('DATABASE') private readonly db: Database,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * 테스트 레코드 생성 + Outbox에 이벤트 저장
   *
   * 이 메서드는 Transactional Outbox 패턴을 실증합니다:
   * 1. 비즈니스 데이터 (test_records)
   * 2. 이벤트 (outbox_events)
   * 를 같은 트랜잭션에 저장하여 원자성을 보장합니다.
   */
  async createTestRecord(dto: CreateTestRecordDto, tx?: DbTx) {
    return this.inTx(async (tx) => {
      this.logger.log(`Creating test record: ${dto.name}`);

      // 1. 비즈니스 로직 - 테스트 레코드 저장 (Source of Truth)
      const [record] = await tx
        .insert(test_records)
        .values({
          name: dto.name,
          description: dto.description ?? '',
          status: 'ACTIVE',
        })
        .returning();

      this.logger.log(`✅ Test record created: id=${record.id}`);

      // 2. Outbox에 이벤트 저장 (발행 대기열)
      await tx.insert(outbox_events).values({
        aggregateType: 'TestRecord',
        aggregateId: record.id.toString(),
        eventType: 'TestRecordCreated',
        payload: {
          id: record.id,
          name: record.name,
          description: record.description,
          status: record.status,
          createdAt: record.createdAt.toISOString(),
        },
        metadata: {
          source: 'outbox-demo',
        },
        status: 'PENDING',
      });

      this.logger.log(`📦 Outbox event created for record id=${record.id}`);

      // 3. 트랜잭션 커밋 → 원자적으로 저장!
      return record;
    }, tx);
  }

  /**
   * 테스트 레코드 삭제 + Outbox에 이벤트 저장
   */
  async deleteTestRecord(id: number, tx?: DbTx) {
    return this.inTx(async (tx) => {
      this.logger.log(`Deleting test record: id=${id}`);

      // 1. 레코드 상태 변경
      const [record] = await tx
        .update(test_records)
        .set({
          status: 'DELETED',
          updatedAt: new Date(),
        })
        .where(eq(test_records.id, id))
        .returning();

      if (!record) {
        throw new Error(`Test record not found: id=${id}`);
      }

      this.logger.log(`✅ Test record deleted: id=${id}`);

      // 2. Outbox에 삭제 이벤트 저장
      await tx.insert(outbox_events).values({
        aggregateType: 'TestRecord',
        aggregateId: record.id.toString(),
        eventType: 'TestRecordDeleted',
        payload: {
          id: record.id,
          deletedAt: new Date().toISOString(),
        },
        status: 'PENDING',
      });

      this.logger.log(`📦 Outbox event created for deletion id=${id}`);

      return record;
    }, tx);
  }

  /**
   * 모든 테스트 레코드 조회
   */
  async getAllTestRecords() {
    const records = await this.db
      .select()
      .from(test_records)
      .orderBy(test_records.createdAt);

    return records;
  }

  /**
   * 특정 테스트 레코드 조회
   */
  async getTestRecordById(id: number) {
    const [record] = await this.db
      .select()
      .from(test_records)
      .where(eq(test_records.id, id));

    return record;
  }
}
