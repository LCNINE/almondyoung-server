import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { ReviseShipmentRecipientDto, SplitShipmentDto } from '../dto/shipment-planning.dto';
import { ShipmentPlanningController } from '../controllers/shipment-planning.controller';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import {
  confirmedReservationReleaseForCancellation,
  resolveRecipientRevision,
  ShipmentPlanningService,
} from './shipment-planning.service';

function planningHarness() {
  const execute = jest.fn((input: { canonicalRequest: unknown }) => Promise.resolve(input.canonicalRequest));
  const service = new ShipmentPlanningService(
    {} as never,
    { execute } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertV2MutationAllowed: jest.fn() } as never,
  );
  return { service, execute };
}

describe('ShipmentPlanningService command boundary', () => {
  const actor = { id: 'operator-from-jwt', roles: ['warehouse_operator'] };
  const firstLineId = '00000000-0000-4000-8000-000000000001';
  const secondLineId = '00000000-0000-4000-8000-000000000002';

  it('cancels unreserved quantity before releasing confirmed reservations', () => {
    expect(confirmedReservationReleaseForCancellation(10, 6, 4)).toBe(0);
    expect(confirmedReservationReleaseForCancellation(10, 6, 6)).toBe(2);
    expect(confirmedReservationReleaseForCancellation(10, 10, 4)).toBe(4);
  });

  it('normalizes split moves before hashing so client array order is immaterial', async () => {
    const first = planningHarness();
    const second = planningHarness();
    const base = { expectedManifestVersion: 1, reason: 'backorder split' };

    const firstRequest = await first.service.split(
      'shipment-1',
      {
        ...base,
        moves: [
          { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
          { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
        ],
      },
      'split-key',
      actor,
    );
    const secondRequest = await second.service.split(
      'shipment-1',
      {
        ...base,
        moves: [
          { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
          { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
        ],
      },
      'split-key',
      actor,
    );

    expect(canonicalFulfillmentRequestHash(firstRequest)).toBe(canonicalFulfillmentRequestHash(secondRequest));
    expect(
      // split() 의 반환에는 moves 가 없다(operationId/source/target). 해시 입력으로
      // 쓰이는 정규화 결과에서 라인 순서를 보려는 의도라 unknown 을 거쳐 좁힌다.
      (firstRequest as unknown as { moves: Array<{ shipmentLineId: string }> }).moves.map(
        (move) => move.shipmentLineId,
      ),
    ).toEqual([firstLineId, secondLineId]);
  });

  it('normalizes cancellation lines before hashing', async () => {
    const first = planningHarness();
    const second = planningHarness();
    const base = { expectedManifestVersion: 1, reason: 'cancel remainder' };
    const reverse = [
      { shipmentLineId: secondLineId, expectedLineVersion: 1, qty: 2 },
      { shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 },
    ];
    const forward = [...reverse].reverse();

    const firstRequest = await first.service.cancelOutstanding(
      'shipment-1',
      { ...base, lines: reverse },
      'cancel-key',
      actor,
    );
    const secondRequest = await second.service.cancelOutstanding(
      'shipment-1',
      { ...base, lines: forward },
      'cancel-key',
      actor,
    );

    expect(canonicalFulfillmentRequestHash(firstRequest)).toBe(canonicalFulfillmentRequestHash(secondRequest));
  });

  it('takes the operator identity from JWT and strips a forged body operator field', async () => {
    const planning = { split: jest.fn().mockResolvedValue({}) };
    const controller = new ShipmentPlanningController(planning as never);
    const pipe = createGlobalValidationPipe();
    const dto = (await pipe.transform(
      {
        expectedManifestVersion: 1,
        reason: 'split',
        operatorId: 'forged-operator',
        moves: [{ shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 }],
      },
      { type: 'body', metatype: SplitShipmentDto },
    )) as SplitShipmentDto;

    await controller.split('shipment-1', dto, 'split-key', {
      userId: 'jwt-operator',
      roles: ['warehouse_operator'],
    });

    expect(dto).not.toHaveProperty('operatorId');
    expect(planning.split).toHaveBeenCalledWith('shipment-1', dto, 'split-key', {
      id: 'jwt-operator',
      roles: ['warehouse_operator'],
    });
  });

  it('rejects a blank reason even when called outside HTTP validation', async () => {
    const { service, execute } = planningHarness();
    await expect(
      service.split(
        'shipment-1',
        {
          expectedManifestVersion: 1,
          reason: '   ',
          moves: [{ shipmentLineId: firstLineId, expectedLineVersion: 1, qty: 1 }],
        },
        'split-key',
        actor,
      ),
    ).rejects.toThrow('reason must be a non-blank string');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('resolveRecipientRevision', () => {
  const RECIPIENT = {
    recipientName: '홍길동',
    phone: '010-0000-0000',
    postalCode: '01234',
    roadAddress: '서울 테스트로 1',
    detailAddress: '101동 1001호',
  };
  const current = { recipientSnapshot: RECIPIENT, manifestVersion: 3, entrancePassword: '#1234' };

  it('비번만 정정하면 recipientSnapshot 과 manifestVersion 은 패치에 없다', () => {
    const outcome = resolveRecipientRevision(current, { entrancePassword: '#9999' });

    expect(outcome.update).toEqual({ entrancePassword: '#9999' });
    expect(outcome.update.recipientSnapshot).toBeUndefined();
    expect(outcome.update.manifestVersion).toBeUndefined();
    expect(outcome.snapshotChanged).toBe(false);
    expect(outcome.passwordChanged).toBe(true);
  });

  it('통관부호가 실린 스냅샷도 비번만 정정하면 손대지 않는다', () => {
    // shipments.recipientSnapshot 은 salesOrder.shippingAddress 를 그대로 복사한 값이라
    // sales-order AddressDto 의 personalCustomsCode 까지 실려 있을 수 있다. fulfillment
    // AddressDto 는 그 키를 모른다 — 그래서 정정 커맨드는 "안 보내기"로 지킨다.
    const outcome = resolveRecipientRevision(
      { ...current, recipientSnapshot: { ...RECIPIENT, personalCustomsCode: 'P123456789' } },
      { entrancePassword: '#9999' },
    );

    expect(outcome.update).toEqual({ entrancePassword: '#9999' });
    expect(outcome.snapshotChanged).toBe(false);
  });

  it('7키 스냅샷 위에 6키 스냅샷을 되보내면 통관부호가 지워지고 manifestVersion 이 오른다', () => {
    // 이래서 admin-web 은 비번만 고칠 때 recipientSnapshot 을 아예 보내지 않는다.
    // 서버 whitelist:true 가 personalCustomsCode 를 떨어뜨리므로 되보내기로는 못 지킨다.
    const outcome = resolveRecipientRevision(
      { ...current, recipientSnapshot: { ...RECIPIENT, personalCustomsCode: 'P123456789' } },
      { recipientSnapshot: { ...RECIPIENT }, entrancePassword: '#9999' },
    );

    expect(outcome.snapshotChanged).toBe(true);
    expect(outcome.update.manifestVersion).toBe(4);
  });

  it('저장된 deliveryNote 가 null 이어도 같은 스냅샷으로 본다', () => {
    // @IsOptional() 은 null 을 통과시키므로 스냅샷에 null 이 저장돼 있을 수 있다.
    // 그걸 "다른 값"으로 읽으면 주소를 안 고친 정정에서도 manifestVersion 이 오른다.
    const outcome = resolveRecipientRevision(
      { ...current, recipientSnapshot: { ...RECIPIENT, deliveryNote: null } },
      { recipientSnapshot: { ...RECIPIENT }, entrancePassword: '#9999' },
    );

    expect(outcome.update).toEqual({ entrancePassword: '#9999' });
    expect(outcome.snapshotChanged).toBe(false);
  });

  it('스냅샷이 바뀌면 manifestVersion 을 올린다', () => {
    const next = { ...RECIPIENT, detailAddress: '102동 1002호' };
    const outcome = resolveRecipientRevision(current, { recipientSnapshot: next });

    expect(outcome.update).toEqual({ recipientSnapshot: next, manifestVersion: 4 });
    expect(outcome.snapshotChanged).toBe(true);
    expect(outcome.passwordChanged).toBe(false);
  });

  it('비번은 절대 recipientSnapshot 안으로 들어가지 않는다', () => {
    const next = { ...RECIPIENT, detailAddress: '102동 1002호' };
    const outcome = resolveRecipientRevision(current, { recipientSnapshot: next, entrancePassword: '#9999' });

    expect(outcome.update.recipientSnapshot).toEqual(next);
    expect(outcome.update.entrancePassword).toBe('#9999');
    expect(JSON.stringify(outcome.update.recipientSnapshot)).not.toContain('#9999');
  });

  it('같은 비번을 다시 보내면 패치가 비어 있다', () => {
    expect(resolveRecipientRevision(current, { entrancePassword: '#1234' }).update).toEqual({});
  });

  it('공백뿐인 비번은 정정으로 치지 않는다', () => {
    expect(resolveRecipientRevision(current, { entrancePassword: '   ' }).update).toEqual({});
  });

  it('아무것도 보내지 않으면 패치가 비어 있다', () => {
    const outcome = resolveRecipientRevision(current, {});
    expect(outcome.update).toEqual({});
    expect(outcome.snapshotChanged).toBe(false);
    expect(outcome.passwordChanged).toBe(false);
  });

  it('비번이 없던 shipment 에 비번을 채울 수 있다', () => {
    const outcome = resolveRecipientRevision({ ...current, entrancePassword: null }, { entrancePassword: '#9999' });
    expect(outcome.update).toEqual({ entrancePassword: '#9999' });
  });
});

/**
 * admin-web 이 비번만 고칠 때 보내는 body 를 core 가 실제로 받는지 본다. 배포와 동일한
 * 전역 파이프(whitelist:true)를 쓰므로 main.ts 가 회귀하면 여기서 걸린다.
 */
describe('ReviseShipmentRecipientDto 경계', () => {
  const pipe = createGlobalValidationPipe();
  const meta = { type: 'body' as const, metatype: ReviseShipmentRecipientDto };
  const RECIPIENT = {
    recipientName: '홍길동',
    phone: '010-0000-0000',
    postalCode: '01234',
    roadAddress: '서울 테스트로 1',
    detailAddress: '101동 1001호',
  };

  it('recipientSnapshot 없이 비번만 담긴 body 를 통과시킨다', async () => {
    const dto = (await pipe.transform(
      { expectedManifestVersion: 3, entrancePassword: '#9999', reason: '고객 요청' },
      meta,
    )) as ReviseShipmentRecipientDto;

    expect(dto.entrancePassword).toBe('#9999');
    expect(dto.recipientSnapshot).toBeUndefined();
  });

  it('whitelist 가 personalCustomsCode 를 스냅샷에서 떨어뜨린다 — 되보내기로는 통관부호를 못 지킨다', async () => {
    const dto = (await pipe.transform(
      {
        expectedManifestVersion: 3,
        reason: '주소 정정',
        recipientSnapshot: { ...RECIPIENT, personalCustomsCode: 'P123456789' },
      },
      meta,
    )) as ReviseShipmentRecipientDto;

    expect(dto.recipientSnapshot).toBeDefined();
    expect('personalCustomsCode' in (dto.recipientSnapshot ?? {})).toBe(false);
  });

  it('비번은 문자열이어야 한다', async () => {
    await expect(
      pipe.transform({ expectedManifestVersion: 3, reason: '고객 요청', entrancePassword: 1234 }, meta),
    ).rejects.toThrow();
  });
});
