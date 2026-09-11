import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, count, eq, gte } from 'drizzle-orm';
import { WalletSchema, cmsAccountChecks } from '../schema';
import { CmsApiClient, CmsAccountCheckData } from './cms-api.client';
import { CmsOperationError } from './cms-errors';

export interface CmsAccountCheckInput {
  paymentCompany: string;
  paymentNumber: string;
  payerNumber: string;
}

export type CmsAccountCheckOutcome =
  | { verified: true; payerName: string | null }
  // providerCode 는 효성이 준 원본 코드(1001=계좌번호오류, 2001=생년월일 불일치 …).
  // 고객 문의가 왔을 때 「무엇이 틀렸는지」를 되묻지 않고 바로 알 수 있게 그대로 내려준다.
  | { verified: false; reason: 'MISMATCH' | 'UNAVAILABLE'; message: string; providerCode: string | null };

/** 사용자별 시간당 조회 상한. 건당 100원이고 계좌번호만으로 예금주 실명이 나오므로 상한이 필요하다. */
const MAX_CHECKS_PER_HOUR = 10;

const MISMATCH_MESSAGE = '입력하신 계좌 정보와 예금주 정보가 일치하지 않습니다. 은행·계좌번호·생년월일을 확인해주세요.';

/**
 * 효성은 «어느 항목이» 틀렸는지 코드로 알려준다. 뭉뚱그려 안내하면 고객이 멀쩡한 계좌번호를
 * 몇 번씩 고쳐 넣게 되고(유료 호출이 그만큼 늘고) 결국 CS 로 온다 — 실측한 코드만 옮긴다.
 */
const MISMATCH_MESSAGE_BY_CODE: Record<string, string> = {
  '1001': '계좌번호를 다시 확인해주세요. 해당 은행에 그런 계좌번호가 없습니다.',
  '2001': '계좌에 등록된 생년월일(사업자번호)과 다릅니다. 계좌를 만들 때 쓴 정보로 입력해주세요.',
};
const UNAVAILABLE_MESSAGE =
  '지금은 계좌를 실시간으로 확인할 수 없습니다. 입력한 정보를 다시 확인한 뒤 계속 진행해주세요.';

/**
 * 효성 실시간 계좌조회(FMS-TE-0057). 등록 전에 계좌·실명번호를 확인해
 * D+1 에 Q201(본인정보 불일치)로 돌아오던 실패를 입력 시점에 잡는다.
 *
 * 실패를 두 갈래로 나눈다 — 효성이 flag='N' 으로 «명시적 불일치»를 말한 경우만 등록을 막고,
 * 그 밖의 실패(미지원 은행·장애·네트워크)는 UNAVAILABLE 로 내려 등록 자체는 계속 가능하게 한다.
 * 문서의 지원 은행 목록에 카카오뱅크·토스뱅크가 없어, 조회 실패가 곧 「등록 불가」는 아니다.
 */
@Injectable()
export class CmsAccountCheckService {
  private readonly logger = new Logger(CmsAccountCheckService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
  ) {}

  async check(userId: string, input: CmsAccountCheckInput): Promise<CmsAccountCheckOutcome> {
    await this.assertUnderRateLimit(userId);

    const verify = await this.cmsApi.verifyPayerNumber(input);

    if (!verify.ok) {
      // 4xx/5xx/네트워크 — 어느 쪽도 «계좌가 틀렸다»는 확답이 아니다.
      this.logger.warn(
        `Account check unavailable. userId=${userId} bank=${input.paymentCompany} code=${verify.error.code} message=${verify.error.message}`,
      );
      await this.record(userId, input.paymentCompany, null, false, verify.error.code, verify.error.message);
      return { verified: false, reason: 'UNAVAILABLE', message: UNAVAILABLE_MESSAGE, providerCode: verify.error.code };
    }

    const check = verify.data.check ?? {};
    const flag = check.result?.flag;
    if (flag !== 'Y') {
      const code = check.result?.code ?? null;
      const message = check.result?.message ?? null;
      await this.record(userId, input.paymentCompany, check.paymentNumber ?? null, false, code, message);
      // «틀렸다»는 확답은 flag='N' 뿐이다. flag 가 비어 있거나 모르는 값이면 응답을 해석하지
      // 못한 것이므로 UNAVAILABLE 로 내린다 — 멀쩡한 계좌를 불일치로 단정해 막지 않는다.
      if (flag !== 'N') {
        this.logger.warn(
          `Account check got an unreadable flag. userId=${userId} bank=${input.paymentCompany} flag=${String(flag)} code=${String(code)}`,
        );
        return { verified: false, reason: 'UNAVAILABLE', message: UNAVAILABLE_MESSAGE, providerCode: code };
      }
      this.logger.log(
        `Account check mismatch. userId=${userId} bank=${input.paymentCompany} code=${String(code)} message=${String(message)}`,
      );
      return {
        verified: false,
        reason: 'MISMATCH',
        message: (code && MISMATCH_MESSAGE_BY_CODE[code]) ?? MISMATCH_MESSAGE,
        providerCode: code,
      };
    }

    const payerName = await this.lookupPayerName(input);
    await this.record(
      userId,
      input.paymentCompany,
      check.paymentNumber ?? null,
      true,
      check.result?.code ?? null,
      null,
    );
    return { verified: true, payerName };
  }

  /** 예금주 이름은 부가 정보 — 실패해도 검증 결과(verified)를 뒤집지 않는다. */
  private async lookupPayerName(input: CmsAccountCheckInput): Promise<string | null> {
    const inquiry = await this.cmsApi.inquirePayerName({
      paymentCompany: input.paymentCompany,
      paymentNumber: input.paymentNumber,
    });
    if (!inquiry.ok) return null;
    const check = inquiry.data.check ?? {};
    if (!this.isPass(check)) return null;
    return check.payerName ?? null;
  }

  private isPass(check: CmsAccountCheckData): boolean {
    return check.result?.flag === 'Y';
  }

  private async assertUnderRateLimit(userId: string): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [row] = await this.dbService.db
      .select({ value: count() })
      .from(cmsAccountChecks)
      .where(and(eq(cmsAccountChecks.userId, userId), gte(cmsAccountChecks.createdAt, since)));

    if ((row?.value ?? 0) >= MAX_CHECKS_PER_HOUR) {
      throw new CmsOperationError(
        'CMS_ACCOUNT_CHECK_RATE_LIMITED',
        '계좌 확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
        429,
        `userId=${userId} exceeded ${MAX_CHECKS_PER_HOUR}/hour`,
      );
    }
  }

  private async record(
    userId: string,
    paymentCompany: string,
    maskedPaymentNumber: string | null,
    verified: boolean,
    resultCode: string | null,
    resultMessage: string | null,
  ): Promise<void> {
    await this.dbService.db.insert(cmsAccountChecks).values({
      userId,
      paymentCompany,
      // 효성이 마스킹해 준 값만 남긴다. 마스킹이 안 된 채로 오면(응답 스키마 변경 등)
      // 전체 계좌번호를 우리 DB 에 적재하게 되므로 차라리 버린다.
      maskedPaymentNumber: maskedPaymentNumber?.includes('*') ? maskedPaymentNumber.slice(0, 32) : null,
      verified,
      resultCode: resultCode?.slice(0, 16) ?? null,
      resultMessage,
    });
  }
}
