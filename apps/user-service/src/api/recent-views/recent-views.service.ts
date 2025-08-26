import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { AddToRecentViewsDto } from './dto/recent-views.dto';
import { DbService, InjectDb } from '@app/db';

@Injectable()
export class RecentViewsService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  async addToRecentViews(
    userId: string,
    { productId }: AddToRecentViewsDto,
  ): Promise<{ message: string }> {
    await this.dbService.db
      .insert(schema.userRecentViews)
      .values({ userId, productId })
      .onConflictDoUpdate({
        target: [
          schema.userRecentViews.userId,
          schema.userRecentViews.productId,
        ],
        set: { updatedAt: new Date() },
      });

    return { message: '최근 본 상품이 추가되었습니다.' };
  }

  async getRecentViews(
    userId: string,
    limit: number = 20,
  ): Promise<schema.RecentView[]> {
    const recentViews = await this.dbService.db
      .select()
      .from(schema.userRecentViews)
      .where(eq(schema.userRecentViews.userId, userId))
      .orderBy(desc(schema.userRecentViews.updatedAt))
      .limit(limit);

    return recentViews;
  }

  async removeRecentViewByUserIdAndRecentViewId(
    userId: string,
    recentViewId: string,
  ): Promise<{ message: string }> {
    const existingView = await this.dbService.db
      .select()
      .from(schema.userRecentViews)
      .where(
        and(
          eq(schema.userRecentViews.userId, userId),
          eq(schema.userRecentViews.id, recentViewId),
        ),
      )
      .limit(1);

    if (!existingView.length) {
      throw new NotFoundException(
        '해당 상품이 최근 본 상품 목록에 존재하지 않습니다.',
      );
    }

    await this.dbService.db
      .delete(schema.userRecentViews)
      .where(
        and(
          eq(schema.userRecentViews.userId, userId),
          eq(schema.userRecentViews.id, recentViewId),
        ),
      );

    return { message: '최근 본 상품이 제거되었습니다.' };
  }
}
