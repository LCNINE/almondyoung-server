import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
} from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { UpdateBusinessLicenseDtoWithReviewCommentAndStatus } from '../../business-licenses/dto/update-business-license.dto';
import { BusinessLicenseQueryDto } from './dto/pagination-query-dto';
import {
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { BusinessLicenseResponseDto } from '../../business-licenses/dto/business-license.response.dto';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async getBusinessLicensesByUserId(
    userId: string,
  ): Promise<BusinessLicenseResponseDto | null> {
    const [result] = await this.dbService.db
      .select()
      .from(userServiceSchema.businessLicenses)
      .where(eq(userServiceSchema.businessLicenses.userId, userId))
      .limit(1);

    return result ?? null;
  }

  async getBusinessLicenses({
    businessLicenseQueryDto,
  }: {
    businessLicenseQueryDto: BusinessLicenseQueryDto;
  }): Promise<{
    data: schema.BusinessLicense[];
    total: number;
    page: number;
    limit: number;
  }> {
    const {
      search,
      sortBy,
      sortOrder,
      hasShopId,
      status,
      Daterange,
      hasVerificationFile,
    } = businessLicenseQueryDto;

    const page = businessLicenseQueryDto.page || 1;
    const limit = Math.min(businessLicenseQueryDto.limit || 20, 100);
    const offset = (page - 1) * limit;

    const whereConditions: any[] = [];

    try {
      if (search) {
        if (search.businessNumber) {
          whereConditions.push(
            eq(schema.businessLicenses.businessNumber, search.businessNumber),
          );
        }
        if (search.representativeName) {
          whereConditions.push(
            eq(
              schema.businessLicenses.representativeName,
              search.representativeName,
            ),
          );
        }
        if (search.id) {
          whereConditions.push(eq(schema.businessLicenses.id, search.id));
        }
      }

      if (hasShopId) {
        whereConditions.push(isNotNull(schema.businessLicenses.shopId));
      }
      if (status && status.length > 0) {
        whereConditions.push(inArray(schema.businessLicenses.status, status));
      }
      if (hasVerificationFile) {
        whereConditions.push(isNotNull(schema.businessLicenses.file));
      }
      if (Daterange) {
        whereConditions.push(
          and(
            gte(schema.businessLicenses.createdAt, Daterange.startRange),
            lte(schema.businessLicenses.createdAt, Daterange.endRange),
          ),
        );
      }

      const whereClause = and(...whereConditions);

      // total count
      const countQuery = this.dbService.db
        .select({ count: count() })
        .from(schema.businessLicenses)
        .where(whereClause);
      const [{ count: total }] = await countQuery;

      // data query
      const orderExpr =
        sortBy === 'createdAt'
          ? asc(schema.businessLicenses.createdAt)
          : desc(schema.businessLicenses.createdAt);

      const dataQuery = this.dbService.db
        .select()
        .from(schema.businessLicenses)
        .where(whereClause)
        .orderBy(orderExpr)
        .limit(limit)
        .offset(offset);

      const data = await dataQuery;

      return { data, total, page, limit };
    } catch (error) {
      console.log('error::', error);
      throw new BadRequestException(
        '사업자 등록 정보를 조회하는 중 오류가 발생했습니다.',
      );
    }
  }

  async getBusinessLicenseByBusinessLicenseId(
    id: string,
  ): Promise<schema.BusinessLicense | null> {
    try {
      const [query] = await this.dbService.db
        .select()
        .from(schema.businessLicenses)
        .where(eq(schema.businessLicenses.id, id));

      return query;
    } catch (error) {
      throw new BadRequestException(
        '해당 사업자 등록 정보를 찾을 수 없습니다.',
      );
    }
  }

  async updateBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    updateBusinessLicenseDto: UpdateBusinessLicenseDtoWithReviewCommentAndStatus,
  ): Promise<void> {
    try {
      const [query] = await this.dbService.db
        .update(schema.businessLicenses)
        .set(updateBusinessLicenseDto)
        .where(eq(schema.businessLicenses.id, businessLicenseId));

      return;
    } catch (error) {
      console.log('error::', error);
      throw new BadRequestException(
        '사업자 등록 정보를 수정하는 중 오류가 발생했습니다.',
      );
    }
  }

  async deleteBusinessLicenseById(id: string): Promise<void> {
    try {
      const existingBusinessLicense =
        await this.getBusinessLicenseByBusinessLicenseId(id);

      if (!existingBusinessLicense) {
        throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
      }

      await this.dbService.db
        .delete(schema.businessLicenses)
        .where(eq(schema.businessLicenses.id, id));

      return;
    } catch (error) {
      console.log('error::', error);
      throw new BadRequestException(
        error.message ?? '사업자 등록 정보를 삭제하는 중 오류가 발생했습니다.',
      );
    }
  }
}
