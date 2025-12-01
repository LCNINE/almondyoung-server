import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import {
  BusinessLicense,
  businessLicenses,
  type UserServiceSchema,
} from '../../../database/drizzle/schema';
import { BusinessLicensesHelper } from './business-licenses.helper';
import { BusinessLicenseResponseDto, } from './dto/business-license.response.dto';
import {
  CreateBusinessLicenseDto,
  FetchBusinessLicenseDto
} from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';
import { BusinessLicenseException } from './exceptions/business.exceptions';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly businessLicensesHelper: BusinessLicensesHelper,
    private readonly configService: ConfigService,
  ) { }

  async createBusinessLicense(
    userId: string,
    data: CreateBusinessLicenseDto,
  ): Promise<void> {
    try {
      const hasFileUrl = !!data.fileUrl;
      const hasBusinessInfo = data.businessNumber && data.representativeName;

      if (!hasFileUrl && !hasBusinessInfo) {
        throw new BusinessLicenseException({
          message: '파일 URL 또는 사업자번호와 대표자명을 함께 제공해야 합니다.',
          errorCode: 'BUSINESS_LICENSE_FILE_URL_OR_BUSINESS_NUMBER_AND_REPRESENTATIVE_NAME_REQUIRED',
          httpStatus: HttpStatus.BAD_REQUEST,
        });
      }

      const existing = await this.checkDuplicateBusinessLicense(userId);
      if (existing) {
        throw new BusinessLicenseException({
          message: '이미 해당 사용자에 대한 사업자 등록 정보가 존재합니다.',
          errorCode: 'BUSINESS_LICENSE_ALREADY_EXISTS',
          httpStatus: HttpStatus.CONFLICT,
        });
      }

      await this.dbService.db.insert(businessLicenses).values({
        userId,
        businessNumber: data.businessNumber ?? null,
        representativeName: data.representativeName ?? null,
        status: 'approved',
        fileUrl: data.fileUrl ?? null,
      });

      return;
    } catch (error) {
      console.log('error::', error);

      throw new BusinessLicenseException({
        message: error.message ?? '사업자 등록 정보를 생성하는 중 오류가 발생했습니다.',
        errorCode: error.errorCode ?? 'BUSINESS_LICENSE_CREATION_FAILED',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }
  }

  async getMyBusinessLicense(
    userId: string,
  ): Promise<BusinessLicenseResponseDto | null> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ?? null;
  }
  /**
   * 사업자 정보 외부 조회
   */
  async fetchBusinessLicense(
    fetchBusinessLicenseDto: FetchBusinessLicenseDto,
  ): Promise<void> {
    const { businessNumber, representativeName } = fetchBusinessLicenseDto;

    const baseUrl = this.configService.get<string>('BIZNO_URL');
    const response = await firstValueFrom(
      this.httpService.get(`${baseUrl}/${businessNumber}`),
    );

    const $ = cheerio.load(response.data);

    const businessInfo = {
      // prettier-ignore
      businessNumber: this.businessLicensesHelper.extractTableValue($, '사업자등록번호'),
      ceoName: this.businessLicensesHelper.extractTableValue($, '대표자명'),
    };

    if (representativeName !== businessInfo.ceoName) {
      throw new BusinessLicenseException({
        message: '대표자 이름이 일치하지 않습니다.',
        errorCode: 'BUSINESS_LICENSE_CEO_NAME_NOT_MATCH',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }

    return;
  }

  async updateBusinessLicenseByBusinessId(
    businessId: string,
    data: UpdateBusinessLicenseDto,
    userId: string,
  ): Promise<void> {

    try {
      const existingBusiness = await this.findBusinessLicenseByUserId(userId);

      if (!existingBusiness) {
        throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
      }

      await this.validateOwnership(existingBusiness, userId);


      // 거절된 사업자 등록 정보를 다시 제출할 때
      if (existingBusiness.status === 'rejected') {
        const fileUrl = data.fileUrl ?? existingBusiness.fileUrl ?? '';

        await this.resubmitRejectedLicense(businessId, fileUrl);
        return;
      }

      // 승인된 사업자 등록 정보를 업데이트할 때
      if (existingBusiness.status === 'approved') {
        await this.updateApprovedLicense(existingBusiness.id, data);
        return;
      }
    } catch (error) {
      console.log('error::', error);
      throw new BadRequestException(
        '사업자 등록 정보를 수정하는 중 오류가 발생했습니다.',
      );
    }
  }

  async removeBusinessLicense(
    businessLicenseId: string,
    userId: string,
  ): Promise<void> {
    const existingBusiness = await this.findBusinessLicenseByUserId(userId);

    if (!existingBusiness) {
      throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
    }

    await this.validateOwnership(existingBusiness, userId);

    await this.dbService.db
      .update(businessLicenses)
      .set({
        deletedAt: new Date(),
      })
      .where(
        and(
          eq(businessLicenses.id, businessLicenseId),
          eq(businessLicenses.userId, userId),
        ),
      );
  }

  private async findBusinessLicenseByUserId(
    userId: string,
  ): Promise<BusinessLicense | null> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ?? null;
  }

  // 이미 사업자 등록 정보가 존재하는지 체크
  private async checkDuplicateBusinessLicense(
    userId: string,
  ): Promise<boolean> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ? true : false;
  }

  private async validateOwnership(
    businessLicense: BusinessLicense,
    userId: string,
  ): Promise<void> {
    if (businessLicense.userId !== userId) {
      throw new BadRequestException(
        '해당 사업자 등록 정보에 대한 권한이 없습니다.',
      );
    }
  }

  private async resubmitRejectedLicense(
    businessLicenseId: string,
    fileUrl: string,
  ): Promise<void> {
    await this.dbService.db
      .update(businessLicenses)
      .set({
        fileUrl,
        status: 'under_review',
      })
      .where(eq(businessLicenses.id, businessLicenseId));
  }

  private async updateApprovedLicense(
    businessLicenseId: string,
    data: UpdateBusinessLicenseDto,
  ): Promise<void> {
    await this.dbService.db
      .update(businessLicenses)
      .set({
        ...data,
        fileUrl: data.fileUrl,
      })
      .where(eq(businessLicenses.id, businessLicenseId));
  }
}
