import { Injectable } from '@nestjs/common';
import { eq, and, or, gte, lte, isNull, sql, SQL } from 'drizzle-orm';
import { DbService, InjectDb } from '@app/db';
import { membershipMappings, type PimSchema } from '../schema';
import {
  MembershipMapping,
  NewMembershipMapping,
  UpdateMembershipMapping,
  DbTransaction,
} from '../types';

type DbTx = Parameters<
  Parameters<DbService<PimSchema>['db']['transaction']>[0]
>[0];

@Injectable()
export class MembershipMappingsRepository {
  constructor(private readonly db: DbService<PimSchema>) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  /**
   * 멤버십 매핑 생성
   */
  async create(
    data: Partial<NewMembershipMapping>,
    tx?: DbTransaction,
  ): Promise<MembershipMapping> {
    const client = this.getClient(tx);

    const [created] = await client
      .insert(membershipMappings)
      .values({
        masterId: data.masterId || null,
        variantId: data.variantId || null,
        membershipTierId: data.membershipTierId!,
        price: data.price || null,
        discount: data.discount || null,
        visibilityOnly: data.visibilityOnly || false,
        validFrom: data.validFrom || new Date(),
        validTo: data.validTo || null,
      })
      .returning();

    return created;
  }

  /**
   * ID로 매핑 조회
   */
  async findById(
    id: string,
    tx?: DbTransaction,
  ): Promise<MembershipMapping | null> {
    const client = this.getClient(tx);

    const [mapping] = await client
      .select()
      .from(membershipMappings)
      .where(eq(membershipMappings.id, id))
      .limit(1);

    return mapping || null;
  }

  /**
   * 대상과 티어로 매핑 조회 (중복 확인용)
   */
  async findByTargetAndTier(
    scope: 'master' | 'variant',
    targetId: string,
    membershipTierId: string,
    tx?: DbTransaction,
  ): Promise<MembershipMapping | null> {
    const client = this.getClient(tx);

    const whereCondition =
      scope === 'master'
        ? and(
            eq(membershipMappings.masterId, targetId),
            eq(membershipMappings.membershipTierId, membershipTierId),
          )
        : and(
            eq(membershipMappings.variantId, targetId),
            eq(membershipMappings.membershipTierId, membershipTierId),
          );

    const [mapping] = await client
      .select()
      .from(membershipMappings)
      .where(whereCondition)
      .limit(1);

    return mapping || null;
  }

  /**
   * 활성 매핑 조회 (유효기간 확인)
   */
  async findActiveMapping(
    scope: 'master' | 'variant',
    targetId: string,
    membershipTierId: string,
    currentTime: Date = new Date(),
    tx?: DbTransaction,
  ): Promise<MembershipMapping | null> {
    const client = this.getClient(tx);

    const targetCondition =
      scope === 'master'
        ? eq(membershipMappings.masterId, targetId)
        : eq(membershipMappings.variantId, targetId);

    const [mapping] = await client
      .select()
      .from(membershipMappings)
      .where(
        and(
          targetCondition,
          eq(membershipMappings.membershipTierId, membershipTierId),
          lte(membershipMappings.validFrom, currentTime),
          or(
            isNull(membershipMappings.validTo),
            gte(membershipMappings.validTo, currentTime),
          ),
        ),
      )
      .limit(1);

    return mapping || null;
  }

  /**
   * 가시성 전용 매핑들 조회
   */
  async findVisibilityMappings(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<MembershipMapping[]> {
    const client = this.getClient(tx);

    return await client
      .select()
      .from(membershipMappings)
      .where(
        and(
          eq(membershipMappings.masterId, masterId),
          eq(membershipMappings.visibilityOnly, true),
        ),
      );
  }

  /**
   * 대상별 매핑 목록 조회
   */
  async findByTarget(
    scope: 'master' | 'variant',
    targetId: string,
    tx?: DbTransaction,
  ): Promise<MembershipMapping[]> {
    const client = this.getClient(tx);

    const whereCondition =
      scope === 'master'
        ? eq(membershipMappings.masterId, targetId)
        : eq(membershipMappings.variantId, targetId);

    return await client
      .select()
      .from(membershipMappings)
      .where(whereCondition)
      .orderBy(membershipMappings.createdAt);
  }

  /**
   * 페이징된 매핑 목록 조회
   */
  async findPaginated(params: {
    scope?: 'master' | 'variant';
    targetId?: string;
    membershipTierId?: string;
    page: number;
    limit: number;
    tx?: DbTransaction;
  }): Promise<{
    data: MembershipMapping[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { scope, targetId, membershipTierId, page, limit, tx } = params;
    const client = this.getClient(tx);
    const offset = (page - 1) * limit;

    let whereConditions: SQL[] = [];

    if (scope && targetId) {
      const targetCondition =
        scope === 'master'
          ? eq(membershipMappings.masterId, targetId)
          : eq(membershipMappings.variantId, targetId);
      whereConditions.push(targetCondition);
    }

    if (membershipTierId) {
      whereConditions.push(
        eq(membershipMappings.membershipTierId, membershipTierId),
      );
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // 데이터 조회
    const data = await client
      .select()
      .from(membershipMappings)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(membershipMappings.createdAt);

    // 총 개수 조회
    const [countResult] = await client
      .select({ count: sql<number>`count(*)` })
      .from(membershipMappings)
      .where(whereClause);

    return {
      data,
      total: countResult.count,
      page,
      limit,
    };
  }

  /**
   * 매핑 수정
   */
  async update(
    id: string,
    data: UpdateMembershipMapping,
    tx?: DbTransaction,
  ): Promise<MembershipMapping> {
    const client = this.getClient(tx);

    const [updated] = await client
      .update(membershipMappings)
      .set({
        price: data.price,
        discount: data.discount,
        visibilityOnly: data.visibilityOnly,
        validFrom: data.validFrom,
        validTo: data.validTo,
      })
      .where(eq(membershipMappings.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Membership mapping not found: ${id}`);
    }

    return updated;
  }

  /**
   * 매핑 삭제
   */
  async delete(id: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const result = await client
      .delete(membershipMappings)
      .where(eq(membershipMappings.id, id))
      .returning({ id: membershipMappings.id });

    if (result.length === 0) {
      throw new Error(`Membership mapping not found: ${id}`);
    }
  }

  /**
   * 대상별 모든 매핑 삭제 (상품/변형 삭제 시 사용)
   */
  async deleteByTarget(
    scope: 'master' | 'variant',
    targetId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);

    const whereCondition =
      scope === 'master'
        ? eq(membershipMappings.masterId, targetId)
        : eq(membershipMappings.variantId, targetId);

    await client.delete(membershipMappings).where(whereCondition);
  }

  /**
   * 매핑 존재 확인
   */
  async exists(
    scope: 'master' | 'variant',
    targetId: string,
    membershipTierId: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
    const mapping = await this.findByTargetAndTier(
      scope,
      targetId,
      membershipTierId,
      tx,
    );
    return mapping !== null;
  }
}
