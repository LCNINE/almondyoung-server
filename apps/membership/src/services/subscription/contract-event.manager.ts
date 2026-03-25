import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, desc, and } from 'drizzle-orm';
import { DrizzleTransaction } from '../../shared/schemas/types';

export interface ContractEvent {
  id: number;
  contractId: string;
  eventType: string;
  userId: string;
  metadata: Record<string, any>;
  batchId: string | null;
  causedBy: string;
  causedByUserId: string | null;
  createdAt: Date;
}

/**
 * ContractEventManager (Implementation Layer)
 *
 * 역할: 구독 계약 이벤트 소싱
 * - 계약 이벤트 기록
 * - 계약 이벤트 조회
 * - 이벤트 타입별 조회
 *
 * 참고: 이것은 Service가 아닌 Implementation Layer의 Manager입니다.
 * 이벤트 소싱 패턴을 위한 유틸리티 클래스로, 다른 Manager들이 사용합니다.
 */
@Injectable()
export class ContractEventManager {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 계약 이벤트 추가
   */
  async addEvent(
    tx: DrizzleTransaction,
    contractId: string,
    eventType: string,
    metadata: Record<string, any>,
    causedBy: string,
    userId: string,
    batchId?: string,
    causedByUserId?: string,
  ): Promise<ContractEvent> {
    const [event] = await tx
      .insert(schema.subscriptionContractEvents)
      .values({
        contractId,
        eventType,
        userId,
        metadata,
        batchId: batchId || null,
        causedBy,
        causedByUserId: causedByUserId || null,
      })
      .returning();

    return event as ContractEvent;
  }

  /**
   * 계약의 모든 이벤트 조회
   */
  async getContractEvents(contractId: string): Promise<ContractEvent[]> {
    const events = await this.dbService.db
      .select()
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.contractId, contractId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));

    return events as ContractEvent[];
  }

  /**
   * 특정 타입 이벤트 조회
   */
  async getEventsByType(contractId: string, eventType: string): Promise<ContractEvent[]> {
    const events = await this.dbService.db
      .select()
      .from(schema.subscriptionContractEvents)
      .where(
        and(
          eq(schema.subscriptionContractEvents.contractId, contractId),
          eq(schema.subscriptionContractEvents.eventType, eventType),
        ),
      )
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));

    return events as ContractEvent[];
  }
}
