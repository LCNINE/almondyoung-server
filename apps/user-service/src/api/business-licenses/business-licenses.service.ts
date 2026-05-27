import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { BusinessLicense, businessLicenses, type UserServiceSchema } from '../../../database/drizzle/schema';
import { BusinessLicensesHelper } from './business-licenses.helper';
import {
  CreateBusinessLicenseDto,
  FetchBusinessLicenseDto,
  UpdateBusinessLicenseDto,
} from './dto/business-license.dto';
import { BusinessLicenseResponseDto } from './dto/business-license.response.dto';
import { BusinessLicenseException } from './exceptions/business.exceptions';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly businessLicensesHelper: BusinessLicensesHelper,
    private readonly configService: ConfigService,
  ) {}

  async createBusinessLicense(userId: string, data: CreateBusinessLicenseDto): Promise<void> {
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

      if (hasFileUrl) {
        await this.dbService.db.insert(businessLicenses).values({
          userId,
          businessNumber: null,
          representativeName: null,
          status: 'under_review',
          fileUrl: data.fileUrl,
        });
      } else {
        await this.dbService.db.insert(businessLicenses).values({
          userId,
          businessNumber: data.businessNumber,
          representativeName: data.representativeName,
          status: 'approved',
          fileUrl: null,
        });
      }
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

  async getMyBusinessLicense(userId: string): Promise<BusinessLicenseResponseDto | null> {
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
  async fetchBusinessLicense(fetchBusinessLicenseDto: FetchBusinessLicenseDto): Promise<void> {
    const { businessNumber, representativeName } = fetchBusinessLicenseDto;

    const baseUrl = this.configService.get<string>('BIZNO_URL');

    if (!baseUrl) {
      throw new BusinessLicenseException({
        message: '사업자 조회 서비스가 설정되지 않았습니다.',
        errorCode: 'BUSINESS_LICENSE_FETCH_NOT_CONFIGURED',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }

    let response: { data: string };
    try {
      response = await firstValueFrom(this.httpService.get(`${baseUrl}/${businessNumber}`));
    } catch {
      throw new BusinessLicenseException({
        message: '사업자 정보 조회 중 외부 서비스 오류가 발생했습니다.',
        errorCode: 'BUSINESS_LICENSE_FETCH_EXTERNAL_ERROR',
        httpStatus: HttpStatus.BAD_GATEWAY,
      });
    }

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

      // 해당 사용자의 사업자 등록 정보가 맞는지 체크
      await this.validateOwnership(existingBusiness, userId);

      // 사업자 등록 정보 업데이트
      await this.updateApprovedLicense(businessId, data);

      return;
    } catch (error) {
      console.log('error::', error);
      throw new BadRequestException('사업자 등록 정보를 수정하는 중 오류가 발생했습니다.');
    }
  }

  async removeBusinessLicense(businessLicenseId: string, userId: string): Promise<void> {
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
      .where(and(eq(businessLicenses.id, businessLicenseId), eq(businessLicenses.userId, userId)));
  }

  private async findBusinessLicenseByUserId(userId: string): Promise<BusinessLicense | null> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ?? null;
  }

  // 이미 사업자 등록 정보가 존재하는지 체크
  private async checkDuplicateBusinessLicense(userId: string): Promise<boolean> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ? true : false;
  }

  private async validateOwnership(businessLicense: BusinessLicense, userId: string): Promise<void> {
    if (businessLicense.userId !== userId) {
      throw new BadRequestException('해당 사업자 등록 정보에 대한 권한이 없습니다.');
    }
  }

  private async updateApprovedLicense(businessLicenseId: string, data: UpdateBusinessLicenseDto): Promise<void> {
    // 외부 사업자 조회 결과, true일때 status를 approved로 변경
    if (data.externalBusinessStatus) {
      await this.dbService.db
        .update(businessLicenses)
        .set({
          ...data,
          status: 'approved',
          fileUrl: null,
        })
        .where(eq(businessLicenses.id, businessLicenseId));

      return;
    }
    // 외부 사업자 조회 결과, false일때 혹은 새롭게 첨부한 파일이 있을 때 status를 under_review로 변
    else if (!data.externalBusinessStatus || data.fileUrl) {
      await this.dbService.db
        .update(businessLicenses)
        .set({
          ...data,
          status: 'under_review',
          fileUrl: data.fileUrl,
        })
        .where(eq(businessLicenses.id, businessLicenseId));
      return;
    }
  }
}
