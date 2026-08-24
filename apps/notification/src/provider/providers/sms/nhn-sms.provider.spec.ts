import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NHNSmsProvider } from './nhn-sms.provider';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONFIG = {
  apiUrl: 'https://sms.api.nhncloudservice.com',
  appKey: 'app-key',
  secretKey: 'secret-key',
  sendNo: '18777184',
  timeout: 30000,
};

const configService = { get: jest.fn() } as unknown as ConfigService;

interface SmsPayload {
  body: string;
  sendNo: string;
  title?: string;
  recipientList: Array<{ recipientNo: string }>;
}

type PostMock = jest.Mock<Promise<unknown>, [string, SmsPayload]>;

const makePost = (): PostMock => jest.fn<Promise<unknown>, [string, SmsPayload]>();

function createProvider(post: PostMock) {
  mockedAxios.create.mockReturnValue({ post } as never);
  return new NHNSmsProvider('provider-id', CONFIG, configService);
}

function okResponse(recipientNo: string, resultCode = 0) {
  return {
    data: {
      header: { isSuccessful: true, resultCode: 0, resultMessage: 'SUCCESS' },
      body: {
        data: {
          requestId: 'req-1',
          statusCode: '2',
          sendResultList: [{ recipientNo, resultCode, resultMessage: 'ok', recipientSeq: 1 }],
        },
      },
    },
  };
}

describe('NHNSmsProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('E.164 수신번호를 국내 로컬 표기로 바꿔 보낸다', async () => {
    const post = makePost().mockResolvedValue(okResponse('01079323639'));
    const provider = createProvider(post);

    await provider.send({ to: '+821079323639', content: '[아몬드영] 인증번호: 123456' });

    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('/sms/v3.0/appKeys/app-key/sender/sms');
    expect(payload.recipientList).toEqual([{ recipientNo: '01079323639' }]);
    expect(payload.sendNo).toBe('18777184');
  });

  it('하이픈이 섞인 로컬 표기도 숫자만 남긴다', async () => {
    const post = makePost().mockResolvedValue(okResponse('01079323639'));
    const provider = createProvider(post);

    await provider.send({ to: '010-7932-3639', content: '본문' });

    expect(post.mock.calls[0][1].recipientList).toEqual([{ recipientNo: '01079323639' }]);
  });

  // HTTP 200 인데 header.isSuccessful 이 false 인 경우가 NHN 의 실패 표현이다. 여기서 성공으로
  // 집계하면 "발송했습니다" 만 뜨고 문자는 안 가는 상태가 된다.
  it('HTTP 200 이어도 header.isSuccessful 이 false 면 실패로 판정한다', async () => {
    const post = makePost().mockResolvedValue({
      data: { header: { isSuccessful: false, resultCode: -9996, resultMessage: '발신번호 미등록' } },
    });
    const provider = createProvider(post);

    const result = await provider.send({ to: '+821079323639', content: '본문' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('발신번호 미등록');
  });

  it('수신자별 resultCode 가 0 이 아니면 실패로 판정한다', async () => {
    const post = makePost().mockResolvedValue(okResponse('01079323639', 3));
    const provider = createProvider(post);

    const result = await provider.send({ to: '+821079323639', content: '본문' });

    expect(result.success).toBe(false);
  });

  it('90바이트를 넘는 본문은 장문(MMS) 엔드포인트로 보낸다', async () => {
    const post = makePost().mockResolvedValue(okResponse('01079323639'));
    const provider = createProvider(post);

    await provider.send({ to: '+821079323639', content: '가'.repeat(40) });

    expect(post.mock.calls[0][0]).toBe('/sms/v3.0/appKeys/app-key/sender/mms');
  });

  it('네트워크 실패는 성공으로 새지 않는다', async () => {
    const post = makePost().mockRejectedValue(new Error('ECONNRESET'));
    const provider = createProvider(post);

    const result = await provider.send({ to: '+821079323639', content: '본문' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNRESET');
  });

  // 본문별로 묶어 배치 발송하므로 결과 순서가 입력 순서와 어긋난다. index 로 되짚으면 실패한
  // 수신번호가 엉뚱하게 기록된다.
  it('본문이 섞인 대량 발송에서 실패 수신번호를 정확히 짚는다', async () => {
    const post = makePost()
      .mockResolvedValueOnce(okResponse('01011111111'))
      .mockResolvedValueOnce(okResponse('01022222222', 3));
    const provider = createProvider(post);

    const result = await provider.sendBulk([
      { to: '+821011111111', content: 'A' },
      { to: '+821022222222', content: 'B' },
    ]);

    expect(result.successCount).toBe(1);
    expect(result.failures).toEqual([{ to: '+821022222222', error: 'ok (3)' }]);
  });

  it('발신번호가 없으면 생성 단계에서 던진다', () => {
    mockedAxios.create.mockReturnValue({ post: jest.fn() } as never);
    expect(() => new NHNSmsProvider('id', { ...CONFIG, sendNo: '' }, configService)).toThrow('NHN_SMS_SEND_NO');
  });
});
