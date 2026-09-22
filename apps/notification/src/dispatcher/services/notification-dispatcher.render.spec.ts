import { Channel, NotificationCategory } from '../../shared/enums';
import { NotificationDispatcherService } from './notification-dispatcher.service';

describe('디스패처 본문 조립 — 광고 메일 표기', () => {
  const service = new NotificationDispatcherService(null as never, null, null as never, null as never, null as never);
  const template = { contents: { ko: { EMAIL: { subject: '[아몬드영] {{name}}님 쿠폰 안내', body: '<p>{{name}}님</p>' } } } };

  const render = (category: NotificationCategory, channel: Channel = Channel.EMAIL) =>
    service['renderContent']({ channel, category, language: 'ko', template, variables: { name: '홍길동' } });

  it('MARKETING 메일은 치환된 제목 앞에 (광고)를, 본문 끝에 수신 설정 안내를 붙인다', () => {
    const { subject, body } = render(NotificationCategory.MARKETING);
    expect(subject).toBe('(광고) [아몬드영] 홍길동님 쿠폰 안내');
    expect(body).toContain('<p>홍길동님</p>');
    expect(body).toContain('마이페이지 수신 설정');
  });

  it('거래성 메일과 광고 SMS 에는 붙이지 않는다', () => {
    expect(render(NotificationCategory.CUSTOMER_SERVICE).subject).toBe('[아몬드영] 홍길동님 쿠폰 안내');
    expect(render(NotificationCategory.MARKETING, Channel.SMS).body).not.toContain('수신 설정');
  });

  it('본문 없이 외부 템플릿만 가리키는 광고 메일은 안내를 붙일 수 없으니 거부한다', () => {
    expect(() =>
      service['renderContent']({
        channel: Channel.EMAIL,
        category: NotificationCategory.MARKETING,
        language: 'ko',
        template: { providerTemplateId: 'resend-tmpl' },
      }),
    ).toThrow('광고 메일');
  });

  it('템플릿에 다른 채널 본문만 있는 광고 메일도 거부한다 (payload JSON 대체 본문으로 보내지 않는다)', () => {
    expect(() =>
      service['renderContent']({
        channel: Channel.EMAIL,
        category: NotificationCategory.MARKETING,
        language: 'ko',
        template: { contents: { ko: { SMS: { body: '문자 본문' } } } },
        payload: { userId: 'user-1' },
      }),
    ).toThrow('광고 메일');
  });
});
