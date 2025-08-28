import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import {
  BusinessLicense,
  businessLicenses,
} from '../../../database/drizzle/schema';
import { CreateBusinessLicenseDto } from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<schema.BusinessLicense>,
  ) {}

  async findBusinessLicenseByUserId(
    id: string,
  ): Promise<BusinessLicense | null> {
    try {
      const [registration] = await this.dbService.db
        .select()
        .from(businessLicenses)
        .where(eq(businessLicenses.userId, id))
        .limit(1);

      return registration ?? null;
    } catch (error) {
      throw new BadRequestException(
        '사업자 등록 정보를 조회하는 중 오류가 발생했습니다.',
      );
    }
  }

  async createBusinessLicense(
    data: CreateBusinessLicenseDto,
    userId: string,
  ): Promise<void> {
    try {
      const [registration] = await this.dbService.db
        .insert(businessLicenses)
        .values({ ...data, userId })
        .returning();

      return;
    } catch (error) {
      throw new BadRequestException(
        '사업자 등록 정보를 생성하는 중 오류가 발생했습니다.',
      );
    }
  }

  async updateBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    data: UpdateBusinessLicenseDto,
    userId: string,
  ): Promise<void> {
    const [registration] = await this.dbService.db
      .update(businessLicenses)
      .set(data)
      .where(
        and(
          eq(businessLicenses.id, businessLicenseId),
          eq(businessLicenses.userId, userId),
        ),
      )
      .returning();

    if (!registration) {
      throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
    }

    return;
  }

  async deleteBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.dbService.db
        .delete(businessLicenses)
        .where(
          and(
            eq(businessLicenses.id, businessLicenseId),
            eq(businessLicenses.userId, userId),
          ),
        );

      return;
    } catch (error) {
      throw new BadRequestException(
        '사업자 등록 정보를 삭제하는 중 오류가 발생했습니다.',
      );
    }
  }
}
