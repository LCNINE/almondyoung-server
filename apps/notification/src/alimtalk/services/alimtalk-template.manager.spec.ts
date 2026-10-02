import { BadRequestError, ConflictError } from '@app/shared';
import { AlimtalkTemplateManager } from './alimtalk-template.manager';
import { AlimtalkTemplateView } from './alimtalk-template.reader';

const view = (over: Partial<AlimtalkTemplateView> = {}): AlimtalkTemplateView => ({
  templateCode: 'NOTICE_1',
  kakaoTemplateCode: null,
  templateName: '안내',
  templateContent: '#{name}님, 안내드립니다',
  templateMessageType: 'BA',
  templateEmphasizeType: 'NONE',
  categoryCode: '999999',
  buttons: [],
  comments: [],
  status: 'TSC04',
  statusName: '반려',
  createDate: null,
  updateDate: null,
  variables: ['name'],
  linkedEvents: [],
  ...over,
});

const dto = {
  templateName: '안내',
  templateContent: '#{name}님, 새 안내',
  categoryCode: '999999',
  buttons: [{ name: '확인하기', linkMo: 'https://example.com' }],
};

function setup(template: AlimtalkTemplateView | null, pending = 0, ownPhone: string | null = '01012345678') {
  const client = {
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    addComment: jest.fn(),
    sendTemplateBatch: jest.fn().mockResolvedValue({
      requestId: 'req-1',
      results: [{ recipientGroupingKey: 'test:admin-1', resultCode: 0, resultMessage: '' }],
    }),
  };
  const reader = {
    exists: jest.fn().mockResolvedValue(template !== null),
    get: jest.fn().mockResolvedValue(template),
    getApproved: jest.fn().mockImplementation(async () => {
      if (template?.status !== 'TSC03') throw new BadRequestError('미승인');
      return template;
    }),
  };
  const repository = { countPendingByTemplate: jest.fn().mockResolvedValue(pending) };
  const contacts = {
    findContacts: jest
      .fn()
      .mockResolvedValue(new Map([['admin-1', { userId: 'admin-1', phoneNumber: ownPhone, username: '관리자' }]])),
  };
  const manager = new AlimtalkTemplateManager(client as never, reader as never, repository as never, contacts as never);
  return { manager, client, contacts };
}

describe('AlimtalkTemplateManager', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = 'production';
  });
  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('이미 있는 코드로 만들면 NHN 에 보내지 않고 막는다', async () => {
    const { manager, client } = setup(view());
    await expect(manager.create({ templateCode: 'NOTICE_1', ...dto })).rejects.toBeInstanceOf(ConflictError);
    expect(client.createTemplate).not.toHaveBeenCalled();
  });

  it('버튼은 웹링크로 순서를 붙여 등록한다', async () => {
    const { manager, client } = setup(null);
    await manager.create({ templateCode: 'NEW_1', ...dto }).catch(() => undefined);
    expect(client.createTemplate).toHaveBeenCalledWith('NEW_1', {
      templateName: '안내',
      templateContent: '#{name}님, 새 안내',
      categoryCode: '999999',
      buttons: [{ ordering: 1, type: 'WL', name: '확인하기', linkMo: 'https://example.com' }],
    });
  });

  it('반려된 템플릿은 바로 고쳐 다시 심사를 요청한다', async () => {
    const { manager, client } = setup(view({ status: 'TSC04' }));
    await manager.update('NOTICE_1', dto);
    expect(client.updateTemplate).toHaveBeenCalledTimes(1);
  });

  it('검수 중인 템플릿은 고치지 않는다', async () => {
    const { manager, client } = setup(view({ status: 'TSC02' }));
    await expect(manager.update('NOTICE_1', dto)).rejects.toBeInstanceOf(BadRequestError);
    expect(client.updateTemplate).not.toHaveBeenCalled();
  });

  it('켜진 이벤트 알림이 쓰는 템플릿은 고치지 않는다 (재심사 동안 그 알림이 멈춘다)', async () => {
    const { manager, client } = setup(
      view({ status: 'TSC03', linkedEvents: [{ eventKey: 'E', name: '출금 실패', isActive: true }] }),
    );
    await expect(manager.update('NOTICE_1', { ...dto, acknowledgeReReview: true })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(client.updateTemplate).not.toHaveBeenCalled();
  });

  it('아직 나가지 않은 대량 발송이 쓰는 템플릿은 고치지 않는다', async () => {
    const { manager, client } = setup(view({ status: 'TSC03' }), 3);
    await expect(manager.update('NOTICE_1', { ...dto, acknowledgeReReview: true })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(client.updateTemplate).not.toHaveBeenCalled();
  });

  it('승인된 템플릿은 재심사 확인이 있어야 고친다', async () => {
    const { manager, client } = setup(view({ status: 'TSC03' }));
    await expect(manager.update('NOTICE_1', dto)).rejects.toBeInstanceOf(BadRequestError);
    await manager.update('NOTICE_1', { ...dto, acknowledgeReReview: true });
    expect(client.updateTemplate).toHaveBeenCalledTimes(1);
  });

  it('시험 발송은 로그인한 관리자 본인 번호로만 간다', async () => {
    const { manager, client, contacts } = setup(view({ status: 'TSC03' }));
    const result = await manager.testSend('NOTICE_1', 'admin-1', { variables: [{ name: 'name', value: '관리자' }] });
    expect(contacts.findContacts).toHaveBeenCalledWith(['admin-1']);
    const sent = client.sendTemplateBatch.mock.calls[0][0];
    expect(sent.recipients).toEqual([
      { recipientNo: '01012345678', templateParameter: { name: '관리자' }, recipientGroupingKey: 'test:admin-1' },
    ]);
    expect(result.sentTo).toBe('010-****-5678');
  });

  it('본인 번호가 없거나 변수가 비면 보내지 않는다', async () => {
    const noPhone = setup(view({ status: 'TSC03' }), 0, null);
    await expect(
      noPhone.manager.testSend('NOTICE_1', 'admin-1', { variables: [{ name: 'name', value: 'a' }] }),
    ).rejects.toBeInstanceOf(BadRequestError);
    const empty = setup(view({ status: 'TSC03' }));
    await expect(empty.manager.testSend('NOTICE_1', 'admin-1', { variables: [] })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(noPhone.client.sendTemplateBatch).not.toHaveBeenCalled();
    expect(empty.client.sendTemplateBatch).not.toHaveBeenCalled();
  });

  it('승인 전 템플릿으로는 시험 발송도 하지 않는다', async () => {
    const { manager, client } = setup(view({ status: 'TSC02' }));
    await expect(
      manager.testSend('NOTICE_1', 'admin-1', { variables: [{ name: 'name', value: 'a' }] }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(client.sendTemplateBatch).not.toHaveBeenCalled();
  });
});
