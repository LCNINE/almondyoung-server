import { CoupangAdapter } from '../adapters/coupang/coupang.adapter';
import { NaverSmartstoreAdapter } from '../adapters/naver/naver-smartstore.adapter';

describe('shipment dispatch provider translations', () => {
  it('uses Naver product-order IDs from command items without an internal-ID fallback', async () => {
    const dispatchOrders = jest.fn().mockResolvedValue({
      data: { successProductOrderIds: ['100000001'], failProductOrderInfos: [] },
      traceId: 'trace-1',
    });
    const adapter = new NaverSmartstoreAdapter({ dispatchOrders } as any, {} as any, {} as any);

    const result = await adapter.executeCommand({
      type: 'dispatch.ship',
      orderId: 'naver-order-1',
      items: [{ orderItemId: '100000001', quantity: 1 }],
      tracking: { companyCode: 'HANJIN', number: 'TRACK-1' },
      // 구현이 배송일을 "30일 전 ~ 현재" 로 검증한다. 절대 날짜를 박으면
      // 벽시계가 창을 벗어나는 순간 스펙이 저절로 빨개진다 (실제로 그랬다).
      dispatchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    expect(result.success).toBe(true);
    expect(dispatchOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        productOrderId: '100000001',
        deliveryCompanyCode: 'HANJIN',
        trackingNumber: 'TRACK-1',
      }),
    ]);
  });

  it('rejects a Naver dispatch without external line IDs before a provider call', async () => {
    const dispatchOrders = jest.fn();
    const adapter = new NaverSmartstoreAdapter({ dispatchOrders } as any, {} as any, {} as any);

    const result = await adapter.executeCommand({
      type: 'dispatch.ship',
      orderId: 'naver-order-1',
      tracking: { companyCode: 'HANJIN', number: 'TRACK-1' },
    });

    expect(result.success).toBe(false);
    expect(dispatchOrders).not.toHaveBeenCalled();
  });

  it('reconciles a Naver retry only when every product-order tracking fact matches', async () => {
    const getOrderDetails = jest.fn().mockResolvedValue({
      data: [
        {
          productOrder: { productOrderId: '100000001', productOrderStatus: 'DELIVERING' },
          delivery: { deliveryCompanyCode: 'HANJIN', trackingNumber: 'TRACK-1' },
        },
      ],
    });
    const adapter = new NaverSmartstoreAdapter({ getOrderDetails } as any, {} as any, {} as any);

    await expect(
      adapter.reconcileCommand({
        type: 'dispatch.ship',
        orderId: '1000000001',
        items: [{ orderItemId: '100000001', quantity: 1 }],
        tracking: { companyCode: 'HANJIN', number: 'TRACK-1' },
      }),
    ).resolves.toEqual(expect.objectContaining({ applied: true }));
  });

  const liveItem = (vendorItemId: number, extra: Record<string, number> = {}) => ({
    vendorItemId,
    vendorItemName: `테스트 상품 ${vendorItemId}`,
    shippingCount: 1,
    cancelCount: 0,
    holdCountForCancel: 0,
    salesPrice: { currencyCode: 'KRW', units: 1000, nanos: 0 },
    orderPrice: { currencyCode: 'KRW', units: 1000, nanos: 0 },
    ...extra,
  });
  /** 발송이 읽는 발주서 — 가짜 값만. 해석(`parseCoupangOrderSheet`)이 요구하는 칸을 모두 채운다. */
  const box = (shipmentBoxId: string, orderItems: unknown[], status = 'INSTRUCT') => ({
    shipmentBoxId,
    orderId: '9001',
    status,
    orderedAt: '2026-11-11T09:00:00',
    paidAt: '2026-11-11T09:05:00',
    receiver: { name: '가짜 수취인', safeNumber: '050-0000-0000', addr1: '테스트시 1' },
    orderItems,
  });
  const okResult = (...shipmentBoxIds: string[]) => ({
    responseCode: 0,
    responseList: shipmentBoxIds.map((shipmentBoxId) => ({
      shipmentBoxId,
      succeed: true,
      resultCode: 'SUCCESS',
      retryRequired: false,
      resultMessage: '',
    })),
  });
  const makeCoupangBoxes = (boxes: unknown[]) => {
    const getSingleOrderSheetByOrderId = jest.fn().mockResolvedValue({ code: 200, data: boxes });
    const uploadInvoices = jest.fn().mockResolvedValue(okResult('123456789012345678'));
    const updateInvoices = jest.fn().mockResolvedValue(okResult('123456789012345678'));
    const adapter = new CoupangAdapter(
      { getSingleOrderSheetByOrderId, uploadInvoices, updateInvoices } as any,
      {} as any,
      {} as any,
    );
    return { adapter, getSingleOrderSheetByOrderId, uploadInvoices, updateInvoices };
  };
  const makeCoupang = (orderItems: unknown[]) => makeCoupangBoxes([box('123456789012345678', orderItems)]);
  const shipCommand = {
    type: 'dispatch.ship' as const,
    orderId: '9001',
    items: [{ orderItemId: '9001:3002', channelProductId: '3002', quantity: 1 }],
    tracking: { companyCode: 'HANJIN', number: 'TRACK-2' },
  };

  it('looks up Coupang shipment boxes using the external order and item IDs', async () => {
    const { adapter, getSingleOrderSheetByOrderId, uploadInvoices } = makeCoupang([liveItem(3002)]);

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(true);
    expect(getSingleOrderSheetByOrderId).toHaveBeenCalledWith('9001');
    expect(uploadInvoices).toHaveBeenCalledWith({
      vendorId: '',
      orderSheetInvoiceApplyDtos: [
        expect.objectContaining({
          shipmentBoxId: '123456789012345678',
          orderId: '9001',
          vendorItemId: 3002,
          deliveryCompanyCode: 'HANJIN',
          invoiceNumber: 'TRACK-2',
          splitShipping: false,
          preSplitShipped: false,
        }),
      ],
    });
  });

  it('쿠팡이 항목을 거절하면 dispatch.ship 은 실패다', async () => {
    const { adapter, uploadInvoices } = makeCoupang([liveItem(3002)]);
    uploadInvoices.mockResolvedValue({
      responseCode: 1,
      responseList: [
        {
          shipmentBoxId: '123456789012345678',
          succeed: false,
          resultCode: 'INVALID_STATUS',
          retryRequired: false,
          resultMessage: '상품준비중이 아님',
        },
      ],
    });

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(false);
    expect(result.errors?.[0].message).toContain('INVALID_STATUS');
    expect(result.errors?.[0].message).toContain('상품준비중이 아님');
  });

  it('responseCode 가 0 이 아니면 항목이 모두 성공이어도 실패다', async () => {
    const { adapter, uploadInvoices } = makeCoupang([liveItem(3002)]);
    uploadInvoices.mockResolvedValue({ ...okResult('123456789012345678'), responseCode: 1 });

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(false);
  });

  it('주문의 살아 있는 품목 일부만 보내려 하면 업로드하지 않고 실패한다', async () => {
    const { adapter, uploadInvoices } = makeCoupang([liveItem(3001), liveItem(3002)]);

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(false);
    expect(result.errors?.[0].message).toContain('나눠 보내기');
    expect(uploadInvoices).not.toHaveBeenCalled();
  });

  it('취소·환불대기로 죽은 품목은 빼고 살아 있는 품목 전부를 보낸다', async () => {
    const { adapter, uploadInvoices } = makeCoupang([
      liveItem(3001, { cancelCount: 1 }),
      liveItem(3003, { shippingCount: 2, holdCountForCancel: 2 }),
      liveItem(3002),
    ]);

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(true);
    expect(uploadInvoices).toHaveBeenCalledTimes(1);
  });

  it('쿠팡 거절의 retryRequired 를 오류마다 retryable 로 옮긴다', async () => {
    const { adapter, uploadInvoices } = makeCoupang([liveItem(3002)]);
    uploadInvoices.mockResolvedValue({
      responseCode: 1,
      responseList: [
        {
          shipmentBoxId: '123456789012345678',
          succeed: false,
          resultCode: 'INVALID_STATUS',
          retryRequired: false,
          resultMessage: '상품준비중이 아님',
        },
      ],
    });
    expect((await adapter.executeCommand(shipCommand)).errors).toEqual([
      expect.objectContaining({ id: '123456789012345678', retryable: false }),
    ]);

    uploadInvoices.mockResolvedValue({
      responseCode: 1,
      responseList: [
        {
          shipmentBoxId: '123456789012345678',
          succeed: false,
          resultCode: 'BUSY',
          retryRequired: true,
          resultMessage: '',
        },
      ],
    });
    expect((await adapter.executeCommand(shipCommand)).errors).toEqual([
      expect.objectContaining({ id: '123456789012345678', retryable: true }),
    ]);
  });

  it('보낸 상자가 응답에 없으면 성공이 아니다 — 그 상자는 재시도할 실패다', async () => {
    const { adapter, uploadInvoices } = makeCoupangBoxes([
      box('100000000000000001', [liveItem(3001)]),
      box('100000000000000002', [liveItem(3002)]),
    ]);
    uploadInvoices.mockResolvedValue(okResult('100000000000000001'));

    const result = await adapter.executeCommand({
      ...shipCommand,
      items: [
        { orderItemId: '9001:3001', channelProductId: '3001', quantity: 1 },
        { orderItemId: '9001:3002', channelProductId: '3002', quantity: 1 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.processedCount).toBe(1);
    expect(result.errors).toEqual([expect.objectContaining({ id: '100000000000000002', retryable: true })]);
  });

  it('일부 상자가 이미 출고됐으면 남은 상자만 보내고, 출고된 상자의 품목은 «다 보냄» 판정에 센다', async () => {
    const { adapter, uploadInvoices } = makeCoupangBoxes([
      box('100000000000000001', [liveItem(3001)], 'DEPARTURE'),
      box('100000000000000002', [liveItem(3002)]),
    ]);
    uploadInvoices.mockResolvedValue(okResult('100000000000000002'));

    const result = await adapter.executeCommand({
      ...shipCommand,
      items: [
        { orderItemId: '9001:3001', channelProductId: '3001', quantity: 1 },
        { orderItemId: '9001:3002', channelProductId: '3002', quantity: 1 },
      ],
    });

    expect(result.success).toBe(true);
    const dtos = uploadInvoices.mock.calls[0][0].orderSheetInvoiceApplyDtos;
    expect(dtos).toEqual([expect.objectContaining({ shipmentBoxId: '100000000000000002', vendorItemId: 3002 })]);
  });

  it.each(['DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING'])(
    '모든 상자가 이미 %s 면 업로드 없이 성공이다(이미 적용됨)',
    async (status) => {
      const { adapter, uploadInvoices } = makeCoupangBoxes([
        box('100000000000000001', [liveItem(3001)], status),
        box('100000000000000002', [liveItem(3002)], status),
      ]);

      const result = await adapter.executeCommand({
        ...shipCommand,
        items: [
          { orderItemId: '9001:3001', channelProductId: '3001', quantity: 1 },
          { orderItemId: '9001:3002', channelProductId: '3002', quantity: 1 },
        ],
      });

      expect(result.success).toBe(true);
      expect(uploadInvoices).not.toHaveBeenCalled();
    },
  );

  it('출고된 상자가 있어도 살아 있는 품목 일부만 보내려 하면 업로드하지 않는다', async () => {
    const { adapter, uploadInvoices } = makeCoupangBoxes([
      box('100000000000000001', [liveItem(3001)], 'DEPARTURE'),
      box('100000000000000002', [liveItem(3002)]),
    ]);

    const result = await adapter.executeCommand(shipCommand);

    expect(result.success).toBe(false);
    expect(result.errors?.[0].message).toContain('나눠 보내기');
    expect(uploadInvoices).not.toHaveBeenCalled();
  });

  it('dispatch.update_tracking 은 주문의 살아 있는 품목 전부로 updateInvoices 를 부른다', async () => {
    const { adapter, updateInvoices } = makeCoupang([
      liveItem(3001),
      liveItem(3002),
      liveItem(3003, { cancelCount: 1 }),
    ]);

    const result = await adapter.executeCommand({
      type: 'dispatch.update_tracking',
      orderId: '9001',
      tracking: { companyCode: 'HANJIN', number: 'TRACK-3' },
    });

    expect(result.success).toBe(true);
    const dtos = updateInvoices.mock.calls[0][0].orderSheetInvoiceApplyDtos;
    expect(dtos.map((d: { vendorItemId: number }) => d.vendorItemId)).toEqual([3001, 3002]);
    expect(dtos[0]).toEqual(
      expect.objectContaining({ invoiceNumber: 'TRACK-3', shipmentBoxId: '123456789012345678', splitShipping: false }),
    );
  });

  it('does not fabricate a Coupang order or item identifier', async () => {
    const getSingleOrderSheetByOrderId = jest.fn();
    const uploadInvoices = jest.fn();
    const adapter = new CoupangAdapter({ getSingleOrderSheetByOrderId, uploadInvoices } as any, {} as any, {} as any);

    const result = await adapter.executeCommand({
      type: 'dispatch.ship',
      orderId: 'internal-so-uuid',
      items: [{ orderItemId: 'internal-line-uuid', quantity: 1 }],
      tracking: { companyCode: 'HANJIN', number: 'TRACK-2' },
    });

    expect(result.success).toBe(false);
    expect(getSingleOrderSheetByOrderId).not.toHaveBeenCalled();
    expect(uploadInvoices).not.toHaveBeenCalled();
  });

  it('reconciles a Coupang retry from order sheet invoice and requested vendor item IDs', async () => {
    const getSingleOrderSheetByOrderId = jest.fn().mockResolvedValue({
      data: [
        {
          orderId: 9001,
          shipmentBoxId: 7001,
          invoiceNumber: 'TRACK-2',
          orderItems: [{ vendorItemId: 3002 }],
        },
      ],
    });
    const adapter = new CoupangAdapter({ getSingleOrderSheetByOrderId } as any, {} as any, {} as any);

    await expect(
      adapter.reconcileCommand({
        type: 'dispatch.ship',
        orderId: '9001',
        items: [{ orderItemId: '4002', channelProductId: '3002', quantity: 1 }],
        tracking: { companyCode: 'HANJIN', number: 'TRACK-2' },
      }),
    ).resolves.toEqual(expect.objectContaining({ applied: true }));
  });
});
