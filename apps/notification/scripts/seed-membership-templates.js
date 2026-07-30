// 멤버십 해지 안내 알림 템플릿/이벤트 매핑 시드.
//
// notification 서비스는 templates + notification_events DB 행이 없으면 컨슈머가 조용히 no-op 한다.
// 그래서 MembershipEventConsumer 를 배포한 뒤 이 스크립트를 notification DB 에 한 번 실행해야
// 해지 안내 메일이 실제로 발송된다. 멱등(있으면 UPDATE)이라 여러 번 실행해도 안전하다.
//
//   DATABASE_URL=<notification DB> node apps/notification/scripts/seed-membership-templates.js
const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다 (notification DB).');
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

const BRAND = '#ff6600';

/** 공통 이메일 레이아웃. 본문(bodyHtml)만 갈아끼운다. */
function layout(title, bodyHtml) {
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background-color:#f5f5f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:12px;padding:40px 32px;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;"><tr><td style="font-size:22px;font-weight:800;color:${BRAND};padding-bottom:24px;">아몬드영</td></tr><tr><td style="font-size:22px;font-weight:700;color:#111111;padding-bottom:16px;">${title}</td></tr>${bodyHtml}<tr><td style="border-top:1px solid #eeeeee;padding-top:20px;font-size:12px;line-height:1.6;color:#aaaaaa;">본 메일은 발신 전용입니다. 문의는 고객센터(1877-7184)로 연락해 주세요.<br/>&copy; Almond Young. All rights reserved.</td></tr></table></td></tr></table></body></html>`;
}

function paragraph(html, extra = '') {
  return `<tr><td style="font-size:15px;line-height:1.7;color:#444444;padding-bottom:20px;${extra}">${html}</td></tr>`;
}

function infoBox(rowsHtml) {
  return `<tr><td style="padding-bottom:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8f9;border-radius:10px;padding:16px 18px;">${rowsHtml}</table></td></tr>`;
}

function infoRow(label, value) {
  return `<tr><td style="font-size:13px;color:#888888;padding:4px 0;width:120px;">${label}</td><td style="font-size:14px;color:#111111;font-weight:600;padding:4px 0;">${value}</td></tr>`;
}

const templates = [
  {
    templateKey: 'MEMBERSHIP_RECURRING_CANCELLED_EMAIL',
    name: '멤버십 해지 예약 안내',
    category: 'TRANSACTIONAL',
    contents: {
      ko: {
        EMAIL: {
          subject: '[아몬드영] 멤버십 해지가 접수되었습니다',
          body: layout(
            '멤버십 해지가 접수되었습니다',
            paragraph('요청하신 멤버십 해지가 정상 접수되었습니다.') +
              infoBox(infoRow('이용 종료일', '{{endsAt}}') + infoRow('이후 결제', '청구되지 않습니다')) +
              paragraph(
                '<strong>{{endsAt}}까지는 멤버십 혜택을 그대로 이용하실 수 있습니다.</strong> 이후 자동 결제는 진행되지 않습니다.',
              ) +
              paragraph(
                '해지를 취소하고 계속 이용하시려면 마이페이지 &gt; 멤버십에서 <strong>해지 취소</strong>를 눌러 주세요.',
              ),
          ),
        },
      },
    },
    variablesSchema: {
      endsAt: { type: 'string', required: true, description: '이용 종료일 (YYYY-MM-DD)' },
    },
  },
  {
    templateKey: 'MEMBERSHIP_CANCELLED_EMAIL',
    name: '멤버십 해지 완료 안내',
    category: 'TRANSACTIONAL',
    contents: {
      ko: {
        EMAIL: {
          subject: '[아몬드영] 멤버십이 해지되었습니다',
          body: layout(
            '멤버십이 해지되었습니다',
            paragraph('요청하신 대로 멤버십 이용이 종료되었습니다.') +
              infoBox(infoRow('이용 종료', '{{endsAt}}') + infoRow('환불', '{{refundNotice}}')) +
              paragraph(
                '환불이 포함된 해지의 경우, 결제 수단에 따라 실제 반영까지 영업일이 소요될 수 있습니다.',
              ) +
              paragraph('언제든 다시 가입하실 수 있습니다. 그동안 이용해 주셔서 감사합니다.'),
          ),
        },
      },
    },
    variablesSchema: {
      endsAt: { type: 'string', required: true, description: '이용 종료일 또는 "즉시 종료"' },
      refundNotice: { type: 'string', required: true, description: '환불 상태 안내 문구' },
      refundAmount: { type: 'string', required: false, description: '환불 금액(원, 천단위 구분)' },
    },
  },
];

const eventMappings = [
  {
    eventKey: 'MEMBERSHIP_RECURRING_CANCELLED',
    name: '멤버십 해지 예약',
    description: '정기결제 해지 접수 — 잔여 기간 이용 후 종료 안내',
    templateKey: 'MEMBERSHIP_RECURRING_CANCELLED_EMAIL',
    category: 'TRANSACTIONAL',
    defaultChannels: ['EMAIL'],
    priority: 'HIGH',
  },
  {
    eventKey: 'MEMBERSHIP_CANCELLED',
    name: '멤버십 해지 완료',
    description: '즉시 해지(환불 포함 가능) 완료 안내',
    templateKey: 'MEMBERSHIP_CANCELLED_EMAIL',
    category: 'TRANSACTIONAL',
    defaultChannels: ['EMAIL'],
    priority: 'HIGH',
  },
];

async function main() {
  await client.connect();
  console.log('notification DB 연결 성공');

  for (const template of templates) {
    const existing = await client.query('SELECT template_id FROM templates WHERE template_key = $1', [
      template.templateKey,
    ]);
    const values = [
      template.templateKey,
      template.name,
      template.category,
      JSON.stringify(template.contents),
      JSON.stringify(template.variablesSchema),
    ];

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE templates
            SET name = $2, category = $3, contents = $4, variables_schema = $5, is_active = true, updated_at = NOW()
          WHERE template_key = $1`,
        values,
      );
      console.log(`🔄 템플릿 업데이트: ${template.templateKey}`);
    } else {
      await client.query(
        `INSERT INTO templates (template_key, name, category, contents, variables_schema, version, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, true, NOW(), NOW())`,
        values,
      );
      console.log(`✅ 템플릿 생성: ${template.templateKey}`);
    }
  }

  for (const mapping of eventMappings) {
    const existing = await client.query('SELECT event_id FROM notification_events WHERE event_key = $1', [
      mapping.eventKey,
    ]);
    const values = [
      mapping.eventKey,
      mapping.name,
      mapping.description,
      mapping.templateKey,
      mapping.category,
      JSON.stringify(mapping.defaultChannels),
      mapping.priority,
    ];

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE notification_events
            SET name = $2, description = $3, template_key = $4, category = $5,
                default_channels = $6, priority = $7, is_active = true, updated_at = NOW()
          WHERE event_key = $1`,
        values,
      );
      console.log(`🔄 이벤트 매핑 업데이트: ${mapping.eventKey}`);
    } else {
      await client.query(
        `INSERT INTO notification_events (event_key, name, description, template_key, category, default_channels, priority, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())`,
        values,
      );
      console.log(`✅ 이벤트 매핑 생성: ${mapping.eventKey}`);
    }
  }

  console.log('\n완료. 해지 안내 메일이 membership.events.v1 수신 시 발송됩니다.');
}

main()
  .catch((error) => {
    console.error('시드 실패:', error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
