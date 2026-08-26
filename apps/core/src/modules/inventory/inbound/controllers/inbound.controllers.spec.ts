import { BadRequestException } from '@nestjs/common';
import { InboundController } from './inbound.controllers';
import type { InboundService } from '../services/inbound.service';
import type { InboundPutawayReader } from '../services/inbound-putaway.reader';

/**
 * GET /inbound/putaway/pending 의 days 파싱 경계 검증.
 *
 * `Number('1e21')` 은 `Number.isInteger` 를 통과하는데, 그 값으로 만든 Date 는
 * Invalid Date 가 되고 응답 직렬화(`toISOString`)에서 RangeError → 500 이 났다.
 * 그렇다고 `parseInt` 로 바꾸면 '1e21' → 1, '12abc' → 12 처럼 숫자 아닌 접미사를
 * 조용히 잘라먹고 통과시킨다 — 옛 `Number()` 는 이런 입력에 NaN → 400 이었으니
 * 오히려 계약이 느슨해진 것이다. `/^\d+$/` 로 순수 숫자 문자열만 허용한 뒤
 * parseInt 하면 둘 다 정직하게 400 이 되고, 상한(365)은 별도로 필요하다
 * (parseInt('99999') 같은 큰 정수는 자릿수 검사를 통과하니까).
 */
describe('InboundController.listPutawayPending — days 파싱', () => {
  function makeController() {
    const listPending = jest.fn().mockResolvedValue({ total: 0, truncated: false, items: [] });
    const putawayReader = { listPending } as unknown as InboundPutawayReader;
    const controller = new InboundController({} as unknown as InboundService, putawayReader);
    return { controller, listPending };
  }

  it('warehouseId 가 없으면 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending(undefined, undefined)).rejects.toThrow(BadRequestException);
  });

  it("'1e21' 처럼 지수표기 문자열은 400 이다(parseInt 로 조용히 1 을 받지 않는다)", async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('w-1', '1e21')).rejects.toThrow(BadRequestException);
  });

  it("'12abc' 처럼 숫자 뒤에 쓰레기가 붙은 문자열도 400 이다(parseInt 로 조용히 12 를 받지 않는다)", async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('w-1', '12abc')).rejects.toThrow(BadRequestException);
  });

  it('365 초과는 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('w-1', '366')).rejects.toThrow(BadRequestException);
  });

  it('365 는 통과한다', async () => {
    const { controller, listPending } = makeController();
    await controller.listPutawayPending('w-1', '365');
    expect(listPending).toHaveBeenCalledWith({ warehouseId: 'w-1', days: 365 });
  });

  it('정수가 아닌 문자열은 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('w-1', 'abc')).rejects.toThrow(BadRequestException);
  });

  it('0 이하는 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('w-1', '0')).rejects.toThrow(BadRequestException);
  });

  it('days 미지정이면 전체 기간으로 리더를 호출한다', async () => {
    const { controller, listPending } = makeController();
    await controller.listPutawayPending('w-1', undefined);
    expect(listPending).toHaveBeenCalledWith({ warehouseId: 'w-1', days: undefined });
  });
});

/**
 * `POST /inbound/plans` 는 호출자가 0이었다 — #739 가 admin-web 「계획 등록」 탭을 지웠고
 * Tauri 앱이 쓰는 것은 `plans/receive`(POST) 와 `plans/:planId`(GET) 로 다른 라우트다.
 *
 * 계획을 만드는 유일한 경로는 발주 라인 실행(`ensurePlanForPurchaseOrder`)이며, 그 경로만이
 * "한 발주에 계획 하나" 불변식(ADR-0032 결정 1)을 PO 행 FOR UPDATE 로 잠근다. 공개 라우트는
 * 그 락을 거치지 않으므로 수동 API 로 이중계획을 만들 여지가 남아 있었다.
 *
 * `InboundService.createInboundPlan` 메서드 자체는 남는다 — `ensurePlanForPurchaseOrder`
 * 가 그걸 부른다.
 */
describe('InboundController — 계획 생성 라우트', () => {
  type Handlers = Record<string, unknown>;

  it('POST /inbound/plans 핸들러는 없다 (계획 생성은 발주 라인 실행이 소유한다)', () => {
    expect((InboundController.prototype as unknown as Handlers).createPlan).toBeUndefined();
  });

  it('POST /inbound/plans/receive 핸들러는 남아 있다 (창고 Tauri 앱의 실입고 경로)', () => {
    expect(typeof (InboundController.prototype as unknown as Handlers).receiveFromPlan).toBe('function');
  });
});
