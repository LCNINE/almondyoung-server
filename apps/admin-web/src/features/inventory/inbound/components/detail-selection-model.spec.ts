import { selectArrivalById, selectReceiptById } from './detail-selection-model';

describe('입고 상세 선택은 최신 목록 행을 따른다', () => {
  it('같은 receipt ID가 refetch되면 새 카운터가 든 행을 반환한다', () => {
    const before = { id: 'receipt-1', canceledQty: 0 };
    const after = { id: 'receipt-1', canceledQty: 3 };

    expect(selectReceiptById([after], before.id)).toBe(after);
  });

  it('같은 document ID가 refetch되면 새 잔량이 든 행을 반환하고 사라지면 null이다', () => {
    const before = { documentId: 'po-1', outstandingQty: 10 };
    const after = { documentId: 'po-1', outstandingQty: 4 };

    expect(selectArrivalById([after], before.documentId)).toBe(after);
    expect(selectArrivalById([], before.documentId)).toBeNull();
  });
});
