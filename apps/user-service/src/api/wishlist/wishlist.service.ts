import { DbService, InjectDb } from '@app/db';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import * as schema from 'apps/user-service/database/drizzle/schema';
import {
  type UserServiceSchema
} from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq } from 'drizzle-orm';
import { AddToWishlistDto } from './dto/wishlist.dto';

@Injectable()
export class WishlistService {


  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) { }

  async toggleWishlist(userId: string, { productId }: AddToWishlistDto) {
    const existing = await this.dbService.db
      .select()
      .from(schema.wishlist)
      .where(
        and(
          eq(schema.wishlist.userId, userId),
          eq(schema.wishlist.productId, productId),
        ),
      )
      .limit(1);



    // 이미 찜목록에 있으면 제거
    if (existing.length > 0) {
      await this.dbService.db
        .delete(schema.wishlist)
        .where(
          and(
            eq(schema.wishlist.userId, userId),
            eq(schema.wishlist.productId, productId),
          ),
        );

      return {
        action: 'removed',
        message: '찜 목록에서 제거되었습니다.',
      };
    }



    // 찜목록에 없으면 추가
    const result = await this.dbService.db
      .insert(schema.wishlist)
      .values({
        userId,
        productId,
      })
      .returning();

    return {
      action: 'added',
      message: '찜 목록에 추가되었습니다.',
      data: result[0],
    };
  }

  async getWishlistByUserId(userId: string): Promise<schema.Wishlist[]> {
    const wishlist = await this.dbService.db
      .select()
      .from(schema.wishlist)
      .where(eq(schema.wishlist.userId, userId))
      .orderBy(desc(schema.wishlist.createdAt));

    return wishlist;
  }

  async getWishlistByProductId(
    userId: string,
    productId: string,
  ): Promise<schema.Wishlist[]> {
    const wishlist = await this.dbService.db
      .select()
      .from(schema.wishlist)
      .where(
        and(
          eq(schema.wishlist.userId, userId),
          eq(schema.wishlist.productId, productId),
        ),
      );

    return wishlist;
  }
}
