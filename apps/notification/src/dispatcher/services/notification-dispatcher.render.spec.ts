import { Channel, NotificationCategory } from '../../shared/enums';
import { NotificationDispatcherService } from './notification-dispatcher.service';

describe('디스패처 본문 조립 — 광고 메일 표기', () => {
  const service = new NotificationDispatcherService(
    null as never,
    null,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const template = {
    contents: { ko: { EMAIL: { subject: '[아몬드영] {{name}}님 쿠폰 안내', body: '{{name}}님, 쿠폰이 곧 만료됩니다.' } } },
  };

  const render = (category: NotificationCategory, channel: Channel = Channel.EMAIL) =>
    service['renderContent']({ channel, category, language: 'ko', template, variables: { name: '홍길동' } });

  it('MARKETING 메일은 치환된 제목 앞에 (광고)를, 푸터에 수신 설정 안내를 붙인다', () => {
    const { subject, body } = render(NotificationCategory.MARKETING);
    expect(subject).toBe('(광고) [아몬드영] 홍길동님 쿠폰 안내');
    expect(body).toContain('홍길동님, 쿠폰이 곧 만료됩니다.');
    expect(body).toContain('마이페이지 수신 설정');
  });

  it('거래성 메일도 공통 레이아웃으로 감싸되 수신 설정 안내는 넣지 않는다', () => {
    const { subject, body } = render(NotificationCategory.CUSTOMER_SERVICE);
    expect(subject).toBe('[아몬드영] 홍길동님 쿠폰 안내');
    expect(body).toContain('홍길동님, 쿠폰이 곧 만료됩니다.');
    expect(body).toContain('고객센터 1877-7184');
    expect(body).not.toContain('마이페이지 수신 설정');
  });

  it('광고 SMS 는 감싸지 않는다', () => {
    const smsBody = render(NotificationCategory.MARKETING, Channel.SMS).body;
    expect(smsBody).not.toContain('수신 설정');
    expect(smsBody).not.toContain('<!doctype html>');
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

  it('고객이 적은 값에 마크다운 링크가 들어 있어도 링크로 만들지 않는다', () => {
    const attack = { contents: { ko: { EMAIL: { subject: '안내', body: '{{name}}님, 안녕하세요.' } } } };
    const { body } = service['renderContent']({
      channel: Channel.EMAIL,
      category: NotificationCategory.CUSTOMER_SERVICE,
      language: 'ko',
      template: attack,
      variables: { name: '[계좌 확인](https://attacker.example/verify)' },
    });

    expect(body).not.toContain('attacker.example/verify"');
    expect(body).not.toContain('<a href="https://attacker.example');
    expect(body).toContain('[계좌 확인](https://attacker.example/verify)님');
  });

  it('템플릿이 쓴 링크는 그대로 링크가 된다', () => {
    const template = {
      contents: { ko: { EMAIL: { subject: '안내', body: '[주문 내역]({{orderUrl}})을 확인하세요.' } } },
    };
    const { body } = service['renderContent']({
      channel: Channel.EMAIL,
      category: NotificationCategory.CUSTOMER_SERVICE,
      language: 'ko',
      template,
      variables: { orderUrl: 'https://almondyoung.com/kr/mypage/order/list' },
    });

    expect(body).toContain('href="https://almondyoung.com/kr/mypage/order/list"');
  });
});
