import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc } from 'drizzle-orm';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { AddToWishlistDto } from './dto/wishlist.dto';
import { DbService, InjectDb } from '@app/db';

@Injectable()
export class WishlistService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  async addToWishlist(userId: string, { productId }: AddToWishlistDto) {
    const result = await this.dbService.db
      .insert(schema.wishlist)
      .values({
        userId,
        productId,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw new ConflictException('이미 찜 목록에 존재하는 상품입니다.');
    }

    return { message: '상품이 찜 목록에 추가되었습니다.' };
  }

  async getWishlistByUserId(userId: string): Promise<schema.Wishlist[]> {
    const wishlist = await this.dbService.db
      .select()
      .from(schema.wishlist)
      .where(eq(schema.wishlist.userId, userId))
      .orderBy(desc(schema.wishlist.createdAt));

    return wishlist;
  }

  async removeWishlistByUserIdAndWishlistId(
    userId: string,
    wishlistId: string,
  ): Promise<{ message: string }> {
    const existingWishlist = await this.dbService.db
      .select()
      .from(schema.wishlist)
      .where(
        and(
          eq(schema.wishlist.id, wishlistId),
          eq(schema.wishlist.userId, userId),
        ),
      )
      .limit(1);

    if (!existingWishlist.length) {
      throw new NotFoundException('해당 찜 항목을 찾을 수 없습니다.');
    }

    await this.dbService.db
      .delete(schema.wishlist)
      .where(
        and(
          eq(schema.wishlist.id, wishlistId),
          eq(schema.wishlist.userId, userId),
        ),
      );

    return { message: '찜 목록에서 제거되었습니다.' };
  }
}
