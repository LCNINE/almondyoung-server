import { ConfigService } from '@nestjs/config';
import { Channel } from '../../shared/enums';
import { NHNSmsProvider } from '../providers/sms/nhn-sms.provider';
import { ProviderManagerService } from './provider-manager.service';
import { PHONE_VERIFICATION_GROUPING_KEY, VerificationFallbackService } from './verification-fallback.service';

/**
 * 이 서비스가 지켜야 하는 건 두 가지다: 실패한 인증문자를 «반드시» 구제하는 것과, 인증문자가
 * 아닌 것을 «절대» 인증번호로 재발송하지 않는 것. 후자가 깨지면 엉뚱한 숫자가 고객에게 간다.
 */
describe('VerificationFallbackService', () => {
  const SENT_BODY = '[아몬드영] 인증번호: 483920';

  let kakaoSend: jest.Mock;
  let getSentBody: jest.Mock;
  let service: VerificationFallbackService;

  const hook = (overrides: Record<string, unknown> = {}) => ({
    requestId: 'req-1',
    recipientSeq: 1,
    recipientNo: '01012345678',
    resultCode: '3012',
    senderGroupingKey: PHONE_VERIFICATION_GROUPING_KEY,
    ...overrides,
  });

  // `undefined` 를 넘기면 기본 매개변수가 되살아나므로 «설정 없음» 은 null 로 표현한다.
  const build = (templateCode: string | null = 'ALMOND_VERIFY_001') => {
    kakaoSend = jest.fn().mockResolvedValue({ success: true, messageId: 'kakao-1' });
    getSentBody = jest.fn().mockResolvedValue(SENT_BODY);

    // 실제 NHNSmsProvider 인스턴스여야 한다 — 서비스가 instanceof 로 좁힌다.
    const smsProvider = Object.create(NHNSmsProvider.prototype) as NHNSmsProvider;
    (smsProvider as unknown as { getSentBody: jest.Mock }).getSentBody = getSentBody;

    const providerManager = {
      getAvailableProviderForChannel: jest.fn(async (channel: Channel) =>
        channel === Channel.SMS ? smsProvider : { send: kakaoSend },
      ),
    } as unknown as ProviderManagerService;

    const configService = { get: () => templateCode ?? undefined } as unknown as ConfigService;

    service = new VerificationFallbackService(providerManager, configService);
  };

  it('스팸으로 차단된 인증문자를 같은 코드로 알림톡 재발송한다', async () => {
    build();

    await service.handleDeliveryResults([hook()]);

    expect(kakaoSend).toHaveBeenCalledTimes(1);
    expect(kakaoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '01012345678',
        metadata: { templateCode: 'ALMOND_VERIFY_001', templateParameters: { code: '483920' } },
      }),
    );
  });

  it('도달한 건(resultCode 1000)은 건드리지 않는다', async () => {
    build();

    await service.handleDeliveryResults([hook({ resultCode: '1000' })]);

    expect(getSentBody).not.toHaveBeenCalled();
    expect(kakaoSend).not.toHaveBeenCalled();
  });

  it('인증문자 구분자가 없는 발송은 실패해도 무시한다', async () => {
    build();

    await service.handleDeliveryResults([hook({ senderGroupingKey: undefined }), hook({ senderGroupingKey: 'other' })]);

    expect(kakaoSend).not.toHaveBeenCalled();
  });

  it('본문에서 인증번호를 못 찾으면 아무것도 보내지 않는다', async () => {
    build();
    getSentBody.mockResolvedValue('[아몬드영] 주문이 출고되었습니다');

    await service.handleDeliveryResults([hook()]);

    expect(kakaoSend).not.toHaveBeenCalled();
  });

  it('템플릿 코드가 설정되지 않았으면 조회조차 하지 않는다', async () => {
    build(null);

    await service.handleDeliveryResults([hook()]);

    expect(getSentBody).not.toHaveBeenCalled();
    expect(kakaoSend).not.toHaveBeenCalled();
  });
});
