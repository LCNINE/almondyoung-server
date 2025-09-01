import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { UpdateBusinessLicenseDtoWithReviewCommentAndStatus } from '../../business-licenses/dto/update-business-license.dto';
import { BusinessLicenseQueryDto } from './dto/pagination-query-dto';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<schema.BusinessLicense>,
  ) {}

  async getBusinessLicenses({
    businessLicenseQueryDto,
  }: {
    businessLicenseQueryDto: BusinessLicenseQueryDto;
  }): Promise<schema.BusinessLicense[]> {
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
        whereConditions.push(
          isNotNull(schema.businessLicenses.verificationFile),
        );
      }
      if (Daterange) {
        whereConditions.push(
          and(
            gte(schema.businessLicenses.createdAt, Daterange.startRange),
            lte(schema.businessLicenses.createdAt, Daterange.endRange),
          ),
        );
      }

      const query = this.dbService.db
        .select()
        .from(schema.businessLicenses)
        .where(and(...whereConditions))
        .orderBy(
          sortBy === 'createdAt'
            ? asc(schema.businessLicenses.createdAt)
            : desc(schema.businessLicenses.createdAt),
        )
        .limit(limit)
        .offset(offset);

      return query;
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
