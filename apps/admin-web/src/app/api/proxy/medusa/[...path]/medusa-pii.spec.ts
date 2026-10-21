import { MEDUSA_PERMISSIONS } from './medusa-permissions';
import { applyMedusaPii, maskMedusaBody, medusaPiiRuleFor, type MedusaAccessRecord } from './medusa-pii';

const order = {
  order: {
    id: 'order_1',
    email: 'abcd@x.com',
    shipping_address: { first_name: '길동', last_name: '홍', company: '아몬드상회', phone: '010-1234-5678', address_1: '서울특별시 송파구 중대로 135', address_2: '101동', postal_code: '05510' },
    customer: { id: 'cus_1', email: 'abcd@x.com', metadata: { default_entrance_password: '1234#' } },
    items: [{ id: 'item_1', title: '상품', quantity: 1 }],
    metadata: { note: 'x' },
    total: 1000,
  },
};

const base = {
  method: 'GET',
  queryKeys: ['fields'],
  client: { 'x-staff-client-ip': '203.0.113.7', 'x-staff-forwarded-for': '203.0.113.7' },
  now: new Date('2026-10-19T05:00:00.000Z'),
};

describe('medusaPiiRuleFor', () => {
  it('lists every personal Medusa path the admin calls', () => {
    expect(medusaPiiRuleFor('GET', ['admin', 'orders', 'order_1'])).toMatchObject({ subjectType: 'medusa_order', revealable: true, pattern: 'admin/orders/:id' });
    expect(medusaPiiRuleFor('GET', ['admin', 'orders'])).toMatchObject({ subjectType: 'medusa_order', revealable: false });
    expect(medusaPiiRuleFor('GET', ['admin', 'customers', 'cus_1'])?.subjectType).toBe('medusa_customer');
    expect(medusaPiiRuleFor('GET', ['admin', 'customers', 'by-almond-user', 'u1'])?.subjectType).toBe('medusa_customer');
    expect(medusaPiiRuleFor('POST', ['admin', 'customers', 'cus_1', 'addresses'])?.subjectType).toBe('medusa_customer');
    expect(medusaPiiRuleFor('GET', ['admin', 'promotions', 'p1', 'customers'])?.subjectType).toBe('medusa_customer');
  });

  it('covers every customer or order path the proxy lets through', () => {
    // 개인정보가 없다고 확인한 경로만 예외로 둔다. 고객 그룹은 `fields` 로 소속 고객을 펼칠 수 있어 대상이다.
    const NO_PERSONAL_DATA = new Set(['GET admin/customers/:id/cart', 'GET admin/payment-sessions/:id/order']);
    const personal = MEDUSA_PERMISSIONS.filter(
      (r) => /^admin\/(customers|customer-groups|orders)(\/|$)|\/customers$/.test(r.pattern) && !NO_PERSONAL_DATA.has(`${r.method} ${r.pattern}`),
    );
    const sample = (pattern: string) => pattern.split('/').map((p) => (p.startsWith(':') ? 'x1' : p));
    const uncovered = personal.filter((r) => !medusaPiiRuleFor(r.method, sample(r.pattern))).map((r) => `${r.method} ${r.pattern}`);
    expect(personal.length).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
  });

  it('leaves non-personal Medusa paths alone', () => {
    expect(medusaPiiRuleFor('GET', ['admin', 'products'])).toBeNull();
    expect(medusaPiiRuleFor('GET', ['admin', 'customers', 'cus_1', 'cart'])).toBeNull();
  });
});

describe('maskMedusaBody', () => {
  it('masks customer contact keys at any depth and redacts metadata', () => {
    const { body, maskedKinds } = maskMedusaBody(order);
    expect(body).toEqual({
      order: {
        id: 'order_1',
        email: 'ab***@x.com',
        shipping_address: { first_name: '길*', last_name: '*', company: '아***회', phone: '010-****-5678', address_1: '서울특별시 송파구 …', address_2: '[가림]', postal_code: '*****' },
        customer: { id: 'cus_1', email: 'ab***@x.com', metadata: null },
        items: [{ id: 'item_1', title: '상품', quantity: 1 }],
        metadata: null,
        total: 1000,
      },
    });
    expect(order.order.email).toBe('abcd@x.com');
    expect([...maskedKinds].sort()).toEqual(['address', 'email', 'name', 'phone', 'postal', 'redact', 'text']);
  });
});

describe('applyMedusaPii', () => {
  it('returns the raw body and records once for a viewer with customer.pii.read', async () => {
    const records: MedusaAccessRecord[] = [];
    const out = await applyMedusaPii({
      ...base,
      body: order,
      rule: { pattern: 'admin/orders/:id', subjectType: 'medusa_order', revealable: true },
      permissions: new Set(['order.order.read', 'customer.pii.read']),
      revealRequired: false,
      revealRequested: false,
      record: async (entry) => {
        records.push(entry);
      },
    });
    expect(out.body).toBe(order);
    expect(out.headers['x-pii-masked']).toBe('none');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceService: 'admin-web',
      method: 'GET',
          action: 'view',
      subjects: [{ type: 'medusa_order', id: 'order_1' }],
      subjectCount: 1,
      queryKeys: ['fields'],
      claimedIp: '203.0.113.7',
      occurredAt: '2026-10-19T05:00:00.000Z',
    });
    expect(JSON.stringify(records[0])).not.toContain('abcd@x.com');
  });

  it('masks when the record call fails', async () => {
    const out = await applyMedusaPii({
      ...base,
      body: order,
      rule: { pattern: 'admin/orders/:id', subjectType: 'medusa_order', revealable: true },
      permissions: new Set(['customer.pii.read']),
      revealRequired: false,
      revealRequested: false,
      record: async () => {
        throw new Error('down');
      },
    });
    expect(out.headers['x-pii-mask-reason']).toBe('record-failed');
    expect(JSON.stringify(out.body)).not.toContain('abcd@x.com');
  });

  it('masks for a viewer who reached customers through marketing.promotion.read only', async () => {
    const record = jest.fn();
    const out = await applyMedusaPii({
      ...base,
      body: { customers: [{ id: 'cus_1', email: 'abcd@x.com', first_name: '길동' }] },
      rule: { pattern: 'admin/customers', subjectType: 'medusa_customer', revealable: false },
      permissions: new Set(['marketing.promotion.read']),
      revealRequired: false,
      revealRequested: false,
      record,
    });
    expect(out.body).toEqual({ customers: [{ id: 'cus_1', email: 'ab***@x.com', first_name: '길*' }] });
    expect(out.headers['x-pii-mask-reason']).toBe('no-permission');
    expect(record).not.toHaveBeenCalled();
  });

  it('masks holders in reveal-required mode and opens them on reveal of a detail', async () => {
    const records: MedusaAccessRecord[] = [];
    const input = {
      ...base,
      body: order,
      rule: { pattern: 'admin/orders/:id', subjectType: 'medusa_order' as const, revealable: true },
      permissions: new Set(['customer.pii.read']),
      revealRequired: true,
      record: async (entry: MedusaAccessRecord) => {
        records.push(entry);
      },
    };
    const masked = await applyMedusaPii({ ...input, revealRequested: false });
    expect(masked.headers['x-pii-mask-reason']).toBe('reveal-required');
    expect(masked.headers['x-pii-revealable']).toBe('1');
    const revealed = await applyMedusaPii({ ...input, revealRequested: true });
    expect(revealed.body).toBe(order);
    expect(records[0].action).toBe('reveal');
  });

  it('does not record a body without personal values', async () => {
    const record = jest.fn();
    const out = await applyMedusaPii({
      ...base,
      body: { orders: [], count: 0 },
      rule: { pattern: 'admin/orders', subjectType: 'medusa_order', revealable: false },
      permissions: new Set(['customer.pii.read']),
      revealRequired: false,
      revealRequested: false,
      record,
    });
    expect(out.headers['x-pii-masked']).toBe('none');
    expect(record).not.toHaveBeenCalled();
  });
});
