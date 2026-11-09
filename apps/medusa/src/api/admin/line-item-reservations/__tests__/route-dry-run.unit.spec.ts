import { POST } from '../route';

const mockPlan = jest.fn();
const mockRun = jest.fn();
jest.mock('../../../../workflows/line-item-reservation/steps', () => ({
  readReservationBatchPlan: (...args: unknown[]) => mockPlan(...args),
}));
jest.mock('../../../../workflows/line-item-reservation/workflows', () => ({
  setLineItemReservationsWorkflow: () => ({ run: mockRun }),
}));

describe('POST /admin/line-item-reservations dry_run', () => {
  it('계획된 결과만 돌려주고 워크플로를 돌리지 않는다', async () => {
    const results = [{ line_item_id: 'li_1', outcome: 'set', quantity_before: 0, quantity_after: 2 }];
    mockPlan.mockResolvedValue({ results, creates: [{}], updates: [], deletes: [] });
    const json = jest.fn();
    const items = [{ line_item_id: 'li_1', quantity: 2, allow_decrease: true }];
    await POST({ validatedBody: { items, dry_run: true }, scope: {} } as never, { json } as never);
    expect(mockRun).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ results });
  });
});
