import { DbService, InjectDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { USER_STREAM } from '@packages/event-contracts';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { BusinessLicense, businessLicenses, users, type UserServiceSchema } from '../../../database/drizzle/schema';
import {
  BusinessMetadata,
  CreateBusinessLicenseDto,
  FetchBusinessLicenseDto,
  NtsLookupResult,
  NtsValidateResult,
  UpdateBusinessLicenseDto,
} from './dto/business-license.dto';
import { BusinessLicenseResponseDto } from './dto/business-license.response.dto';
import { BusinessLicenseException } from './exceptions/business.exceptions';

// 국세청 상태조회 (data.go.kr) — 사업자번호만으로 계속/휴업/폐업/미등록 여부를 확인한다.
const NTS_STATUS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
// 국세청 진위확인 — 사업자번호 + 대표자명 + 개업일자 조합이 실제 등록 정보와 맞는지 확인한다.
// 상태조회는 대표자명을 아예 보지 않으므로, 대표자명 검증은 이 경로로만 가능하다.
const NTS_VALIDATE_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/validate';

// odcloud 가 5xx(503/504)를 자주 뱉는다. 한 번 실패를 최종 실패로 취급하면 정상 신청이 통째로
// under_review 로 쌓인다 (2026-08-06~12 직접입력 18건 중 16건이 이 경로로 막혔다).
const NTS_MAX_ATTEMPTS = 3;
const NTS_TIMEOUT_MS = 10_000;

// 재검증 대상 기간. 이보다 오래 묵은 건은 장애가 아니라 다른 사유일 가능성이 커 사람이 본다.
const REVALIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// 에러 본문 보관 한도. 5xx 는 JSON 대신 게이트웨이 HTML 이 통째로 오기도 한다.
const ERROR_BODY_MAX_CHARS = 1000;

/**
 * 사업자등록번호 가운데 2자리가 법인 구분자다 (81~88: 영리/비영리 법인).
 *
 * 법인은 신청자가 대표이사가 아니라 담당 직원인 경우가 많아, 대표자명 일치를 요구하면
 * 정상 고객이 막힌다. 그래서 자동 검증 대상에서 빼고 증빙 첨부 → 관리자 심사로 보낸다.
 */
function isCorporateBusinessNumber(businessNumber: string): boolean {
  const middle = Number(businessNumber.slice(3, 5));
  return middle >= 81 && middle <= 88;
}

/**
 * 실패한 국세청 호출에서 사후 분석에 쓸 흔적을 뽑는다.
 *
 * 이 호출은 예외를 위로 던지지 않고 metadata 로 흡수되므로 앱 로그에 아무것도 남지 않는다 —
 * 여기서 담는 값이 곧 로그다. 상태코드만 남기던 시절엔 "라이브에서만 5xx" 라는 사실 외에
 * 더 팔 재료가 없었다.
 */
function describeNtsFailure(error: unknown): { error: string; errorStatus?: number; errorBody?: string } {
  const response = (error as AxiosError<unknown>).response;

  return {
    error: error instanceof Error ? error.message : 'request_failed',
    errorStatus: response?.status,
    errorBody: stringifyErrorBody(response?.data),
  };
}

function stringifyErrorBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;

  try {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return text.length > ERROR_BODY_MAX_CHARS ? `${text.slice(0, ERROR_BODY_MAX_CHARS)}…` : text;
  } catch {
    return undefined;
  }
}

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

interface NtsValidateRow {
  /** '01' 일치 / '02' 불일치 */
  valid: string;
  valid_msg?: string;
  status?: NtsStatusRow;
  [key: string]: unknown;
}

interface NtsValidateResponse {
  status_code: string;
  data?: NtsValidateRow[];
}

@Injectable()
export class BusinessLicensesService {
  private readonly logger = new Logger(BusinessLicensesService.name);

  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectPublisher(USER_STREAM)
    private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
  ) {}

  /**
   * 국세청 조회 실패(`lookup_failed`)로 심사중에 갇힌 신청을 다시 확인한다.
   *
   * odcloud 5xx 는 요청 단위로 랜덤이라 즉시 3회 재시도로는 못 뚫는 구간이 있다. 그 구간에
   * 걸린 정상 사업자가 사람 손을 기다리며 쌓이는 걸 막는 게 목적이다. 판정 기준은 신규 등록과
   * 같고(`deriveStatus`), 여전히 조회가 안 되면 손대지 않고 다음 사이클로 넘긴다.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async revalidateFailedLookups(): Promise<void> {
    const since = new Date(Date.now() - REVALIDATE_WINDOW_MS);

    const rows = await this.dbService.db
      .select({
        id: businessLicenses.id,
        userId: businessLicenses.userId,
        metadata: businessLicenses.metadata,
        email: users.email,
        username: users.username,
      })
      .from(businessLicenses)
      .innerJoin(users, eq(users.id, businessLicenses.userId))
      .where(
        and(
          eq(businessLicenses.status, 'under_review'),
          isNull(businessLicenses.fileUrl),
          isNull(businessLicenses.deletedAt),
          gte(businessLicenses.createdAt, since),
          sql`${businessLicenses.metadata}->'ntsValidate'->>'status' = 'lookup_failed'`,
        ),
      );

    for (const row of rows) {
      // jsonb 컬럼이라 타입이 unknown 으로 내려온다. 우리가 쓴 모양이므로 여기서 좁힌다.
      const requested = (row.metadata as BusinessMetadata | null)?.ntsValidate?.requested;
      // 입력값을 남기기 전에 접수된 건 — 개업일자가 없어 재검증이 불가능하다. 사람이 봐야 한다.
      if (!requested) continue;

      const verification = await this.verifyWithNts(
        requested.businessNumber,
        requested.representativeName,
        requested.startDate,
      );
      if (verification.status === 'lookup_failed') continue;

      const status = this.deriveStatus(verification);
      await this.dbService.db
        .update(businessLicenses)
        .set({ status, metadata: { ntsValidate: verification }, updatedAt: new Date() })
        .where(eq(businessLicenses.id, row.id));

      this.logger.log(`사업자 재검증: ${row.id} → ${status}`);

      if (status === 'approved') {
        await this.eventPublisher.publishEvent({
          eventType: 'BusinessLicenseApproved',
          aggregateId: row.userId,
          payload: { userId: row.userId, email: row.email, name: row.username },
        });
      }
    }
  }

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
          metadata: null,
        });
        return;
      }

      this.assertNotCorporate(data.businessNumber!);

      const verification = await this.verifyWithNts(data.businessNumber!, data.representativeName!, data.startDate!);

      await this.dbService.db.insert(businessLicenses).values({
        userId,
        businessNumber: data.businessNumber,
        representativeName: data.representativeName,
        status: this.deriveStatus(verification),
        fileUrl: null,
        metadata: { ntsValidate: verification },
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

  async getMyBusinessLicense(userId: string): Promise<BusinessLicenseResponseDto | null> {
    const [result] = await this.dbService.db
      .select()
      .from(businessLicenses)
      .where(eq(businessLicenses.userId, userId))
      .limit(1);

    return result ?? null;
  }

  /**
   * 사용자가 지출증빙 현금영수증 등에서 입력한 사업자번호를, 기존 사업자정보의 번호가 비어있을 때만 채운다.
   */
  async fillMyBusinessNumberIfEmpty(userId: string, businessNumber: string): Promise<{ saved: boolean }> {
    const digits = businessNumber.replace(/\D/g, '');
    if (digits.length !== 10) {
      throw new BadRequestException('사업자등록번호는 10자리여야 합니다.');
    }

    const license = await this.findBusinessLicenseByUserId(userId);
    if (!license) return { saved: false }; // 등록 정보 없음 — 제약상 대표자명/파일이 필요해 생성은 하지 않음
    if (license.businessNumber?.trim()) return { saved: false }; // 이미 값 있음 — 덮어쓰지 않음

    try {
      await this.dbService.db
        .update(businessLicenses)
        .set({ businessNumber: digits, updatedAt: new Date() })
        .where(eq(businessLicenses.id, license.id));
      return { saved: true };
    } catch (error) {
      // 사업자번호 unique 위반(23505) 등 — 저장만 실패, 예외를 위로 던지지 않는다.
      if ((error as { code?: string })?.code === '23505') return { saved: false };
      throw error;
    }
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
      const data = await this.postNts<NtsStatusResponse>(NTS_STATUS_URL, { b_no: [businessNumber] }, serviceKey);

      const row = data?.data?.[0];
      if (data?.status_code !== 'OK' || !row) {
        return { result: 'lookup_failed', checkedAt, error: `unexpected_response:${data?.status_code ?? 'none'}` };
      }

      return { result: this.mapBusinessStatus(row.b_stt_cd), checkedAt, raw: row };
    } catch (error) {
      return { result: 'lookup_failed', checkedAt, ...describeNtsFailure(error) };
    }
  }

  /** 5xx 는 재시도로 흡수한다. 4xx(키 오류·잘못된 요청)는 재시도해도 같으므로 즉시 던진다. */
  private async postNts<T>(url: string, body: unknown, serviceKey: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { data } = await firstValueFrom(
          this.httpService.post<T>(url, body, {
            params: { serviceKey },
            headers: { 'Content-Type': 'application/json' },
            timeout: NTS_TIMEOUT_MS,
          }),
        );
        return data;
      } catch (error) {
        const { errorStatus, errorBody } = describeNtsFailure(error);
        const retriable = errorStatus === undefined || errorStatus >= 500;
        const giveUp = !retriable || attempt >= NTS_MAX_ATTEMPTS;

        this.logger.warn(
          `국세청 호출 실패 ${url} attempt=${attempt}/${NTS_MAX_ATTEMPTS} status=${errorStatus ?? 'none'} ` +
            `giveUp=${giveUp} body=${errorBody ?? 'none'}`,
        );

        if (giveUp) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
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

  /**
   * 법인은 자동 검증 대상이 아니다 — 증빙 첨부 경로로 안내한다.
   * (사업자등록증, 명함, 그 밖에 대표자/담당자임을 확인할 수 있는 증빙)
   */
  private assertNotCorporate(businessNumber: string): void {
    if (!isCorporateBusinessNumber(businessNumber)) return;

    throw new BusinessLicenseException({
      message: '법인사업자는 자동 인증을 지원하지 않습니다. 사업자등록증·명함 등 증빙 서류를 첨부해 등록해주세요.',
      errorCode: 'BUSINESS_LICENSE_CORPORATE_REQUIRES_FILE',
      httpStatus: HttpStatus.BAD_REQUEST,
    });
  }

  /**
   * 국세청 진위확인. `사업자번호 + 대표자명 + 개업일자` 가 실제 등록 정보와 맞는지 확인하고,
   * 같은 응답에 딸려오는 납세자 상태(계속/휴업/폐업)도 함께 읽는다.
   *
   * 키 미설정·장애 등 호출 자체가 실패하면 valid=false + error 로 돌려준다. 이 경우
   * 승인하지 않고 under_review 로 보내 사람이 보게 한다 (실패를 통과로 취급하지 않는다).
   */
  private async verifyWithNts(
    businessNumber: string,
    representativeName: string,
    startDate: string,
  ): Promise<NtsValidateResult> {
    const result = await this.runNtsValidate(businessNumber, representativeName, startDate);
    return { ...result, requested: { businessNumber, representativeName, startDate } };
  }

  private async runNtsValidate(
    businessNumber: string,
    representativeName: string,
    startDate: string,
  ): Promise<NtsValidateResult> {
    const checkedAt = new Date().toISOString();

    const serviceKey = this.configService.get<string>('DATA_GO_KR_SERVICE_KEY');
    if (!serviceKey) {
      return { valid: false, status: 'lookup_failed', checkedAt, error: 'SERVICE_KEY_NOT_CONFIGURED' };
    }

    try {
      const data = await this.postNts<NtsValidateResponse>(
        NTS_VALIDATE_URL,
        { businesses: [{ b_no: businessNumber, p_nm: representativeName, start_dt: startDate }] },
        serviceKey,
      );

      const row = data?.data?.[0];
      if (data?.status_code !== 'OK' || !row) {
        return {
          valid: false,
          status: 'lookup_failed',
          checkedAt,
          error: `unexpected_response:${data?.status_code ?? 'none'}`,
        };
      }

      const valid = row.valid === '01';
      if (!valid) {
        // 불일치 응답에는 status 객체가 딸려오지 않는다(실측). 어차피 승인하지 않으므로 조회도 생략.
        return { valid: false, invalidReason: row.valid_msg, status: 'not_found', checkedAt, raw: row };
      }

      // 일치 응답에 status 가 함께 오면 그대로 쓰고, 없으면 상태조회를 한 번 더 부른다.
      // 이 값이 비면 계속사업자 판정이 불가능해 자동 승인이 통째로 막힌다.
      const embedded = row.status?.b_stt_cd;
      const status = embedded
        ? this.mapBusinessStatus(embedded)
        : (await this.fetchBusinessLicense({ businessNumber })).result;

      return { valid: true, status, checkedAt, raw: row };
    } catch (error) {
      return { valid: false, status: 'lookup_failed', checkedAt, ...describeNtsFailure(error) };
    }
  }

  /**
   * 진위확인을 통과하고 **계속사업자**인 경우에만 자동 승인한다.
   * 휴업·폐업·미등록·조회실패는 모두 사람이 보도록 under_review 로 남긴다.
   */
  private deriveStatus(verification: NtsValidateResult): 'approved' | 'under_review' {
    return verification.valid && verification.status === 'active' ? 'approved' : 'under_review';
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
    // 파일 첨부 경로는 관리자 심사 대상(under_review). 직접 입력 경로는 생성과 동일하게
    // 서버가 국세청 진위확인을 다시 돌려 판정한다 — 수정으로 검증을 우회할 수 없어야 한다.
    if (data.fileUrl) {
      await this.dbService.db
        .update(businessLicenses)
        .set({
          businessNumber: null,
          representativeName: null,
          status: 'under_review',
          fileUrl: data.fileUrl,
          metadata: null,
        })
        .where(eq(businessLicenses.id, businessLicenseId));
      return;
    }

    this.assertNotCorporate(data.businessNumber!);

    const verification = await this.verifyWithNts(data.businessNumber!, data.representativeName!, data.startDate!);

    await this.dbService.db
      .update(businessLicenses)
      .set({
        businessNumber: data.businessNumber,
        representativeName: data.representativeName,
        status: this.deriveStatus(verification),
        fileUrl: null,
        metadata: { ntsValidate: verification },
      })
      .where(eq(businessLicenses.id, businessLicenseId));
  }
}
