import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx } from '../../../database/schemas/db.types';
import { OutboxDemoSchema, testRecords } from '../../../database/schemas/schema';
import { OutboxPublisher } from '@app/events';
import { CreateTestRecordDto } from '../dto/create-test-record.dto';

@Injectable()
export class TestService {
  private readonly logger = new Logger(TestService.name);

  constructor(
    private readonly dbService: DbService<OutboxDemoSchema>,
    private readonly outboxPublisher: OutboxPublisher,
  ) { }

  private get db() {
    return this.dbService.db;
  }

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
        .insert(testRecords)
        .values({
          name: dto.name,
          description: dto.description ?? '',
          status: 'ACTIVE',
        })
        .returning();

      this.logger.log(`✅ Test record created: id=${record.id}`);

      // 2. Outbox에 이벤트 저장 (발행 대기열) - 새 구현 사용
      await this.outboxPublisher.saveEvent({
        topic: 'test.events.v1',
        eventType: 'TestRecordCreated',
        aggregateType: 'TestRecord',
        aggregateId: record.id.toString(),
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
      }, tx);

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
        .update(testRecords)
        .set({
          status: 'DELETED',
          updatedAt: new Date(),
        })
        .where(eq(testRecords.id, id))
        .returning();

      if (!record) {
        throw new Error(`Test record not found: id=${id}`);
      }

      this.logger.log(`✅ Test record deleted: id=${id}`);

      // 2. Outbox에 삭제 이벤트 저장 - 새 구현 사용
      await this.outboxPublisher.saveEvent({
        topic: 'test.events.v1',
        eventType: 'TestRecordDeleted',
        aggregateType: 'TestRecord',
        aggregateId: record.id.toString(),
        payload: {
          id: record.id,
          deletedAt: new Date().toISOString(),
        },
      }, tx);

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
      .from(testRecords)
      .orderBy(testRecords.createdAt);

    return records;
  }

  /**
   * 특정 테스트 레코드 조회
   */
  async getTestRecordById(id: number) {
    const [record] = await this.db
      .select()
      .from(testRecords)
      .where(eq(testRecords.id, id));

    return record;
  }
}
