import { DbService, InjectDb } from '@app/db';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { BusinessLicense, businessLicenses, type UserServiceSchema } from '../../../database/drizzle/schema';
import {
  BusinessMetadata,
  CreateBusinessLicenseDto,
  FetchBusinessLicenseDto,
  NtsLookupResult,
  UpdateBusinessLicenseDto,
} from './dto/business-license.dto';
import { BusinessLicenseResponseDto } from './dto/business-license.response.dto';
import { BusinessLicenseException } from './exceptions/business.exceptions';

// 국세청 상태조회 (data.go.kr) — 사업자번호만으로 계속/휴업/폐업/미등록 여부를 확인한다.
const NTS_STATUS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';

interface NtsStatusRow {
  b_no: string;
  b_stt: string;
  b_stt_cd: string;
  tax_type?: string;
  [key: string]: unknown;
}

interface NtsStatusResponse {
  status_code: string;
  data?: NtsStatusRow[];
}

@Injectable()
export class BusinessLicensesService {
  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
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
          metadata: data.metadata ?? null,
        });
      } else {
        await this.dbService.db.insert(businessLicenses).values({
          userId,
          businessNumber: data.businessNumber,
          representativeName: data.representativeName,
          status: this.deriveStatus(data.metadata),
          fileUrl: null,
          metadata: data.metadata ?? null,
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
   * 사업자 정보 외부 조회 (국세청 상태조회).
   *
   * 등록을 막지 않는다 — 결과(계속/휴업/폐업/미등록/조회실패)를 그대로 돌려주고,
   * 호출 측이 metadata 에 보관한다. 일시정지/장애/키 미설정은 모두 lookup_failed 로 흡수한다.
   */
  async fetchBusinessLicense(fetchBusinessLicenseDto: FetchBusinessLicenseDto): Promise<NtsLookupResult> {
    const { businessNumber } = fetchBusinessLicenseDto;
    const checkedAt = new Date().toISOString();

    const serviceKey = this.configService.get<string>('DATA_GO_KR_SERVICE_KEY');
    if (!serviceKey) {
      return { result: 'lookup_failed', checkedAt, error: 'SERVICE_KEY_NOT_CONFIGURED' };
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<NtsStatusResponse>(
          NTS_STATUS_URL,
          { b_no: [businessNumber] },
          { params: { serviceKey }, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const row = data?.data?.[0];
      if (data?.status_code !== 'OK' || !row) {
        return { result: 'lookup_failed', checkedAt, error: `unexpected_response:${data?.status_code ?? 'none'}` };
      }

      return { result: this.mapBusinessStatus(row.b_stt_cd), checkedAt, raw: row };
    } catch (error) {
      return {
        result: 'lookup_failed',
        checkedAt,
        error: error instanceof Error ? error.message : 'request_failed',
      };
    }
  }

  // 국세청 납세자상태코드 → 내부 result. 01 계속 / 02 휴업 / 03 폐업 / 그 외(빈값) 미등록.
  private mapBusinessStatus(code: string | undefined): NtsLookupResult['result'] {
    switch (code) {
      case '01':
        return 'active';
      case '02':
        return 'suspended';
      case '03':
        return 'closed';
      default:
        return 'not_found';
    }
  }

  // 번호가 실존(계속/휴업/폐업)으로 확인되면 approved, 미등록/조회실패면 사람이 보도록 under_review.
  private deriveStatus(metadata: BusinessMetadata | null | undefined): 'approved' | 'under_review' {
    const result = metadata?.nts?.result;
    return result === 'active' || result === 'suspended' || result === 'closed' ? 'approved' : 'under_review';
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
    // 파일 첨부 경로는 관리자 심사 대상(under_review), 직접 입력 경로는 상태조회 결과로 판정.
    const status = data.fileUrl ? 'under_review' : this.deriveStatus(data.metadata);

    await this.dbService.db
      .update(businessLicenses)
      .set({
        ...data,
        businessNumber: data.businessNumber || null,
        representativeName: data.representativeName || null,
        status,
        fileUrl: data.fileUrl ?? null,
      })
      .where(eq(businessLicenses.id, businessLicenseId));
  }
}
