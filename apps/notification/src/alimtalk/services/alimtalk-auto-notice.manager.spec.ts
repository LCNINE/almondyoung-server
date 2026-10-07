import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { AlimtalkAutoNoticeManager } from './alimtalk-auto-notice.manager';
import { AutoNoticeSetting } from '../repositories/alimtalk.repository';

const KEY = 'MEMBERSHIP_MANDATE_REJECTED_WITH_ARREARS';

const makeManager = (opts: { settings?: AutoNoticeSetting[]; variables?: string[]; approved?: boolean } = {}) => {
  let settings = opts.settings ?? [];
  const repository = {
    findAutoNoticeSettings: jest.fn((keys: string[]) =>
      Promise.resolve(settings.filter((s) => keys.includes(s.eventKey))),
    ),
    linkAutoNotice: jest.fn((link: { eventKey: string; templateCode: string }) => {
      const existing = settings.find((s) => s.eventKey === link.eventKey);
      settings = existing
        ? settings.map((s) => (s.eventKey === link.eventKey ? { ...s, kakaoTemplateCode: link.templateCode } : s))
        : [
            ...settings,
            {
              eventKey: link.eventKey,
              templateKey: link.eventKey,
              isActive: false,
              kakaoTemplateCode: link.templateCode,
            },
          ];
      return Promise.resolve();
    }),
    unlinkAutoNotice: jest.fn(),
  };
  const templateReader = {
    getApproved: jest.fn((code: string) => {
      if (opts.approved === false)
        return Promise.reject(new BadRequestError('카카오 승인이 끝난 템플릿으로만 보낼 수 있습니다'));
      return Promise.resolve({
        templateCode: code,
        templateName: '계좌 거절 해지 안내',
        templateContent: '#{name}님 …',
        variables: opts.variables ?? ['name', 'period', 'arrearsAmount'],
      });
    }),
  };
  return { manager: new AlimtalkAutoNoticeManager(repository as never, templateReader as never), repository };
};

const setting = (over: Partial<AutoNoticeSetting> = {}): AutoNoticeSetting => ({
  eventKey: KEY,
  templateKey: KEY,
  isActive: false,
  kakaoTemplateCode: null,
  ...over,
});

describe('알림톡 자동 알림 연결', () => {
  it('목록은 코드가 보내는 알림 전부를 보여 주고, 설정 행이 없는 것은 configured=false 로 둔다', async () => {
    const { manager } = makeManager({
      settings: [setting({ kakaoTemplateCode: 'MEMB_MREJ_ARREARS', isActive: true })],
    });
    const list = await manager.list();
    expect(list.find((n) => n.eventKey === KEY)).toMatchObject({
      configured: true,
      isActive: true,
      templateCode: 'MEMB_MREJ_ARREARS',
    });
    expect(list.find((n) => n.eventKey === 'MEMBERSHIP_MANDATE_REJECTED_NO_ARREARS')).toMatchObject({
      configured: false,
      isActive: false,
      templateCode: null,
    });
  });

  it('설정 행이 없으면 꺼진 채로 만들며 잇는다 — 알림이 채우는 변수 목록을 함께 넘긴다', async () => {
    const { manager, repository } = makeManager();
    const view = await manager.link(KEY, 'MEMB_MREJ_ARREARS');
    expect(repository.linkAutoNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: KEY,
        templateCode: 'MEMB_MREJ_ARREARS',
        variables: ['name', 'period', 'arrearsAmount'],
      }),
    );
    expect(view).toMatchObject({ configured: true, isActive: false, templateCode: 'MEMB_MREJ_ARREARS' });
  });

  it('코드가 보내지 않는 알림에는 잇지 않는다', async () => {
    const { manager } = makeManager();
    await expect(manager.link('ORDER_SHIPPED', 'MEMB_MREJ_ARREARS')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('승인 전 템플릿은 잇지 않는다', async () => {
    const { manager, repository } = makeManager({ approved: false });
    await expect(manager.link(KEY, 'MEMB_MREJ_ARREARS')).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.linkAutoNotice).not.toHaveBeenCalled();
  });

  it('알림이 채우지 않는 변수를 쓰는 템플릿은 막고, 쓸 수 있는 변수를 알려 준다', async () => {
    const { manager, repository } = makeManager({ variables: ['name', 'reason'] });
    await expect(manager.link(KEY, 'MEMB_BILL_FAIL')).rejects.toThrow('#{reason}');
    expect(repository.linkAutoNotice).not.toHaveBeenCalled();
  });

  it('알림이 채우는 변수의 일부만 쓰는 템플릿은 잇는다', async () => {
    const { manager } = makeManager({ variables: ['name'] });
    await expect(manager.link(KEY, 'MEMB_MREJ_NOARREARS')).resolves.toMatchObject({
      templateCode: 'MEMB_MREJ_NOARREARS',
    });
  });

  it('켜진 알림의 템플릿은 확인 없이 바꾸지 않는다', async () => {
    const { manager, repository } = makeManager({ settings: [setting({ isActive: true, kakaoTemplateCode: 'OLD' })] });
    await expect(manager.link(KEY, 'MEMB_MREJ_ARREARS')).rejects.toBeInstanceOf(ConflictError);
    expect(repository.linkAutoNotice).not.toHaveBeenCalled();
    await expect(manager.link(KEY, 'MEMB_MREJ_ARREARS', true)).resolves.toMatchObject({
      templateCode: 'MEMB_MREJ_ARREARS',
    });
  });

  it('이미 같은 템플릿이면 아무것도 쓰지 않는다', async () => {
    const { manager, repository } = makeManager({
      settings: [setting({ isActive: true, kakaoTemplateCode: 'MEMB_MREJ_ARREARS' })],
    });
    await manager.link(KEY, 'MEMB_MREJ_ARREARS');
    expect(repository.linkAutoNotice).not.toHaveBeenCalled();
  });

  it('켜진 알림은 떼지 않는다', async () => {
    const { manager, repository } = makeManager({ settings: [setting({ isActive: true, kakaoTemplateCode: 'X' })] });
    await expect(manager.unlink(KEY)).rejects.toBeInstanceOf(ConflictError);
    expect(repository.unlinkAutoNotice).not.toHaveBeenCalled();
  });
});
