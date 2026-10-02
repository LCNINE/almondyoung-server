import axios from 'axios';
import { NHNProvider } from './nhn.provider';

jest.mock('axios');

describe('NHNProvider 알림톡 템플릿 발송 요청', () => {
  const post = jest.fn();
  const env: Record<string, string> = { NHN_SMS_SEND_NO: '0212345678' };

  beforeEach(() => {
    post.mockReset().mockResolvedValue({
      data: { header: { isSuccessful: true }, message: { requestId: 'req-1', sendResults: [{ resultCode: 0 }] } },
    });
    jest.mocked(axios.create).mockReturnValue({
      post,
      get: jest.fn(),
      interceptors: { response: { use: jest.fn() } },
    } as never);
  });

  const provider = () =>
    new NHNProvider('p-1', { appKey: 'app', secretKey: 'secret', senderKey: 'sender' }, {
      get: (key: string) => env[key],
    } as never);

  it('일반 알림은 인증 메시지가 아닌 일반 메시지 주소로 보낸다', async () => {
    await provider().send({ to: '01012345678', content: '', metadata: { templateCode: 'T1' } });

    expect(post.mock.calls[0][0]).toBe('/alimtalk/v2.3/appkeys/app/messages');
  });

  it('인증번호는 호출자가 AUTH 를 명시할 때만 인증 메시지 주소로 보낸다', async () => {
    await provider().send({
      to: '01012345678',
      content: '',
      metadata: { templateCode: 'T1', alimtalkMessageType: 'AUTH' },
    });

    expect(post.mock.calls[0][0]).toBe('/alimtalk/v2.3/appkeys/app/auth/messages');
  });

  it('대체 문자 본문이 오면 알림톡 실패 시 문자로 대신 보내라고 싣는다', async () => {
    const resendContent = '[아몬드영] 멤버십 요금 출금이 1번째 실패했어요. 남은 시도 2번이 모두 실패하면 해지돼요.';
    await provider().send({
      to: '01012345678',
      content: '',
      metadata: { templateCode: 'T1', resendContent },
    });

    const recipient = post.mock.calls[0][1].recipientList[0];
    expect(recipient.resendParameter).toEqual({
      isResend: true,
      resendType: 'LMS',
      resendContent,
      resendSendNo: '0212345678',
    });
  });

  it('대체 발송만 켜면 본문 없이 싣는다 — NHN 이 템플릿 본문으로 문자를 만든다', async () => {
    await provider().send({ to: '01012345678', content: '', metadata: { templateCode: 'T1', smsFallback: true } });

    expect(post.mock.calls[0][1].recipientList[0].resendParameter).toEqual({
      isResend: true,
      resendSendNo: '0212345678',
    });
  });

  it('대체 문자 본문이 없으면 지금처럼 알림톡만 시도한다', async () => {
    await provider().send({ to: '01012345678', content: '', metadata: { templateCode: 'T1' } });

    expect(post.mock.calls[0][1].recipientList[0].resendParameter).toBeUndefined();
  });

  it('예약 시각이 오면 NHN requestDate 로 싣는다', async () => {
    await provider().send({
      to: '01012345678',
      content: '',
      metadata: { templateCode: 'T1', requestDate: '2026-09-30 08:00' },
    });

    expect(post.mock.calls[0][1].requestDate).toBe('2026-09-30 08:00');
  });

  describe('발신 프로필에 대체 발송 설정이 없어 요청이 통째로 거절되면', () => {
    const rejected = {
      data: {
        header: { isSuccessful: false, resultCode: -1, resultMessage: 'Please set up plus-friend resend setting.' },
      },
    };

    it('대체 발송을 빼고 알림톡만 한 번 더 보낸다', async () => {
      post.mockResolvedValueOnce(rejected);

      const result = await provider().send({
        to: '01012345678',
        content: '',
        metadata: { templateCode: 'T1', smsFallback: true },
      });

      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[0][1].recipientList[0].resendParameter).toEqual({
        isResend: true,
        resendSendNo: '0212345678',
      });
      expect(post.mock.calls[1][1].recipientList[0].resendParameter).toBeUndefined();
      expect(result.success).toBe(true);
    });

    it('다른 이유의 거절은 다시 보내지 않는다', async () => {
      post.mockResolvedValueOnce({
        data: { header: { isSuccessful: false, resultCode: -1, resultMessage: '미승인 템플릿' } },
      });

      const result = await provider().send({
        to: '01012345678',
        content: '',
        metadata: { templateCode: 'T1', smsFallback: true },
      });

      expect(post).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('인증번호는 다시 보내지 않는다 — 문자 대체는 호출자가 따로 맡는다', async () => {
      post.mockResolvedValueOnce(rejected);

      await provider().send({
        to: '01012345678',
        content: '',
        metadata: { templateCode: 'T1', alimtalkMessageType: 'AUTH', resendContent: '[아몬드영] 인증번호 123456' },
      });

      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
