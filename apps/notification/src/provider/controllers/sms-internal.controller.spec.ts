import { Channel } from '../../shared/enums';
import { ProviderManagerService } from '../services/provider-manager.service';
import { VerificationFallbackService } from '../services/verification-fallback.service';
import { SmsInternalController } from './sms-internal.controller';

/**
 * 최신 코드 기록은 발송 성공에만 걸려야 한다. 실패한 발송까지 기록하면, user-service 가
 * 트랜잭션을 롤백해 되살아난 직전 코드의 구제가 막힌다.
 */
describe('SmsInternalController', () => {
  const CONTENT = '[아몬드영] 인증번호: 483920';

  let smsSend: jest.Mock;
  let rememberIssuedCode: jest.Mock;
  let controller: SmsInternalController;

  const build = (sendResult: { success: boolean; error?: string }) => {
    smsSend = jest.fn().mockResolvedValue(sendResult);
    rememberIssuedCode = jest.fn();

    const providerManager = {
      getAvailableProviderForChannel: jest.fn(async (channel: Channel) =>
        channel === Channel.SMS ? { send: smsSend, getName: () => 'NHN SMS' } : undefined,
      ),
    } as unknown as ProviderManagerService;

    const fallback = {
      rememberIssuedCode,
      isConfigured: () => true,
      sendByAlimtalk: jest.fn().mockResolvedValue(sendResult),
    } as unknown as VerificationFallbackService;

    controller = new SmsInternalController(providerManager, fallback);
  };

  it('발송에 성공하면 최신 코드로 기록한다', async () => {
    build({ success: true });

    await controller.send({ to: '01012345678', content: CONTENT });

    expect(rememberIssuedCode).toHaveBeenCalledWith('01012345678', '483920');
  });

  it('발송에 실패하면 기록하지 않는다', async () => {
    build({ success: false, error: 'rejected' });

    await controller.send({ to: '01012345678', content: CONTENT });

    expect(rememberIssuedCode).not.toHaveBeenCalled();
  });

  it('카카오톡 발송도 성공했을 때만 기록한다', async () => {
    build({ success: false, error: 'rejected' });

    await controller.send({ to: '01012345678', content: CONTENT, channel: 'KAKAO' });

    expect(rememberIssuedCode).not.toHaveBeenCalled();
  });
});
