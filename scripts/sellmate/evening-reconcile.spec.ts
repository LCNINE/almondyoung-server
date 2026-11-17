/**
 * 저녁 맞추기 CLI 인자 파싱 (DB 불필요).
 */
import { parseCliArgs } from './evening-reconcile';

const INIT_FLAGS = ['--cutover-at=2026-11-20T09:00', '--sellmate-orders=o.csv', '--own-mall-channel=TEST-MALL'];

describe('parseCliArgs', () => {
  it('하위 명령과 재고 파일을 읽고 기본은 dry-run 이다', () => {
    expect(parseCliArgs(['apply', 'a.csv'])).toMatchObject({ sub: 'apply', stockFile: 'a.csv', apply: false });
  });

  it('--apply 면 apply:true', () => {
    expect(parseCliArgs(['apply', 'a.csv', '--apply']).apply).toBe(true);
    expect(parseCliArgs(['pair', '--apply', 'a.csv']).apply).toBe(true);
  });

  it('init 은 --cutover-at·--sellmate-orders·--own-mall-channel 이 하나라도 없으면 던진다', () => {
    for (let i = 0; i < INIT_FLAGS.length; i++) {
      const flags = INIT_FLAGS.filter((_, j) => j !== i);
      expect(() => parseCliArgs(['init', 's.csv', ...flags])).toThrow();
    }
    const args = parseCliArgs(['init', 's.csv', ...INIT_FLAGS]);
    expect(args).toMatchObject({ sub: 'init', stockFile: 's.csv', ordersFile: 'o.csv', ownMallChannel: 'TEST-MALL' });
  });

  it('init 확인 넘기기 플래그는 기본 false, 붙이면 true, 값은 받지 않는다', () => {
    expect(parseCliArgs(['init', 's.csv', ...INIT_FLAGS])).toMatchObject({
      acceptOnhandMismatch: false,
      noHandedOverOrders: false,
    });
    expect(
      parseCliArgs(['init', 's.csv', ...INIT_FLAGS, '--accept-onhand-mismatch', '--no-handed-over-orders']),
    ).toMatchObject({ acceptOnhandMismatch: true, noHandedOverOrders: true });
    expect(() => parseCliArgs(['init', 's.csv', ...INIT_FLAGS, '--no-handed-over-orders=1'])).toThrow();
    expect(() => parseCliArgs(['apply', 'a.csv', '--accept-onhand-mismatch'])).toThrow();
  });

  it('--cutover-at 은 offset 이 없으면 KST 다', () => {
    const args = parseCliArgs(['init', 's.csv', ...INIT_FLAGS]);
    expect(args.cutoverAt?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    const withOffset = parseCliArgs(['init', 's.csv', ...INIT_FLAGS.slice(1), '--cutover-at=2026-11-20T09:00:00Z']);
    expect(withOffset.cutoverAt?.toISOString()).toBe('2026-11-20T09:00:00.000Z');
  });

  it('--cutover-at 이 시각이 아니면 던진다', () => {
    expect(() => parseCliArgs(['init', 's.csv', ...INIT_FLAGS.slice(1), '--cutover-at=2026-11-20'])).toThrow(
      /--cutover-at/,
    );
  });

  it('--accept-landed=A,B → [A, B]', () => {
    const args = parseCliArgs(['close', 'c.csv', '--accept-landed=A,B', '--accept-not-landed=C']);
    expect(args.acceptLanded).toEqual(['A', 'B']);
    expect(args.acceptNotLanded).toEqual(['C']);
  });

  it('같은 품목을 두 accept 에 다 지목하면 던진다', () => {
    expect(() => parseCliArgs(['close', 'c.csv', '--accept-landed=A', '--accept-not-landed=A'])).toThrow();
  });

  it('status 는 파일 없이 읽는다', () => {
    expect(parseCliArgs(['status'])).toMatchObject({ sub: 'status', stockFile: null, apply: false });
  });

  it('모르는 하위 명령·플래그는 던진다', () => {
    expect(() => parseCliArgs([])).toThrow();
    expect(() => parseCliArgs(['sync', 'a.csv'])).toThrow();
    expect(() => parseCliArgs(['apply', 'a.csv', '--force'])).toThrow();
  });

  it('하위 명령에 맞지 않는 플래그·인자는 던진다', () => {
    expect(() => parseCliArgs(['apply', 'a.csv', '--accept-landed=A'])).toThrow();
    expect(() => parseCliArgs(['apply', 'a.csv', '--cutover-at=2026-11-20T09:00'])).toThrow();
    expect(() => parseCliArgs(['apply'])).toThrow();
    expect(() => parseCliArgs(['apply', 'a.csv', 'b.csv'])).toThrow();
    expect(() => parseCliArgs(['status', 'a.csv'])).toThrow();
    expect(() => parseCliArgs(['status', '--apply'])).toThrow();
  });
});
