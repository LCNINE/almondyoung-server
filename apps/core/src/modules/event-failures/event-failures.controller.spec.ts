import { EventFailuresController } from './event-failures.controller';

describe('core EventFailuresController (#1016 7·8번)', () => {
  const deadLetters = { summary: jest.fn(), listSequences: jest.fn(), detail: jest.fn() };
  const redriver = { redrive: jest.fn(), discard: jest.fn(), redriveAll: jest.fn() };
  const outbox = {
    listFailed: jest.fn(),
    detail: jest.fn(),
    resend: jest.fn(),
    discard: jest.fn(),
    resendAll: jest.fn(),
  };
  const controller = new EventFailuresController(deadLetters as never, redriver as never, outbox as never);

  it('종결은 사유와 JWT 의 사용자 id 를 넘긴다', async () => {
    await controller.discardDeadLetter(7, { reason: '낡음' }, { id: 'admin-1' });
    expect(redriver.discard).toHaveBeenCalledWith(7, 'admin-1', '낡음');
  });

  it('outbox 다시 보내기는 id 와 사용자 id 를 넘긴다', async () => {
    await controller.resendOutbox(3, { userId: 'admin-2' });
    expect(outbox.resend).toHaveBeenCalledWith(3, 'admin-2');
  });

  it('목록은 쿼리 문자열을 그대로 넘긴다 — 파싱은 서비스가 한다', async () => {
    await controller.listDeadLetters('20', '100', 'orders.events.v1');
    expect(deadLetters.listSequences).toHaveBeenCalledWith('20', '100', 'orders.events.v1');
  });

  it('전체 다시 넣기는 토픽 거르기를 넘긴다', async () => {
    await controller.redriveAll({ id: 'admin-3' }, 'orders.events.v1');
    expect(redriver.redriveAll).toHaveBeenCalledWith('admin-3', 'orders.events.v1');
  });
});
