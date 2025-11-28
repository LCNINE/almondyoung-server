import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
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
import { FetchBusinessLicenseResponseDto } from './dto/business-license.response.dto';
import {
  CreateBusinessLicenseWithFileDto,
  FetchBusinessLicenseDto,
} from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';
import { BusinessLicenseException } from './exceptions/business.exceptions';
import { BusinessLicenseResponseDto } from './dto/business-license.response.dto';

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly businessLicensesHelper: BusinessLicensesHelper,
    private readonly configService: ConfigService,
  ) { }

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
  ): Promise<FetchBusinessLicenseResponseDto> {
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

    return businessInfo;
  }

  async createWithFile(
    data: CreateBusinessLicenseWithFileDto,
    userId: string,
  ): Promise<void> {
    const existing = await this.checkDuplicateBusinessLicense(userId);
    if (existing) {
      throw new ConflictException(
        '이미 해당 사용자에 대한 사업자 등록 정보가 존재합니다.',
      );
    }

    await this.dbService.db.insert(businessLicenses).values({
      userId,
      shopId: data.shopId ?? null,
      status: 'under_review',
      file: data.file,
      metadata: data.metadata ? JSON.parse(data.metadata) : null,
    });
  }

  async updateBusinessLicenseByBusinessLicenseId(
    businessLicenseId: string,
    data: UpdateBusinessLicenseDto,
    userId: string,
  ): Promise<void> {
    const existingBusiness = await this.findBusinessLicenseByUserId(userId);

    if (!existingBusiness) {
      throw new NotFoundException('사업자 등록 정보를 찾을 수 없습니다.');
    }

    await this.validateOwnership(existingBusiness, userId);

    // 거절된 사업자 등록 정보를 다시 제출할 때
    if (existingBusiness.status === 'rejected') {
      await this.resubmitRejectedLicense(businessLicenseId, data.file);
      return;
    }

    // 승인된 사업자 등록 정보를 업데이트할 때
    if (existingBusiness.status === 'approved') {
      await this.updateApprovedLicense(existingBusiness.id, data);
      return;
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
    file: string,
  ): Promise<void> {
    await this.dbService.db
      .update(businessLicenses)
      .set({
        file,
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
      .set(data)
      .where(eq(businessLicenses.id, businessLicenseId));
  }
}
