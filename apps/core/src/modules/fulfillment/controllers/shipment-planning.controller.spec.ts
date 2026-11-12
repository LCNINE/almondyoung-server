import { PII_RESPONSE_KEY, REQUIRED_PERMISSIONS_KEY, type PiiResponseSpec } from '@app/authorization';
import { maskPaths } from '@app/shared/pii';
import { FulfillmentOperationController, ShipmentPlanningController } from './shipment-planning.controller';

describe('Shipment planning read contract', () => {
  it('returns typed shipment detail and generic durable operation state', async () => {
    const planning = {
      getShipmentDetail: jest.fn().mockResolvedValue({
        id: 'shipment-1',
        lines: [{ id: 'line-1', reservedQty: 2, inspectedQty: 1, lineVersion: 3 }],
        waybills: [],
        dispatchAttempts: [],
        operations: [{ operationId: 'operation-1', status: 'recovery_required', lastError: 'provider timeout' }],
      }),
      getOperation: jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        type: 'recall',
        status: 'recovery_required',
        lastError: 'provider timeout',
      }),
    };
    const shipmentController = new ShipmentPlanningController(planning as never);
    const operationController = new FulfillmentOperationController(planning as never);

    await expect(shipmentController.detail('shipment-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'shipment-1',
        operations: [expect.objectContaining({ lastError: 'provider timeout' })],
      }),
    );
    await expect(operationController.get('operation-1')).resolves.toEqual(
      expect.objectContaining({ operationId: 'operation-1', status: 'recovery_required' }),
    );
    expect(planning.getShipmentDetail).toHaveBeenCalledWith('shipment-1');
    expect(planning.getOperation).toHaveBeenCalledWith('operation-1');
  });

  it('requires the shipment read permission on both read surfaces', () => {
    const detail = Object.getOwnPropertyDescriptor(ShipmentPlanningController.prototype, 'detail')?.value as object;
    const operation = Object.getOwnPropertyDescriptor(FulfillmentOperationController.prototype, 'get')?.value as object;
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, detail)).toEqual(['fulfillment.shipment.read']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, operation)).toEqual(['fulfillment.shipment.read']);
  });

  it('requires the exact recipient override permission for recipient changes', () => {
    const recipient = Object.getOwnPropertyDescriptor(ShipmentPlanningController.prototype, 'reviseRecipient')
      ?.value as object;
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, recipient)).toEqual([
      'fulfillment.shipment.override_recipient',
    ]);
  });

  describe('출고 상세의 작업 기록 개인정보 선언', () => {
    const detail = Object.getOwnPropertyDescriptor(ShipmentPlanningController.prototype, 'detail')?.value as object;
    const spec = Reflect.getMetadata(PII_RESPONSE_KEY, detail) as PiiResponseSpec;
    const body = {
      id: 'shipment-1',
      operations: [
        {
          operationId: 'operation-1',
          type: 'split',
          operatorId: 'user-1',
          reason: '고객 요청',
          reasonCode: 'customer_ship_first',
          requestChannel: 'kakao',
          note: '010-1234-5678 로 연락',
        },
      ],
    };

    it('기본 가림에서 사유 글과 메모는 가리고 코드·요청 경로·처리자는 원문이다', () => {
      const masked = maskPaths(body, spec.fields).body as typeof body;
      expect(masked.operations[0].note).not.toBe(body.operations[0].note);
      expect(masked.operations[0].reason).not.toBe(body.operations[0].reason);
      expect(masked.operations[0]).toMatchObject({
        reasonCode: 'customer_ship_first',
        requestChannel: 'kakao',
        operatorId: 'user-1',
      });
    });

    it('받는 분 정보 권한으로 사유 글과 메모도 열린다', () => {
      const recipientPerms = spec.rawWithByField?.['recipientSnapshot.recipientName'];
      expect(spec.rawWithByField?.['operations[].reason']).toEqual(recipientPerms);
      expect(spec.rawWithByField?.['operations[].note']).toEqual(recipientPerms);
    });
  });
});
