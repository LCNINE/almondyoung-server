import { Report } from './report';

describe('cutover preflight report', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('컷오버 전에는 당일 처리 항목을 실패로 세지 않는다', () => {
    const r = new Report('before');
    r.dayOf('CSV 발주 열린 라인', '#1243');
    expect(r.failures).toBe(0);
    expect(r.dayOfPending).toBe(1);
    expect(r.summary()).toContain('당일 처리 1건');
  });

  it('컷오버 뒤에는 남은 당일 처리 항목이 실패다', () => {
    const r = new Report('after', new Date('2026-11-20T00:00:00Z'));
    r.dayOf('CSV 발주 열린 라인', '#1243');
    expect(r.failures).toBe(1);
    expect(r.dayOfPending).toBe(0);
  });
});
