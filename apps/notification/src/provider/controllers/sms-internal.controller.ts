import { BadRequestException, Body, Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { Channel } from '../../shared/enums';
import { SendSmsDto, SendSmsResponseDto } from '../dto';
import { ProviderManagerService } from '../services/provider-manager.service';
import {
  extractVerificationCode,
  PHONE_VERIFICATION_GROUPING_KEY,
  VerificationFallbackService,
} from '../services/verification-fallback.service';

@ApiTags('internal-sms')
@Controller('internal/sms')
export class SmsInternalController {
  constructor(
    private readonly providerManager: ProviderManagerService,
    private readonly verificationFallback: VerificationFallbackService,
  ) {}

  @Post('send')
  @InternalOnly()
  @ApiOperation({ summary: '인증문자 발송 (서비스 간 호출 전용)' })
  @ApiBody({ type: SendSmsDto })
  @ApiResponse({ status: 201, type: SendSmsResponseDto })
  async send(@Body() dto: SendSmsDto): Promise<SendSmsResponseDto> {
    if (dto.channel === 'KAKAO') {
      return this.sendByKakao(dto);
    }

    const provider = await this.providerManager.getAvailableProviderForChannel(Channel.SMS);

    if (!provider) {
      throw new ServiceUnavailableException('SMS 발송 프로바이더가 없습니다');
    }

    // 이 엔드포인트의 호출자는 user-service 의 인증문자 하나뿐이다. 구분자를 붙여야 결과 웹훅에서
    // 인증문자를 골라내 알림톡으로 구제할 수 있다 (VerificationFallbackService).
    const result = await provider.send({
      to: dto.to,
      content: dto.content,
      metadata: { groupingKey: PHONE_VERIFICATION_GROUPING_KEY },
    });

    if (result.success) this.rememberIssuedCode(dto);

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      provider: provider.getName(),
    };
  }

  /**
   * 발송에 **성공했을 때만** 최신 코드로 기록한다. 늦게 도착한 SMS 실패 웹훅이 이미 대체된 코드를
   * 알림톡으로 다시 보내는 것을 막는 기준이다.
   *
   * 실패한 발송을 기록하면 안 된다 — user-service 는 발송 실패 시 트랜잭션을 롤백해 새 코드를
   * 없애므로, 그때 유효한 건 여전히 직전 코드다. 실패한 코드를 최신으로 적어두면 그 직전 코드의
   * 정당한 구제까지 막힌다.
   */
  private rememberIssuedCode(dto: SendSmsDto): void {
    const code = extractVerificationCode(dto.content);
    if (code) this.verificationFallback.rememberIssuedCode(dto.to, code);
  }

  /**
   * 고객이 인증번호가 오지 않는다며 카카오톡 발송을 고른 경우.
   *
   * 통신사 스팸보관함으로 들어간 문자는 발송 결과가 성공으로 돌아와 우리가 실패를 감지할 수 없다.
   * 그 사각지대를 고객의 클릭으로 메우는 경로다. 알림톡은 통신사 스팸필터를 타지 않는다.
   */
  private async sendByKakao(dto: SendSmsDto): Promise<SendSmsResponseDto> {
    if (!this.verificationFallback.isConfigured()) {
      throw new ServiceUnavailableException('카카오톡 인증번호 발송이 아직 준비되지 않았습니다');
    }

    // 알림톡은 템플릿 발송이라 본문 전체가 아니라 인증번호만 필요하다.
    const code = extractVerificationCode(dto.content);
    if (!code) {
      throw new BadRequestException('본문에서 인증번호를 찾지 못했습니다');
    }

    const result = await this.verificationFallback.sendByAlimtalk(dto.to, code);

    if (result.success) this.verificationFallback.rememberIssuedCode(dto.to, code);

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      provider: 'NHN KakaoTalk',
    };
  }
}
