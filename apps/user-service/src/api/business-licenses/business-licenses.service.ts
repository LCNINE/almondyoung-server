import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  BusinessLicense,
  businessLicenses,
  type UserServiceSchema,
} from '../../../database/drizzle/schema';
import { CreateBusinessLicenseWithFileDto } from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async findBusinessLicenseByUserId(
    id: string,
  ): Promise<BusinessLicense | null> {
    try {
      const [result] = await this.dbService.db
        .select()
        .from(businessLicenses)
        .where(eq(businessLicenses.userId, id))
        .limit(1);

      return result ?? null;
    } catch (error) {
      throw new BadRequestException(
        '사업자 등록 정보를 조회하는 중 오류가 발생했습니다.',
      );
    }
  }

  private async findBusinessLicenseByBusinessNumber(
    businessNumber: string,
  ): Promise<BusinessLicense | null> {
    try {
      const [result] = await this.dbService.db
        .select()
        .from(businessLicenses)
        .where(eq(businessLicenses.businessNumber, businessNumber))
        .limit(1);

      return result ?? null;
    } catch (error) {
      throw new BadRequestException(
        '사업자 등록 정보를 조회하는 중 오류가 발생했습니다.',
      );
    }
  }

  // 파일로 사업자 등록요청
  async createWithFile(
    data: CreateBusinessLicenseWithFileDto,
    userId: string,
  ): Promise<void> {
    try {
      const existingBusinessUser =
        await this.findBusinessLicenseByUserId(userId);
      if (existingBusinessUser) {
        throw new ConflictException(
          '이미 해당 사용자에 대한 사업자 등록 정보가 존재합니다.',
        );
      }

      await this.dbService.db
        .insert(businessLicenses)
        .values({
          userId,
          shopId: data.shopId ?? null,
          status: 'under_review',
          file: data.file,
          metadata: data.metadata ? JSON.parse(data.metadata) : null,
        })
        .returning();
    } catch (error: any) {
      console.error('error::', error);

      throw new BadRequestException(
        error.message ??
          '사업자 등록 정보를 생성하는 중 알 수 없는 오류가 발생했습니다.',
      );
    }
  }

  async updateBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    data: UpdateBusinessLicenseDto,
    userId: string,
  ): Promise<void> {
    try {
      const existingBusiness = await this.findBusinessLicenseByUserId(userId);

      if (!existingBusiness) {
        throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
      }

      if (existingBusiness.userId !== userId) {
        throw new BadRequestException(
          '해당 사업자 등록 정보에 대한 권한이 없습니다.',
        );
      }

      // 사업자 증빙 자료가 부족해서 관리자한테 퇴짜맞아서 다시 신청해야하는 경우
      if (existingBusiness.status === 'rejected') {
        await this.dbService.db
          .update(businessLicenses)
          .set({
            file: data.file,
            status: 'under_review',
          })
          .where(eq(businessLicenses.id, businessLicenseId))
          .returning();

        return;
      }

      // 이미 승인되었지만, 정보변경이 필요한 경우
      if (existingBusiness.status === 'approved') {
        await this.dbService.db
          .update(businessLicenses)
          .set({
            ...existingBusiness,
            ...data,
          })
          .where(eq(businessLicenses.id, existingBusiness.id))
          .returning();

        return;
      }
    } catch (error: any) {
      console.error('error::', error);

      throw new BadRequestException(
        error.message ??
          '사업자 등록 정보를 생성하는 중 알 수 없는 오류가 발생했습니다.',
      );
    }
  }

  async deleteBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    userId: string,
  ): Promise<void> {
    try {
      const existingBusiness = await this.findBusinessLicenseByUserId(userId);

      if (!existingBusiness) {
        throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
      }

      if (existingBusiness.userId !== userId) {
        throw new BadRequestException(
          '해당 사업자 등록 정보에 대한 권한이 없습니다.',
        );
      }

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
      console.log('error::', error);

      throw new BadRequestException(
        error.message ?? '사업자 등록 정보를 삭제하는 중 오류가 발생했습니다.',
      );
    }
  }
}
