import { CoupangAdapter } from '../adapters/coupang/coupang.adapter';
import { NaverSmartstoreAdapter } from '../adapters/naver/naver-smartstore.adapter';

describe('shipment dispatch provider translations', () => {
  it('uses Naver product-order IDs from command items without an internal-ID fallback', async () => {
    const dispatchOrders = jest.fn().mockResolvedValue({
      data: { successProductOrderIds: ['100000001'], failProductOrderInfos: [] },
      traceId: 'trace-1',
    });
    const adapter = new NaverSmartstoreAdapter({ dispatchOrders } as any, {} as any, {} as any, {} as any, {} as any);

    const result = await adapter.executeCommand({
      type: 'dispatch.ship',
      orderId: 'naver-order-1',
      items: [{ orderItemId: '100000001', quantity: 1 }],
      tracking: { companyCode: 'HANJIN', number: 'TRACK-1' },
      dispatchedAt: '2026-07-14T00:00:00.000Z',
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
    const adapter = new NaverSmartstoreAdapter({ dispatchOrders } as any, {} as any, {} as any, {} as any, {} as any);

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
    const adapter = new NaverSmartstoreAdapter({ getOrderDetails } as any, {} as any, {} as any, {} as any, {} as any);

    await expect(
      adapter.reconcileCommand({
        type: 'dispatch.ship',
        orderId: '1000000001',
        items: [{ orderItemId: '100000001', quantity: 1 }],
        tracking: { companyCode: 'HANJIN', number: 'TRACK-1' },
      }),
    ).resolves.toEqual(expect.objectContaining({ applied: true }));
  });

  it('looks up Coupang shipment boxes using the external order and item IDs', async () => {
    const getSingleOrderSheetByOrderId = jest.fn().mockResolvedValue({
      data: [
        {
          shipmentBoxId: 7001,
          orderId: 9001,
          orderItems: [{ vendorItemId: 3001 }, { vendorItemId: 3002 }],
        },
      ],
    });
    const uploadInvoices = jest.fn().mockResolvedValue({
      data: { responseList: [{ shipmentBoxId: 7001, succeed: true }] },
    });
    const adapter = new CoupangAdapter(
      { getSingleOrderSheetByOrderId, uploadInvoices } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await adapter.executeCommand({
      type: 'dispatch.ship',
      orderId: '9001',
      items: [{ orderItemId: '3002', quantity: 1 }],
      tracking: { companyCode: 'HANJIN', number: 'TRACK-2' },
    });

    expect(result.success).toBe(true);
    expect(getSingleOrderSheetByOrderId).toHaveBeenCalledWith('9001');
    expect(uploadInvoices).toHaveBeenCalledWith({
      vendorId: '',
      orderSheetInvoiceApplyDtos: [
        expect.objectContaining({
          shipmentBoxId: 7001,
          orderId: 9001,
          vendorItemId: 3002,
          deliveryCompanyCode: 'HANJIN',
          invoiceNumber: 'TRACK-2',
        }),
      ],
    });
  });

  it('does not fabricate a Coupang order or item identifier', async () => {
    const getSingleOrderSheetByOrderId = jest.fn();
    const uploadInvoices = jest.fn();
    const adapter = new CoupangAdapter(
      { getSingleOrderSheetByOrderId, uploadInvoices } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

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
    const adapter = new CoupangAdapter(
      { getSingleOrderSheetByOrderId } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      adapter.reconcileCommand({
        type: 'dispatch.ship',
        orderId: '9001',
        items: [{ orderItemId: '3002', quantity: 1 }],
        tracking: { companyCode: 'HANJIN', number: 'TRACK-2' },
      }),
    ).resolves.toEqual(expect.objectContaining({ applied: true }));
  });
});
