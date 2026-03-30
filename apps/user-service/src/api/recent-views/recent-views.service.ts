import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq, lt } from 'drizzle-orm';
import { AddToRecentViewsDto } from './dto/recent-views.dto';

@Injectable()
export class RecentViewsService {
  private readonly logger = new Logger(RecentViewsService.name);

  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async addToRecentViews(userId: string, { productId }: AddToRecentViewsDto): Promise<{ message: string }> {
    await this.dbService.db
      .insert(schema.userRecentViews)
      .values({ userId, productId })
      .onConflictDoUpdate({
        target: [schema.userRecentViews.userId, schema.userRecentViews.productId],
        set: { updatedAt: new Date() },
      });

    return { message: '최근 본 상품이 추가되었습니다.' };
  }

  async getRecentViews(userId: string, limit: number = 20): Promise<schema.RecentView[]> {
    const recentViews = await this.dbService.db
      .select()
      .from(schema.userRecentViews)
      .where(eq(schema.userRecentViews.userId, userId))
      .orderBy(desc(schema.userRecentViews.updatedAt))
      .limit(limit);

    return recentViews;
  }

  async removeRecentViewByUserIdAndRecentViewId(userId: string, recentViewId: string): Promise<{ message: string }> {
    const existingView = await this.dbService.db
      .select()
      .from(schema.userRecentViews)
      .where(and(eq(schema.userRecentViews.userId, userId), eq(schema.userRecentViews.id, recentViewId)))
      .limit(1);

    if (!existingView.length) {
      throw new NotFoundException('해당 상품이 최근 본 상품 목록에 존재하지 않습니다.');
    }

    await this.dbService.db
      .delete(schema.userRecentViews)
      .where(and(eq(schema.userRecentViews.userId, userId), eq(schema.userRecentViews.id, recentViewId)));

    return { message: '최근 본 상품이 제거되었습니다.' };
  }

  /**
   * 30일 이상 조회하지 않은 최근 본 상품 기록 삭제
   * 매일 새벽 3시 실행
   */
  @Cron('0 3 * * *')
  async cleanupOldRecentViews(): Promise<void> {
    this.logger.log('30일 이상 조회하지 않은 최근 본 상품 삭제 작업 시작');

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      await this.dbService.db
        .delete(schema.userRecentViews)
        .where(lt(schema.userRecentViews.updatedAt, thirtyDaysAgo));

      this.logger.log('30일 이상 조회하지 않은 최근 본 상품 삭제 완료');
    } catch (error) {
      this.logger.error('최근 본 상품 삭제 작업 중 오류 발생', error);
    }
  }
}
