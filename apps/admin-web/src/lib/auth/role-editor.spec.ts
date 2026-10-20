import { CustomError } from '@/lib/api/customError';
import {
  buildGrid,
  iamErrorCode,
  domainReadState,
  lastPermanentHolder,
  landingCandidates,
  previewMenu,
  screensOpenedBy,
  summarize,
  toggle,
  toggleDomainReads,
} from './role-editor';

const cells = (grid: ReturnType<typeof buildGrid>) =>
  grid.flatMap((d) =>
    d.rows.flatMap((r) => [...Object.values(r.cells), ...r.special])
  );

describe('role editor', () => {
  it('lays permissions out as targets by action, with named verbs apart', () => {
    const order = buildGrid([]).find((d) => d.domain === 'order');
    const row = order?.rows.find((r) => r.target === 'order');
    expect(order?.title).toBe('주문');
    expect(row?.title).toBe('주문');
    expect(row?.cells.read?.key).toBe('order.order.read');
    expect(row?.cells.write?.key).toBe('order.order.write');
    expect(row?.cells.export?.key).toBe('order.order.export');
    expect(row?.special.map((c) => c.key)).toEqual(['order.order.cancel']);
  });

  it('names a target without a read of its own after its first permission', () => {
    const price = buildGrid([])
      .find((d) => d.domain === 'catalog')
      ?.rows.find((r) => r.target === 'price');
    expect(price?.title).toBe('가격 변경');
  });

  it('never shows a system-only permission', () => {
    expect(cells(buildGrid([])).map((c) => c?.key)).not.toContain(
      'fulfillment.tracking.ingest'
    );
  });

  it('marks dangerous permissions', () => {
    expect(
      cells(buildGrid([])).find((c) => c?.key === 'order.order.cancel')
        ?.dangerous
    ).toBe(true);
  });

  it('shows a retired permission the role still holds, marked as retired', () => {
    const cell = cells(buildGrid(['legacy.thing.write'])).find(
      (c) => c?.key === 'legacy.thing.write'
    );
    expect(cell?.deprecated).toBe(true);
  });

  it('turns the read on with a write and the write off with the read', () => {
    const on = toggle(new Set(), 'catalog.price.write', true);
    expect([...on].sort()).toEqual([
      'catalog.price.write',
      'catalog.product.read',
    ]);
    expect([...toggle(on, 'catalog.product.read', false)]).toEqual([]);
  });

  it('reports a domain read toggle as partly on and turns all reads on or off', () => {
    const some = toggle(new Set(), 'order.order.read', true);
    expect(domainReadState(some, 'order')).toBe('indeterminate');
    expect(
      domainReadState(toggleDomainReads(some, 'order', true), 'order')
    ).toBe(true);
    expect(
      domainReadState(toggleDomainReads(some, 'order', false), 'order')
    ).toBe(false);
  });

  it('turns writes off together with the reads when the domain reads are turned off', () => {
    const writer = toggle(new Set(), 'order.order.write', true);
    expect([...toggleDomainReads(writer, 'order', false)]).toEqual([]);
  });

  it('counts what is added, removed and dangerous', () => {
    expect(
      summarize(
        ['order.order.read'],
        ['order.order.read', 'order.order.write', 'order.order.cancel']
      )
    ).toEqual({
      added: ['order.order.cancel', 'order.order.write'],
      removed: [],
      dangerousAdded: ['order.order.cancel'],
    });
  });

  it('lists the screens a permission opens', () => {
    expect(screensOpenedBy('order.order.read')).toContain('/order/history');
    expect(screensOpenedBy('order.order.cancel')).toEqual([]);
  });

  it('offers only screens the role can open as its landing screen', () => {
    const paths = landingCandidates(new Set(['order.order.read'])).map(
      (c) => c.path
    );
    expect(paths).toContain('/order/history');
    expect(paths).not.toContain('/statistics/profit');
  });

  it('draws the sidebar a permission set would see', () => {
    const paths = (menus: ReturnType<typeof previewMenu>) =>
      JSON.stringify(menus).match(/"path":"[^"]+"/g) ?? [];
    expect(paths(previewMenu(new Set(['order.order.read'])))).toContain(
      '"path":"/order/history"'
    );
    // 권한이 없어도 로그인만 요구하는 화면(내 계정)은 남는다 — 사이드바와 같은 규칙
    expect(paths(previewMenu(new Set()))).not.toContain(
      '"path":"/order/history"'
    );
  });

  it('reads the rule code of a refused change and nothing else', () => {
    const stale = new CustomError({
      message: 'x',
      statusCode: 409,
      response: { code: 'ROLE_VERSION_STALE' },
    });
    expect(iamErrorCode(stale)).toBe('ROLE_VERSION_STALE');
    expect(
      iamErrorCode(
        new CustomError({ message: 'x', statusCode: 409, response: 'oops' })
      )
    ).toBeNull();
    expect(iamErrorCode(new Error('x'))).toBeNull();
  });

  it('names the only permanent holder who can sign in as the one that must stay', () => {
    const m = (userId: string, expiresAt: string | null, canSignIn = true) => ({
      userId,
      expiresAt,
      expired: false,
      canSignIn,
    });
    expect(
      lastPermanentHolder([
        m('a', null),
        m('b', '2099-01-01T00:00:00Z'),
        m('c', null, false),
      ])
    ).toBe('a');
    expect(lastPermanentHolder([m('a', null), m('b', null)])).toBeNull();
    expect(lastPermanentHolder([m('b', '2099-01-01T00:00:00Z')])).toBeNull();
  });

  it('touches only what the switched permission needs, leaving an old gap alone like the server does', () => {
    // 가격 수정 → 상품 조회 누락은 이번 조작이 만든 게 아니다.
    const gap = new Set(['catalog.price.write']);
    expect([...toggle(gap, 'order.order.read', true)].sort()).toEqual([
      'catalog.price.write',
      'order.order.read',
    ]);
    const withOrder = new Set([
      'catalog.price.write',
      'order.order.read',
      'order.order.write',
    ]);
    expect([...toggle(withOrder, 'order.order.read', false)]).toEqual([
      'catalog.price.write',
    ]);
  });
});
