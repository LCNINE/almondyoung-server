import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BadRequestError, ServiceUnavailableError } from '@app/shared';
import { NhnAlimtalkClient, NhnRequestRejectedError } from './nhn-alimtalk.client';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, create: jest.fn() },
    isAxiosError: actual.isAxiosError,
  };
});

const http = { get: jest.fn(), post: jest.fn(), request: jest.fn() };
(axios.create as jest.Mock).mockReturnValue(http);

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const configured = () =>
  new NhnAlimtalkClient(
    config({ NHN_APP_KEY: 'app', NHN_SENDER_KEY: 'sender', NHN_SECRET_KEY: 'secret', NHN_SMS_SEND_NO: '0200000000' }),
  );

describe('NhnAlimtalkClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('대량 발송은 일반 발송 주소(인증 주소 아님)로, 대체 문자를 켜고 행 id 를 되짚는 키로 보낸다', async () => {
    http.post.mockResolvedValue({
      data: {
        header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
        message: {
          requestId: 'req-1',
          sendResults: [{ recipientGroupingKey: 'n1', resultCode: 0, resultMessage: '성공' }],
        },
      },
    });
    const result = await configured().sendTemplateBatch({
      templateCode: 'NOTICE_1',
      senderGroupingKey: 'camp-1',
      recipients: [{ recipientNo: '01012345678', templateParameter: { name: '홍' }, recipientGroupingKey: 'n1' }],
    });
    const [url, body] = http.post.mock.calls[0];
    expect(url).toBe('/alimtalk/v2.3/appkeys/app/messages');
    expect(body).toEqual({
      senderKey: 'sender',
      templateCode: 'NOTICE_1',
      senderGroupingKey: 'camp-1',
      recipientList: [
        {
          recipientNo: '01012345678',
          templateParameter: { name: '홍' },
          recipientGroupingKey: 'n1',
          resendParameter: { isResend: true, resendSendNo: '0200000000' },
        },
      ],
    });
    expect(result).toEqual({
      requestId: 'req-1',
      results: [{ recipientGroupingKey: 'n1', resultCode: 0, resultMessage: '성공' }],
    });
  });

  it('요청 단위로 거절되면 NhnRequestRejectedError 를 던진다', async () => {
    http.post.mockResolvedValue({ data: { header: { isSuccessful: false, resultCode: -1, resultMessage: '미승인' } } });
    await expect(
      configured().sendTemplateBatch({ templateCode: 'X', senderGroupingKey: 'c', recipients: [] }),
    ).rejects.toBeInstanceOf(NhnRequestRejectedError);
  });

  it('템플릿 단건 조회는 목록에 코드 필터를 걸고, 코드가 정확히 같은 것만 반려 사유(comments)와 함께 돌려준다', async () => {
    const row = (templateCode: string) => ({
      templateCode,
      templateName: '안내',
      templateContent: '#{name}님',
      status: 'TSC04',
      statusName: '반려',
      comments: [{ id: 1, content: '광고성 문구', userName: '심사', createdAt: '2026-09-29', status: 'REJ' }],
    });
    http.get.mockResolvedValue({
      data: {
        header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
        templateListResponse: { templates: [row('NOTICE_10'), row('NOTICE_1')] },
      },
    });
    const template = await configured().getTemplate('NOTICE_1');
    expect(http.get.mock.calls[0][0]).toBe(
      '/alimtalk/v2.3/appkeys/app/senders/sender/templates?templateCode=NOTICE_1&pageNum=1&pageSize=1000',
    );
    expect(template?.templateCode).toBe('NOTICE_1');
    expect(template?.comments[0].content).toBe('광고성 문구');
    expect(template?.buttons).toEqual([]);
  });

  it('없는 코드는 빈 목록이라 null 이다 (조회 실패와 구별된다)', async () => {
    http.get.mockResolvedValue({
      data: {
        header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
        templateListResponse: { templates: [] },
      },
    });
    expect(await configured().getTemplate('NEW_CODE')).toBeNull();
  });

  it('등록을 카카오가 거절하면 그 사유를 400 으로 돌려준다', async () => {
    http.request.mockResolvedValue({
      data: { header: { isSuccessful: false, resultCode: -1, resultMessage: '코드 중복' } },
    });
    await expect(
      configured().createTemplate('X', {
        templateName: 'a',
        templateContent: 'b',
        categoryCode: '999999',
        buttons: [],
      }),
    ).rejects.toThrow(new BadRequestError('카카오 템플릿 요청 거절: 코드 중복'));
  });

  it('키가 없으면 부팅은 되고 쓰는 순간 503 이다', async () => {
    const client = new NhnAlimtalkClient(config({}));
    expect(client.isConfigured()).toBe(false);
    await expect(client.listTemplates()).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(http.get).not.toHaveBeenCalled();
  });
});
