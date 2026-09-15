// apps/notification/src/provider/services/verification-fallback.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '../../shared/enums';
import { StructuredLogger } from '../../shared/utils/logger.utils';
import { NotificationResult } from '../interfaces/notification-provider.interface';
import { NHNSmsProvider } from '../providers/sms/nhn-sms.provider';
import { ProviderManagerService } from './provider-manager.service';

/**
 * 인증문자 발송에 붙이는 구분자. NHN 결과 웹훅이 그대로 돌려주므로, 이 값으로 인증문자만 골라낸다.
 * 이 키가 없는 발송은 웹훅이 와도 무시된다.
 */
export const PHONE_VERIFICATION_GROUPING_KEY = 'phone-verification';

/** NHN 수신 결과 코드. `1000` 만 단말 도달이고 나머지(스팸 3012·착신거절 3006 등)는 전부 미도달이다. */
const RESULT_CODE_SUCCESS = '1000';

/** 인증번호 유효시간(3분)과 맞춘다. 이보다 오래된 기억은 비교 기준이 되지 못하므로 버린다. */
const ISSUED_CODE_TTL_MS = 3 * 60 * 1000;

/**
 * 본문에서 인증번호를 꺼낸다.
 *
 * 포맷이 어긋나면 재발송을 포기한다 — 그룹키가 잘못 붙은 발송을 인증번호로 오인해 엉뚱한 숫자를
 * 알림톡으로 보내는 것보다, 안 보내고 로그를 남기는 쪽이 낫다.
 */
const VERIFICATION_CODE_PATTERN = /인증번호:\s*(\d{4,8})/;

/** 발송 본문에서 인증번호만 꺼낸다. 포맷이 어긋나면 undefined — 호출자가 발송을 포기해야 한다. */
export function extractVerificationCode(body: string): string | undefined {
  return body.match(VERIFICATION_CODE_PATTERN)?.[1];
}

/** 발송 요청의 `+8210…` 과 결과 웹훅의 `010…` 이 같은 키가 되도록 맞춘다. */
function normalizeRecipientNo(recipientNo: string): string {
  const digits = recipientNo.replace(/[^\d]/g, '');
  return digits.startsWith('82') ? '0' + digits.substring(2) : digits;
}

interface SmsResultHook {
  requestId?: string;
  recipientSeq?: number;
  recipientNo?: string;
  resultCode?: string;
  messageStatus?: string;
  senderGroupingKey?: string;
}

/**
 * 인증문자가 단말에 도달하지 못했을 때 알림톡으로 다시 보낸다.
 *
 * 왜 필요한가: 070 발신은 통신사 스팸필터·단말 차단앱에 걸리는 경로가 남아 있다. 차단된 건은
 * NHN 접수 응답에선 성공으로 오고 (`msgStatus: 3`), 최종 판정은 결과 웹훅의 `resultCode` 로만
 * 온다 — 그래서 이 구제 경로가 없으면 우리도 고객도 CS 가 올 때까지 모른다.
 *
 * 타이밍: 실측상 접수→결과 확정이 5~16초다 (이슈 #849). 인증번호 만료가 3분이므로 웹훅을 받은
 * 시점에도 같은 코드가 아직 유효하다. 그래서 새 코드를 발급하지 않고 보냈던 그 코드를 다시 보낸다.
 */
@Injectable()
export class VerificationFallbackService {
  private readonly logger: StructuredLogger;

  /**
   * 번호별 마지막 발급 코드. 웹훅이 5~16초 늦게 오는 사이 고객이 재발송이나 카카오톡을 누르면
   * 옛 코드는 이미 만료돼 있으므로, 그걸로 구제하지 않기 위해 비교 기준을 들고 있는다.
   *
   * ponytail: 프로세스 메모리. notification 은 태스크 1개 고정이라 충분하고, 기억이 없으면
   * 예전처럼 그냥 구제한다. 스케일아웃하면 Redis 로 옮긴다.
   */
  private readonly issuedCodes = new Map<string, { code: string; at: number }>();

  constructor(
    private readonly providerManager: ProviderManagerService,
    private readonly configService: ConfigService,
  ) {
    this.logger = new StructuredLogger(new Logger(VerificationFallbackService.name));
  }

  /** 인증문자를 내보내는 경로가 전부 불러야 한다. 안 부르면 그 번호는 비교 기준이 없다. */
  rememberIssuedCode(recipientNo: string, code: string): void {
    const now = Date.now();
    for (const [key, entry] of this.issuedCodes) {
      if (now - entry.at > ISSUED_CODE_TTL_MS) this.issuedCodes.delete(key);
    }
    this.issuedCodes.set(normalizeRecipientNo(recipientNo), { code, at: now });
  }

  /** 모르면 undefined — 기억이 없는 번호는 예전처럼 그냥 구제한다. */
  private latestIssuedCode(recipientNo: string): string | undefined {
    const entry = this.issuedCodes.get(normalizeRecipientNo(recipientNo));
    if (!entry) return undefined;
    return Date.now() - entry.at > ISSUED_CODE_TTL_MS ? undefined : entry.code;
  }

  async handleDeliveryResults(hooks: SmsResultHook[]): Promise<void> {
    const failures = hooks.filter(
      (hook) =>
        hook.senderGroupingKey === PHONE_VERIFICATION_GROUPING_KEY &&
        hook.resultCode !== undefined &&
        hook.resultCode !== RESULT_CODE_SUCCESS,
    );

    for (const failure of failures) {
      await this.resendByAlimtalk(failure);
    }
  }

  /** 템플릿 코드가 채워져 있어야 알림톡 경로가 산다. 카카오 심사 통과 전에는 비어 있다. */
  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('NHN_VERIFICATION_TEMPLATE_CODE'));
  }

  /**
   * 인증번호를 알림톡으로 보낸다.
   *
   * 두 곳이 이 경로를 쓴다: 고객이 인증번호가 오지 않는다며 카카오톡으로 받기를 누른 경우와,
   * SMS 도달 실패를 결과 웹훅으로 감지한 경우. 후자는 통신사가 망에서 거부한 건만 잡히고,
   * 스팸보관함으로 들어간 건은 결과가 성공으로 오므로 감지되지 않는다 — 그래서 고객이 직접
   * 누르는 앞의 경로가 필요하다.
   */
  async sendByAlimtalk(recipientNo: string, code: string): Promise<NotificationResult> {
    const templateCode = this.configService.get<string>('NHN_VERIFICATION_TEMPLATE_CODE');
    if (!templateCode) {
      return { success: false, error: 'NHN_VERIFICATION_TEMPLATE_CODE is not configured' };
    }

    const kakaoProvider = await this.providerManager.getAvailableProviderForChannel(Channel.KAKAO);
    if (!kakaoProvider) {
      this.logger.error('No KakaoTalk provider is available', { recipientNo });
      return { success: false, error: 'No KakaoTalk provider is available' };
    }

    return kakaoProvider.send({
      to: recipientNo,
      content: '',
      metadata: { templateCode, templateParameters: { code } },
    });
  }

  private async resendByAlimtalk(hook: SmsResultHook): Promise<void> {
    const { requestId, recipientSeq, recipientNo, resultCode } = hook;

    if (!requestId || recipientSeq === undefined || !recipientNo) {
      this.logger.warn('SMS result hook missing identifiers', { requestId, recipientSeq });
      return;
    }

    if (!this.isConfigured()) {
      this.logger.warn('SMS delivery failed but NHN_VERIFICATION_TEMPLATE_CODE is not configured', {
        recipientNo,
        resultCode,
      });
      return;
    }

    const smsProvider = await this.providerManager.getAvailableProviderForChannel(Channel.SMS);
    if (!(smsProvider instanceof NHNSmsProvider)) {
      this.logger.warn('SMS provider is not NHN — cannot read the original body', { recipientNo });
      return;
    }

    const body = await smsProvider.getSentBody(requestId, recipientSeq);
    const code = body ? extractVerificationCode(body) : undefined;
    if (!code) {
      this.logger.warn('Could not extract a verification code from the sent body', {
        requestId,
        recipientNo,
        resultCode,
      });
      return;
    }

    const latest = this.latestIssuedCode(recipientNo);
    if (latest !== undefined && latest !== code) {
      this.logger.log('Skipped KakaoTalk fallback — the code has already been superseded', {
        requestId,
        recipientNo,
        resultCode,
      });
      return;
    }

    const result = await this.sendByAlimtalk(recipientNo, code);

    if (result.success) {
      this.logger.log('Resent verification code by KakaoTalk after SMS delivery failure', {
        recipientNo,
        smsResultCode: resultCode,
        messageId: result.messageId,
      });
    } else {
      this.logger.error('KakaoTalk fallback also failed', {
        recipientNo,
        smsResultCode: resultCode,
        error: result.error,
      });
    }
  }
}
