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

const md = (...lines) => lines.join('\n');

/** 라벨-값 묶음. 공통 레이아웃이 회색 박스로 그린다. */
const infoBox = (rows) => rows.map(([label, value]) => `> **${label}** · ${value}`).join('\n');

const TEMPLATES = [
  {
    key: 'USER_VERIFICATION_EMAIL',
    name: '회원가입 이메일 인증',
    subject: '[아몬드영] 이메일 인증을 완료해 주세요',
    // 변수명은 user-event.consumer 가 실제로 넘기는 것과 일치해야 한다
    // (name, email, verificationToken, callbackUrl, redirectTo). 링크는 callbackUrl.
    vars: { name: 'string', callbackUrl: 'string' },
    body: md(
      '## 이메일 인증을 완료해 주세요',
      '',
      '{{name}}님, 아몬드영 회원가입을 환영합니다!',
      '아래 링크를 눌러 이메일 인증을 완료해 주세요.',
      '',
      '[이메일 인증하기]({{callbackUrl}})',
      '',
      '이 링크는 24시간 내에 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.',
    ),
  },
  {
    key: 'USER_VERIFICATION_CODE_EMAIL',
    name: '인증 코드',
    subject: '[아몬드영] 인증 코드 {{code}}',
    vars: { name: 'string', code: 'string' },
    body: md(
      '## 인증 코드를 입력해 주세요',
      '',
      '{{name}}님, 안녕하세요.',
      '요청하신 인증 코드는 아래와 같습니다.',
      '',
      '# {{code}}',
      '',
      '이 코드는 3분 내에 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.',
    ),
  },
  {
    key: 'USER_PASSWORD_CHANGED_EMAIL',
    name: '비밀번호 변경 알림',
    subject: '[아몬드영] 비밀번호가 변경되었습니다',
    vars: { name: 'string', accountUrl: 'string' },
    body: md(
      '## 비밀번호 변경 알림',
      '',
      '{{name}}님, 안녕하세요.',
      '회원님의 비밀번호가 변경되었습니다.',
      '',
      '[계정 페이지 열기]({{accountUrl}})',
      '',
      '본인이 요청한 변경이 아니라면, 보안을 위해 즉시 고객센터로 연락해 주세요.',
    ),
  },
  {
    key: 'ORDER_CREATED_EMAIL',
    name: '주문 접수',
    subject: '[아몬드영] 주문이 접수되었습니다',
    vars: { name: 'string', orderNumber: 'string', total: 'number' },
    body: md(
      '## 주문이 접수되었습니다',
      '',
      '{{name}}님, 안녕하세요.',
      '결제가 확인되어 주문이 정상 접수되었습니다.',
      '',
      infoBox([
        ['주문번호', '{{orderNumber}}'],
        ['결제금액', '{{total}}원'],
      ]),
      '',
      '상품 준비가 완료되면 배송 시작 안내를 드리겠습니다.',
    ),
  },
  {
    key: 'PAYMENT_COMPLETED_EMAIL',
    name: '결제 완료',
    subject: '[아몬드영] 결제가 완료되었습니다',
    vars: { name: 'string', orderNumber: 'string', amount: 'number' },
    body: md(
      '## 결제가 완료되었습니다',
      '',
      '{{name}}님, 안녕하세요.',
      '결제가 정상적으로 처리되었습니다.',
      '',
      infoBox([
        ['주문번호', '{{orderNumber}}'],
        ['결제금액', '{{amount}}원'],
      ]),
      '',
      '결제 내역은 마이페이지에서 확인하실 수 있습니다.',
    ),
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
    body: md(
      '## 입금 안내',
      '',
      '{{name}}님, 안녕하세요.',
      '아래 계좌로 입금해 주시면 주문이 확정됩니다.',
      '',
      infoBox([
        ['은행', '{{bankName}}'],
        ['계좌번호', '{{accountNumber}}'],
        ['예금주', '{{accountHolder}}'],
        ['입금기한', '{{dueDate}}'],
        ['입금금액', '{{amount}}원'],
      ]),
      '',
      '입금기한이 지나면 주문이 자동으로 취소됩니다. 입금이 확인되면 주문 접수 안내를 다시 보내드립니다.',
    ),
  },
  {
    // 거절 메일(CMS_MEMBER_REJECTED_EMAIL)과 짝. 승인만 조용하면 고객은 「된 건가?」 하고
    // 결제수단 화면을 다시 열거나 문의한다.
    key: 'CMS_MEMBER_REGISTERED_EMAIL',
    name: '자동이체 계좌 등록 완료',
    subject: '[아몬드영] 자동이체 계좌 등록이 완료되었습니다',
    vars: { name: 'string', bankName: 'string', payerName: 'string' },
    body: md(
      '## 계좌 등록 완료',
      '',
      '{{name}}님, 안녕하세요.',
      '신청해 주신 자동이체 계좌의 은행 확인이 끝나 등록이 완료되었습니다.',
      '',
      infoBox([
        ['은행', '{{bankName}}'],
        ['예금주', '{{payerName}}'],
      ]),
      '',
      '앞으로 결제일에 이 계좌에서 자동으로 출금됩니다. 계좌를 바꾸거나 해지하시려면 마이페이지 > 결제수단 관리에서 변경하실 수 있습니다.',
    ),
  },
  {
    key: 'MARKETING_PROMOTION_EMAIL',
    name: '프로모션 안내',
    subject: '[아몬드영] {{promotionTitle}}',
    vars: { name: 'string', promotionTitle: 'string', promotionUrl: 'string' },
    body: md(
      '## {{promotionTitle}}',
      '',
      '{{name}}님, 안녕하세요.',
      '아몬드영이 준비한 특별한 혜택을 확인해 보세요.',
      '',
      '[혜택 보러가기]({{promotionUrl}})',
    ),
  },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_URL.includes('sslmode=require') ? 'require' : false,
  });

  for (const t of TEMPLATES) {
    const contents = { EMAIL: { ko: { subject: t.subject, body: t.body } } };
    const schema = Object.fromEntries(Object.entries(t.vars).map(([k, type]) => [k, { type, required: true }]));
    const [existing] = await sql`SELECT template_id FROM templates WHERE template_key = ${t.key}`;

    if (!apply) {
      console.log(`${existing ? 'UPDATE' : 'INSERT'}  ${t.key.padEnd(30)} (${t.body.length} bytes)`);
      continue;
    }

    if (existing) {
      await sql`UPDATE templates SET contents = ${sql.json(contents)}, default_contents = ${sql.json(contents)},
                variables_schema = ${sql.json(schema)},
                name = ${t.name}, is_active = true, updated_at = now() WHERE template_key = ${t.key}`;
      console.log(`UPDATED ${t.key}`);
    } else {
      await sql`INSERT INTO templates (template_id, template_key, name, category, contents, default_contents, variables_schema, version, is_active)
                VALUES (gen_random_uuid(), ${t.key}, ${t.name}, 'TRANSACTIONAL', ${sql.json(contents)}, ${sql.json(contents)}, ${sql.json(schema)}, 1, true)`;
      console.log(`INSERTED ${t.key}`);
    }
  }

  console.log(apply ? '\n완료.' : '\ndry-run — 반영하려면 --apply 를 붙이세요.');
  await sql.end();
})();
