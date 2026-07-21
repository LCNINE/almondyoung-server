#!/usr/bin/env node
/**
 * 이메일 템플릿 시드/갱신 (멱등 — 이미 있으면 contents 를 덮어쓴다).
 *
 * apps/setup-notification-data.js 는 최초 1회 INSERT 전용이라 이미 들어간 행을 갱신하지 못한다.
 * 템플릿 문구·디자인은 코드 배포와 무관한 "데이터" 라서, 배포 대신 이 스크립트로 반영한다.
 *
 *   DATABASE_URL=postgresql://... node apps/notification/scripts/seed-email-templates.js [--apply]
 *
 * --apply 없이 실행하면 무엇이 바뀌는지만 출력한다 (dry-run).
 */
const postgres = require('postgres');

const BRAND = '#ff6600'; // 스토어프론트 primary 와 통일 (옛 #f29219 폐기)

/** 모든 메일이 공유하는 바깥 껍데기. 테이블 레이아웃 = 메일 클라이언트 호환용. */
const layout = ({ heading, intro, highlight = '', outro }) => `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background-color:#f5f5f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;padding:40px 32px;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;"><tr><td style="font-size:22px;font-weight:800;color:${BRAND};padding-bottom:24px;">아몬드영</td></tr><tr><td style="font-size:24px;font-weight:700;color:#111111;padding-bottom:16px;">${heading}</td></tr><tr><td style="font-size:15px;line-height:1.6;color:#444444;padding-bottom:24px;">${intro}</td></tr>${highlight}<tr><td style="font-size:13px;color:#888888;padding-bottom:32px;">${outro}</td></tr><tr><td style="border-top:1px solid #eeeeee;padding-top:20px;font-size:12px;line-height:1.6;color:#aaaaaa;">본 메일은 발신 전용입니다.<br/>&copy; Almond Young. All rights reserved.</td></tr></table></td></tr></table></body></html>`;

/** 큰 글씨 코드/아이디 박스 (인증코드, 아이디찾기) */
const codeBox = (v, opts = {}) =>
  `<tr><td align="center" style="padding-bottom:24px;"><div style="display:inline-block;background-color:#f7f7f7;border:1px solid #e5e5e5;border-radius:10px;padding:18px 32px;font-size:${opts.size || 34}px;font-weight:800;letter-spacing:${opts.spacing || 8}px;color:#111111;">${v}</div></td></tr>`;

/** CTA 버튼 */
const button = (label, url) =>
  `<tr><td align="center" style="padding-bottom:24px;"><a href="${url}" style="display:inline-block;background-color:#111111;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;">${label}</a></td></tr>`;

/** 라벨-값 요약 카드 (주문/결제/입금 안내) */
const infoCard = (rows) =>
  `<tr><td style="padding-bottom:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border:1px solid #e5e5e5;border-radius:10px;padding:20px 24px;">${rows
    .map(
      ([label, value, strong]) =>
        `<tr><td style="font-size:14px;color:#888888;padding:4px 0;">${label}</td><td align="right" style="font-size:${strong ? 18 : 14}px;font-weight:${strong ? 800 : 600};color:${strong ? BRAND : '#111111'};padding:4px 0;">${value}</td></tr>`,
    )
    .join('')}</table></td></tr>`;

const TEMPLATES = [
  {
    key: 'USER_VERIFICATION_EMAIL',
    name: '회원가입 이메일 인증',
    subject: '[아몬드영] 이메일 인증을 완료해 주세요',
    // 변수명은 user-event.consumer 가 실제로 넘기는 것과 일치해야 한다
    // (name, email, verificationToken, callbackUrl, redirectTo). 링크는 callbackUrl.
    vars: { name: 'string', callbackUrl: 'string' },
    body: layout({
      heading: '이메일 인증을 완료해 주세요',
      intro: '{{name}}님, 아몬드영 회원가입을 환영합니다!<br/>아래 버튼을 눌러 이메일 인증을 완료해 주세요.',
      highlight: button('이메일 인증하기', '{{callbackUrl}}'),
      outro: '이 링크는 24시간 내에 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.',
    }),
  },
  {
    key: 'USER_VERIFICATION_CODE_EMAIL',
    name: '인증 코드',
    subject: '[아몬드영] 인증 코드 {{code}}',
    vars: { name: 'string', code: 'string' },
    body: layout({
      heading: '인증 코드를 입력해 주세요',
      intro: '{{name}}님, 안녕하세요.<br/>요청하신 인증 코드는 아래와 같습니다.',
      highlight: codeBox('{{code}}'),
      outro: '이 코드는 3분 내에 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.',
    }),
  },
  {
    key: 'USER_PASSWORD_CHANGED_EMAIL',
    name: '비밀번호 변경 알림',
    subject: '[아몬드영] 비밀번호가 변경되었습니다',
    vars: { name: 'string', accountUrl: 'string' },
    body: layout({
      heading: '비밀번호 변경 알림',
      intro:
        '{{name}}님, 안녕하세요.<br/>회원님의 비밀번호가 변경되었습니다. 계정 정보를 확인하시려면 아래 버튼을 눌러 주세요.',
      highlight: button('계정 페이지', '{{accountUrl}}'),
      outro: '본인이 요청한 변경이 아니라면, 보안을 위해 즉시 고객센터로 연락해 주세요.',
    }),
  },
  {
    key: 'ORDER_CREATED_EMAIL',
    name: '주문 접수',
    subject: '[아몬드영] 주문이 접수되었습니다',
    vars: { name: 'string', orderNumber: 'string', total: 'number' },
    body: layout({
      heading: '주문이 접수되었습니다',
      intro: '{{name}}님, 안녕하세요.<br/>결제가 확인되어 주문이 정상 접수되었습니다.',
      highlight: infoCard([
        ['주문번호', '{{orderNumber}}'],
        ['결제금액', '{{total}}원', true],
      ]),
      outro: '상품 준비가 완료되면 배송 시작 안내를 드리겠습니다.',
    }),
  },
  {
    key: 'PAYMENT_COMPLETED_EMAIL',
    name: '결제 완료',
    subject: '[아몬드영] 결제가 완료되었습니다',
    vars: { name: 'string', orderNumber: 'string', amount: 'number' },
    body: layout({
      heading: '결제가 완료되었습니다',
      intro: '{{name}}님, 안녕하세요.<br/>결제가 정상적으로 처리되었습니다.',
      highlight: infoCard([
        ['주문번호', '{{orderNumber}}'],
        ['결제금액', '{{amount}}원', true],
      ]),
      outro: '결제 내역은 마이페이지에서 확인하실 수 있습니다.',
    }),
  },
  {
    // 신규 — 무통장(가상계좌) 발급 직후 계좌·기한 안내.
    // 이 메일이 없으면 고객이 결제창을 닫는 순간 입금할 계좌를 다시 볼 방법이 없다.
    key: 'BANK_TRANSFER_ISSUED_EMAIL',
    name: '무통장 입금 안내',
    subject: '[아몬드영] 입금 안내 - {{bankName}} {{accountNumber}}',
    vars: {
      name: 'string',
      bankName: 'string',
      accountNumber: 'string',
      accountHolder: 'string',
      amount: 'number',
      dueDate: 'string',
    },
    body: layout({
      heading: '입금 안내',
      intro: '{{name}}님, 안녕하세요.<br/>아래 계좌로 입금해 주시면 주문이 확정됩니다.',
      highlight: infoCard([
        ['은행', '{{bankName}}'],
        ['계좌번호', '{{accountNumber}}'],
        ['예금주', '{{accountHolder}}'],
        ['입금기한', '{{dueDate}}'],
        ['입금금액', '{{amount}}원', true],
      ]),
      outro:
        '입금기한이 지나면 주문이 자동으로 취소됩니다. 입금이 확인되면 주문 접수 안내를 다시 보내드립니다.',
    }),
  },
  {
    key: 'MARKETING_PROMOTION_EMAIL',
    name: '프로모션 안내',
    subject: '[아몬드영] {{promotionTitle}}',
    vars: { name: 'string', promotionTitle: 'string', promotionUrl: 'string' },
    body: layout({
      heading: '{{promotionTitle}}',
      intro: '{{name}}님, 안녕하세요.<br/>아몬드영이 준비한 특별한 혜택을 확인해 보세요.',
      highlight: button('혜택 보러가기', '{{promotionUrl}}'),
      outro: '수신을 원하지 않으시면 마이페이지에서 마케팅 수신 동의를 해제하실 수 있습니다.',
    }),
  },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const sql = postgres(process.env.DATABASE_URL, { ssl: process.env.DATABASE_URL.includes('sslmode=require') ? 'require' : false });

  for (const t of TEMPLATES) {
    const contents = { EMAIL: { ko: { subject: t.subject, body: t.body } } };
    const schema = Object.fromEntries(
      Object.entries(t.vars).map(([k, type]) => [k, { type, required: true }]),
    );
    const [existing] = await sql`SELECT template_id FROM templates WHERE template_key = ${t.key}`;

    if (!apply) {
      console.log(`${existing ? 'UPDATE' : 'INSERT'}  ${t.key.padEnd(30)} (${t.body.length} bytes)`);
      continue;
    }

    if (existing) {
      await sql`UPDATE templates SET contents = ${sql.json(contents)}, variables_schema = ${sql.json(schema)},
                name = ${t.name}, is_active = true, updated_at = now() WHERE template_key = ${t.key}`;
      console.log(`UPDATED ${t.key}`);
    } else {
      await sql`INSERT INTO templates (template_id, template_key, name, category, contents, variables_schema, version, is_active)
                VALUES (gen_random_uuid(), ${t.key}, ${t.name}, 'TRANSACTIONAL', ${sql.json(contents)}, ${sql.json(schema)}, 1, true)`;
      console.log(`INSERTED ${t.key}`);
    }
  }

  console.log(apply ? '\n완료.' : '\ndry-run — 반영하려면 --apply 를 붙이세요.');
  await sql.end();
})();
