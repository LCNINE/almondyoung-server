import { DEFAULT_EMAIL_LAYOUT, markdownToEmailHtml, renderEmail } from './layout';

describe('메일 본문 마크다운', () => {
  it('제목·굵게·목록·링크·표를 메일용 HTML 로 바꾼다', () => {
    const html = markdownToEmailHtml(
      ['## 주문이 접수되었습니다', '', '**{{name}}님**, 감사합니다.', '', '| 주문번호 | 금액 |', '| --- | --- |', '| {{orderNumber}} | {{total}}원 |'].join('\n'),
    );

    expect(html).toContain('<h2 style=');
    expect(html).toContain('<strong>{{name}}님</strong>');
    expect(html).toContain('<table cellpadding="0"');
    expect(html).toContain('{{orderNumber}}');
  });

  it('이미지에는 폭 제한을 넣는다', () => {
    expect(markdownToEmailHtml('![배너](https://file.almondyoung.com/files/public/abc)')).toContain(
      '<img style="max-width:100%',
    );
  });

  it('옛 HTML 본문도 깨지지 않는다', () => {
    expect(markdownToEmailHtml('<p>이미 HTML 입니다.</p>')).toContain('이미 HTML 입니다.');
  });
});

describe('공통 메일 레이아웃', () => {
  it('본문을 감싸고 로고·고객센터·사업자 정보를 넣는다', () => {
    const html = renderEmail('안녕하세요.', { storefrontUrl: 'https://almondyoung.com/' });

    expect(html).toContain('안녕하세요.');
    expect(html).toContain('아몬드영</span>');
    expect(html).toContain('고객센터 1877-7184');
    expect(html).toContain('467-86-01638');
    expect(html).toContain('href="https://almondyoung.com"');
  });

  it('설정한 로고와 색을 쓴다', () => {
    const html = renderEmail('본문', {
      settings: { logoUrl: 'https://cdn.example.com/logo.png', brandColor: '#123456' },
    });

    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
    expect(html).not.toContain(DEFAULT_EMAIL_LAYOUT.brandColor);
  });

  it('광고 메일에만 수신 설정 안내를 넣는다', () => {
    expect(renderEmail('본문')).not.toContain('마이페이지 수신 설정');
    expect(renderEmail('본문', { advertising: true })).toContain('/kr/mypage/account/profile#marketing-consent');
  });

  it('이미 감싼 본문은 다시 감싸지 않는다', () => {
    const once = renderEmail('본문');
    expect(renderEmail(once)).toBe(once);
  });

  it('표식과 같은 글자가 본문에 섞여 있어도 그건 감싼 것이 아니다', () => {
    const html = renderEmail('almondyoung-email-layout 님, 안녕하세요.', { advertising: true });

    expect(html).toContain('고객센터 1877-7184');
    expect(html).toContain('/kr/mypage/account/profile#marketing-consent');
  });
});

describe('옛 전면 HTML 템플릿', () => {
  const legacy = '<!doctype html><html lang="ko"><body><p>옛 템플릿 본문</p></body></html>';

  it('뼈대를 두 번 씌우지 않는다', () => {
    const html = renderEmail(legacy);
    expect(html.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(html).toContain('옛 템플릿 본문');
  });

  it('광고 메일이면 수신 설정 안내와 사업자 정보는 덧붙인다', () => {
    const html = renderEmail(legacy, { advertising: true });
    expect(html).toContain('/kr/mypage/account/profile#marketing-consent');
    expect(html).toContain('467-86-01638');
    expect(html.indexOf('marketing-consent')).toBeLessThan(html.indexOf('</body>'));
  });
});
