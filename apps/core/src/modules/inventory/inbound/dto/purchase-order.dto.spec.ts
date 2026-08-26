import { validate } from 'class-validator';
import {
  CreatePurchaseOrderDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderStatus,
  PurchaseOrderType,
  UpdatePurchaseOrderStatusDto,
  UpdatePurchaseOrderLinesDto,
  UpdatePurchaseOrderLineDto,
} from './purchase-order.dto';
import { OrderPurchaseOrderLineDto } from './purchase-order/execute-line.dto';
import { InboundPlanItemInputDto } from './simple-inbound.dto';

/**
 * 발주 관련 DTO 의 날짜 필드(`expectedArrival` / `expectedDate`) 계약을 고정한다.
 *
 * 이 스펙이 존재하는 이유: `@IsDateString()` 은 ISO 8601 의 **부분 형태**('2026',
 * '2026-08')와 오프셋이 붙은 타임스탬프('2026-08-26T00:00:00+09:00')를 전부 통과시킨다.
 * 그 값이 확정 경로를 타면 `purchase_order_lines.expected_arrival`(date 컬럼)에 바인딩돼
 * `invalid input syntax for type date: "2026"` 로 트랜잭션 전체가 500 으로 죽는다.
 * 값을 방어적으로 더 다듬는 대신 **입구를 좁힌다** — 라인 실행 DTO(execute-line.dto.ts)가
 * 이미 쓰는 그 정규식이다.
 *
 * 모양만 보는 정규식(`@Matches(/^\d{4}-\d{2}-\d{2}$/)`)도 답이 아니다 — '2026-13-45' 는
 * 모양이 맞아 통과하고 Postgres 가 `date/time field value out of range` 로 죽인다(500).
 * 두 데코레이터를 겹쳐도 '2026-02-31'·윤년 아닌 '2026-02-29' 는 둘 다 통과한다. 그래서
 * 모양·범위·달력을 한 번에 보는 **왕복 비교** 검증자를 쓴다(calendar-date.validator.ts).
 *
 * `InboundPlanItemInputDto.expectedDate`(inbound_plan_items.expected_date, 같은 `date`
 * 컬럼)는 애초에 모양만 보는 `@Matches`를 그대로 쓰고 있어 같은 계열의 500 을 그대로
 * 재현했다 — 여기서 같은 왕복 비교 검증자로 맞춰 이 스펙에 편입한다.
 *
 * 통합 스펙으로는 못 잡는다 — 그쪽은 서비스를 직접 불러 ValidationPipe 를 지나지 않는다.
 * DTO 데코레이터가 실제로 도는 곳은 HTTP 경계뿐이라, 검증 자체를 단위로 확인한다.
 */
describe('발주 관련 DTO 의 날짜 필드 계약', () => {
  async function errorsFor(dto: object, property: string): Promise<string[]> {
    const errors = await validate(dto);
    return errors.filter((e) => e.property === property).map((e) => e.property);
  }

  function createDto(expectedArrival?: string): CreatePurchaseOrderDto {
    const dto = new CreatePurchaseOrderDto();
    dto.type = PurchaseOrderType.DOMESTIC;
    dto.supplierId = '11111111-1111-4111-8111-111111111111';
    dto.destinationWarehouseId = '22222222-2222-4222-8222-222222222222';
    dto.lines = [];
    dto.expectedArrival = expectedArrival;
    return dto;
  }

  function fromCartDto(expectedArrival?: string): CreatePurchaseOrderFromCartDto {
    const dto = new CreatePurchaseOrderFromCartDto();
    dto.cartItemIds = [];
    dto.supplierId = '11111111-1111-4111-8111-111111111111';
    dto.destinationWarehouseId = '22222222-2222-4222-8222-222222222222';
    dto.expectedArrival = expectedArrival;
    return dto;
  }

  function orderLineDto(expectedArrival?: string): OrderPurchaseOrderLineDto {
    const dto = new OrderPurchaseOrderLineDto();
    dto.orderedQty = 6;
    dto.expectedArrival = expectedArrival;
    return dto;
  }

  function planItemDto(expectedDate?: string): InboundPlanItemInputDto {
    const dto = new InboundPlanItemInputDto();
    dto.skuId = '33333333-3333-4333-8333-333333333333';
    dto.expectedQty = 1;
    dto.expectedDate = expectedDate;
    return dto;
  }

  const builders: [string, (v?: string) => object, string][] = [
    ['CreatePurchaseOrderDto', createDto, 'expectedArrival'],
    ['CreatePurchaseOrderFromCartDto', fromCartDto, 'expectedArrival'],
    ['OrderPurchaseOrderLineDto', orderLineDto, 'expectedArrival'],
    ['InboundPlanItemInputDto', planItemDto, 'expectedDate'],
  ];

  describe.each(builders)('%s', (_name, build, property) => {
    it('YYYY-MM-DD 를 받는다', async () => {
      await expect(errorsFor(build('2026-08-26'), property)).resolves.toHaveLength(0);
    });

    it('생략을 받는다', async () => {
      await expect(errorsFor(build(undefined), property)).resolves.toHaveLength(0);
    });

    // psql: select '2026'::date; → ERROR: invalid input syntax for type date
    it('연도만 있는 부분 ISO 를 거부한다', async () => {
      await expect(errorsFor(build('2026'), property)).resolves.toHaveLength(1);
    });

    it('연-월만 있는 부분 ISO 를 거부한다', async () => {
      await expect(errorsFor(build('2026-08'), property)).resolves.toHaveLength(1);
    });

    // 오프셋이 붙은 타임스탬프는 "어느 달력 날짜인가" 가 읽는 쪽에 따라 달라진다.
    // 저장소에 있는 유일한 호출자(admin-web)는 <input type="date"> 라 보내지 않는다.
    it('오프셋이 붙은 타임스탬프를 거부한다', async () => {
      await expect(errorsFor(build('2026-08-26T00:00:00+09:00'), property)).resolves.toHaveLength(1);
    });

    it('날짜가 아닌 문자열을 거부한다', async () => {
      await expect(errorsFor(build('내일'), property)).resolves.toHaveLength(1);
    });

    // 윤년은 실제로 존재하는 날짜다 — 달력 검증이 이걸 같이 막으면 4년에 한 번 발주가 멈춘다.
    it('윤년 2월 29일을 받는다', async () => {
      await expect(errorsFor(build('2028-02-29'), property)).resolves.toHaveLength(0);
    });

    // 아래 넷은 모양만 보는 정규식을 전부 통과한다. 그대로 date 컬럼에 닿으면
    // Postgres 가 `date/time field value out of range` 로 트랜잭션을 죽인다(500).
    it('윤년이 아닌 해의 2월 29일을 거부한다', async () => {
      await expect(errorsFor(build('2026-02-29'), property)).resolves.toHaveLength(1);
    });

    it('범위를 넘는 월을 거부한다', async () => {
      await expect(errorsFor(build('2026-13-01'), property)).resolves.toHaveLength(1);
    });

    it('0월을 거부한다', async () => {
      await expect(errorsFor(build('2026-00-15'), property)).resolves.toHaveLength(1);
    });

    it('그 달에 없는 일자를 거부한다', async () => {
      await expect(errorsFor(build('2026-02-31'), property)).resolves.toHaveLength(1);
    });

    it('월·일이 동시에 범위를 넘는 값을 거부한다', async () => {
      await expect(errorsFor(build('2026-13-45'), property)).resolves.toHaveLength(1);
    });
  });
});

/**
 * `PUT /:id/lines` 에 빈 배열을 보내면 라인 전체를 지운 것으로 처리된다
 * (updatePurchaseOrderLines 4단계). requested 라인이 하나도 안 남으면
 * refreshHeaderStatus 가 이를 confirmed 로 읽는다 — admin-web 은 화면에서 항상
 * 라인을 하나 이상 유지하지만 API 는 그 제약이 없었다. 최소 1개를 DTO 가 막는다.
 */
describe('UpdatePurchaseOrderLinesDto', () => {
  function dtoWithLines(lines: UpdatePurchaseOrderLineDto[]): UpdatePurchaseOrderLinesDto {
    const dto = new UpdatePurchaseOrderLinesDto();
    dto.lines = lines;
    return dto;
  }

  it('빈 배열을 거부한다', async () => {
    const errors = await validate(dtoWithLines([]));
    expect(errors.some((e) => e.property === 'lines')).toBe(true);
  });

  it('라인이 하나 이상이면 통과한다', async () => {
    const line = new UpdatePurchaseOrderLineDto();
    line.skuId = '33333333-3333-4333-8333-333333333333';
    line.quantity = 1;
    const errors = await validate(dtoWithLines([line]));
    expect(errors.filter((e) => e.property === 'lines')).toHaveLength(0);
  });
});

/**
 * 상태 API 는 종결 전용이다(#724 항목 9의 3단계). 헤더 status 는 라인에서 파생되고,
 * 사람이 직접 쓰는 값은 `received` 하나뿐이다. 통합 스펙은 서비스를 직접 부르므로
 * ValidationPipe 를 지나지 않는다 — 이 좁힘이 실제로 도는 곳은 HTTP 경계뿐이다.
 */
describe('UpdatePurchaseOrderStatusDto 는 종결만 받는다', () => {
  function statusDto(status: PurchaseOrderStatus): UpdatePurchaseOrderStatusDto {
    const dto = new UpdatePurchaseOrderStatusDto();
    // 좁힌 타입을 일부러 우회한다 — 막는 것이 TS 가 아니라 런타임 검증임을 확인해야 한다.
    dto.status = status as PurchaseOrderStatus.RECEIVED;
    return dto;
  }

  async function statusErrors(status: PurchaseOrderStatus): Promise<number> {
    const errors = await validate(statusDto(status));
    return errors.filter((e) => e.property === 'status').length;
  }

  it('received 를 받는다', async () => {
    await expect(statusErrors(PurchaseOrderStatus.RECEIVED)).resolves.toBe(0);
  });

  // 이 값을 사람이 쓰던 경로가 곧 일괄 라인 실행이었다.
  it('confirmed 를 거부한다', async () => {
    await expect(statusErrors(PurchaseOrderStatus.CONFIRMED)).resolves.toBe(1);
  });

  it('created 를 거부한다', async () => {
    await expect(statusErrors(PurchaseOrderStatus.CREATED)).resolves.toBe(1);
  });
});
