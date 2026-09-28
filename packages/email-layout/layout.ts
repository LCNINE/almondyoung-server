/** 알림 메일의 공통 뼈대. 발송기와 어드민 미리보기가 같이 쓴다. */
import { marked } from 'marked';

export const STOREFRONT_FALLBACK_URL = 'https://almondyoung.com';

const LAYOUT_MARKER = '<!-- almondyoung-email-layout -->';
const BORDER = '#dcdee3';
const MUTED = '#6b7280';

export interface EmailLayoutSettings {
  /** 헤더 로고 이미지 주소. 없으면 상호를 글자로 넣는다. */
  logoUrl: string | null;
  brandColor: string;
  textColor: string;
  backgroundColor: string;
  /** 푸터 문의 줄. 마크다운으로 쓴다. */
  footerContact: string;
  /** 푸터 사업자 정보. 줄바꿈으로 여러 줄. */
  footerBusiness: string;
}

export const DEFAULT_EMAIL_LAYOUT: EmailLayoutSettings = {
  logoUrl: null,
  brandColor: '#ff6600',
  textColor: '#1a1c20',
  backgroundColor: '#f7f8f9',
  footerContact: '문의: [카카오톡 채널 아몬드영](https://pf.kakao.com/_xaxgxazs) · 고객센터 1877-7184',
  footerBusiness:
    '주식회사 엘씨나인 | 대표이사 권흥철 | 사업자등록번호 467-86-01638\n[14521] 경기도 부천시 평천로832번길 42 (도당동) 4층 엘씨나인',
};

export interface EmailLayoutOptions {
  settings?: Partial<EmailLayoutSettings>;
  storefrontUrl?: string;
  advertising?: boolean;
}

marked.use({ gfm: true, breaks: true });

// 통째로 HTML 문서인 본문은 이미 제 뼈대를 갖고 있다. 감싸면 두 겹이 된다.
function isWholeDocument(body: string): boolean {
  const head = body.trimStart().toLowerCase();
  return head.startsWith('<!doctype html>') || head.startsWith('<html');
}

/** 마크다운 본문을 메일용 HTML 로 바꾼다. 옛 HTML 본문은 marked 가 그대로 통과시킨다. */
export function markdownToEmailHtml(markdown: string, settings?: Partial<EmailLayoutSettings>): string {
  const { brandColor, textColor } = { ...DEFAULT_EMAIL_LAYOUT, ...settings };
  const html = (marked.parse(markdown ?? '', { async: false }) as string)
    // marked 는 링크 주소의 중괄호를 인코딩한다. 치환은 그 뒤에 오므로 되돌려 둔다.
    .replace(/%7B%7B\s*([\w.]+)\s*%7D%7D/gi, '{{$1}}');

  return html
    .replace(/<h1>/g, `<h1 style="margin:0 0 12px;font-size:22px;color:${textColor}">`)
    .replace(/<h2>/g, `<h2 style="margin:20px 0 8px;font-size:18px;color:${textColor}">`)
    .replace(/<h([3-6])>/g, `<h$1 style="margin:16px 0 8px;font-size:16px;color:${textColor}">`)
    .replace(/<p>/g, `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${textColor}">`)
    .replace(/<a /g, `<a style="color:${brandColor}" `)
    .replace(/<ul>/g, '<ul style="margin:0 0 12px;padding-left:20px">')
    .replace(/<ol>/g, '<ol style="margin:0 0 12px;padding-left:20px">')
    .replace(/<li>/g, `<li style="font-size:15px;line-height:24px;color:${textColor}">`)
    .replace(
      /<table>/g,
      `<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid ${BORDER};border-radius:8px;border-collapse:collapse">`,
    )
    .replace(/<th>/g, `<th align="left" style="padding:8px 12px;font-size:13px;color:${MUTED};border-bottom:1px solid ${BORDER}">`)
    .replace(/<td>/g, `<td style="padding:8px 12px;font-size:14px;color:${textColor};border-bottom:1px solid ${BORDER}">`)
    .replace(/<img /g, '<img style="max-width:100%;border-radius:8px" ')
    .replace(/<hr>/g, `<hr style="border:none;border-top:1px solid ${BORDER};margin:20px 0">`)
    .replace(
      /<blockquote>/g,
      `<blockquote style="margin:0 0 12px;padding:12px 16px;background:#f7f8f9;border-radius:8px;color:${textColor}">`,
    );
}

function footerRows(settings: EmailLayoutSettings, baseUrl: string, advertising: boolean): string {
  const line = (html: string) => `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${MUTED}">${html}</p>`;
  const contact = markdownToEmailHtml(settings.footerContact, settings)
    .replace(/<\/?p[^>]*>/g, '')
    .replace(/style="color:[^"]*"/g, `style="color:${MUTED}"`)
    .trim();

  const rows = [contact, ...settings.footerBusiness.split('\n').filter((row) => row.trim())].map(line);
  if (advertising) {
    rows.push(
      line(
        '본 메일은 광고성 정보 수신에 동의하신 분께 발송되었습니다. 수신을 원하지 않으시면 ' +
          `<a href="${baseUrl}/kr/mypage/account/profile#marketing-consent" style="color:${MUTED}">마이페이지 수신 설정</a>에서 변경하실 수 있습니다.`,
      ),
    );
  }
  return rows.join('');
}

export function wrapEmailLayout(body: string, options: EmailLayoutOptions = {}): string {
  const settings = { ...DEFAULT_EMAIL_LAYOUT, ...options.settings };
  const baseUrl = options.storefrontUrl?.replace(/\/$/, '') || STOREFRONT_FALLBACK_URL;
  const advertising = options.advertising === true;

  // 옛 템플릿은 제 뼈대를 들고 있어 감싸면 두 겹이 된다. 대신 푸터만 문서 끝에 덧댄다 —
  // 광고 메일의 수신거부 안내는 법정 표기라 빠뜨릴 수 없다.
  if (body.includes(LAYOUT_MARKER)) return body;
  if (isWholeDocument(body)) {
    const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px"><tr><td style="padding:0 24px 24px">${footerRows(settings, baseUrl, advertising)}</td></tr></table></td></tr></table>`;
    return body.includes('</body>') ? body.replace('</body>', `${footer}</body>`) : body + footer;
  }

  const logo = settings.logoUrl
    ? `<img src="${settings.logoUrl}" alt="아몬드영" height="28" style="height:28px">`
    : `<span style="color:${settings.brandColor};font-size:18px;font-weight:700">아몬드영</span>`;

  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${settings.backgroundColor};color:${settings.textColor};font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif">
${LAYOUT_MARKER}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${settings.backgroundColor};padding:24px 12px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid ${BORDER}">
            <a href="${baseUrl}" style="text-decoration:none">${logo}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:24px">${body}</td>
        </tr>
        <tr>
          <td style="padding:16px 24px 24px;border-top:1px solid ${BORDER}">${footerRows(settings, baseUrl, advertising)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** 마크다운 본문을 뼈대까지 씌운 최종 메일 HTML. 발송기와 미리보기가 이 함수를 쓴다. */
export function renderEmail(markdown: string, options: EmailLayoutOptions = {}): string {
  const body = isWholeDocument(markdown) ? markdown : markdownToEmailHtml(markdown, options.settings);
  return wrapEmailLayout(body, options);
}
