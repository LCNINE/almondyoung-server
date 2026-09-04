import handleCouponAutoIssueOnCustomerCreated, { config } from '../coupon-auto-issue-on-customer-created';

jest.mock('../../workflows/coupons/auto-issue-coupons', () => ({
  isAutoIssueEnabled: jest.fn(),
  autoIssueCoupons: jest.fn(),
}));
jest.mock('../../observability/coupon-issue.metrics', () => ({
  recordAutoIssueOutcome: jest.fn(),
  recordAutoIssueFailure: jest.fn(),
}));

import { autoIssueCoupons, isAutoIssueEnabled } from '../../workflows/coupons/auto-issue-coupons';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../../observability/coupon-issue.metrics';

function makeContainer(customers: Array<{ id: string; has_account: boolean }>) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const query = { graph: jest.fn().mockResolvedValue({ data: customers }) };
  const container = {
    resolve: (key: string) => {
      if (key === 'query') return query;
      if (key === 'logger') return logger;
      throw new Error(`unexpected resolve: ${key}`);
    },
  };
  return { container, logger, query };
}

const run = (container: any, id?: string) =>
  handleCouponAutoIssueOnCustomerCreated({ event: { data: id ? { id } : {} }, container } as any);

describe('coupon-auto-issue-on-customer-created 구독자', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isAutoIssueEnabled as jest.Mock).mockReturnValue(true);
  });

  it('customer.created 에 subscriberId 를 달고 등록된다', () => {
    expect(config.event).toBe('customer.created');
    expect(config.context?.subscriberId).toBe('coupon-auto-issue-customer-registered');
  });

  it('플래그가 꺼져 있으면 조회조차 하지 않는다 — 이 코드의 배포가 개통이면 안 된다', async () => {
    (isAutoIssueEnabled as jest.Mock).mockReturnValue(false);
    const { container, query } = makeContainer([{ id: 'cus_1', has_account: true }]);
    await run(container, 'cus_1');
    expect(query.graph).not.toHaveBeenCalled();
    expect(autoIssueCoupons).not.toHaveBeenCalled();
  });

  it('id 가 없으면 아무것도 하지 않는다', async () => {
    const { container, query } = makeContainer([]);
    await run(container);
    expect(query.graph).not.toHaveBeenCalled();
  });

  it('고객 행을 찾지 못하면 warn 로그만 남기고 발급을 시도하지 않는다', async () => {
    const { container, logger, query } = makeContainer([]);

    await run(container, 'cus_1');

    expect(query.graph).toHaveBeenCalledWith({ entity: 'customer', fields: ['id', 'has_account'], filters: { id: 'cus_1' } });
    expect(autoIssueCoupons).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cus_1'));
    expect(recordAutoIssueOutcome).not.toHaveBeenCalled();
    expect(recordAutoIssueFailure).not.toHaveBeenCalled();
  });

  it('has_account=false(어드민 생성·게스트)는 회원가입이 아니다 — 발급 0', async () => {
    const { container } = makeContainer([{ id: 'cus_1', has_account: false }]);
    await run(container, 'cus_1');
    expect(autoIssueCoupons).not.toHaveBeenCalled();
    expect(recordAutoIssueOutcome).not.toHaveBeenCalled();
  });

  it('has_account=true 면 customer_registered 로 발급하고 결과를 센다', async () => {
    const outcome = { issued: [{ promotion_id: 'p1', code: 'A' }], skipped: [{ promotion_id: 'p2', reason: 'already_issued' }], failed: [] };
    (autoIssueCoupons as jest.Mock).mockResolvedValue(outcome);
    const { container, logger, query } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await run(container, 'cus_1');

    expect(query.graph).toHaveBeenCalledWith({ entity: 'customer', fields: ['id', 'has_account'], filters: { id: 'cus_1' } });
    expect(autoIssueCoupons).toHaveBeenCalledWith(container, { customerId: 'cus_1', trigger: 'customer_registered' });
    expect(recordAutoIssueOutcome).toHaveBeenCalledWith('customer_registered', outcome);
    expect(recordAutoIssueFailure).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('cus_1'));
  });

  it('failed 가 있으면 실패 카운터 + error 로그에 복구 명령을 싣는다', async () => {
    (autoIssueCoupons as jest.Mock).mockResolvedValue({ issued: [], skipped: [], failed: [{ promotion_id: 'p1', error: 'boom' }] });
    const { container, logger } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await run(container, 'cus_1');

    expect(recordAutoIssueFailure).toHaveBeenCalledWith('customer_registered');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('/admin/customers/cus_1/issue-coupons'));
  });

  it('던져지면 삼키고(재시도 없음) 실패 카운터 + error 로그', async () => {
    (autoIssueCoupons as jest.Mock).mockRejectedValue(new Error('db down'));
    const { container, logger } = makeContainer([{ id: 'cus_1', has_account: true }]);

    await expect(run(container, 'cus_1')).resolves.toBeUndefined();

    expect(recordAutoIssueFailure).toHaveBeenCalledWith('customer_registered');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('/admin/customers/cus_1/issue-coupons'));
  });
});
