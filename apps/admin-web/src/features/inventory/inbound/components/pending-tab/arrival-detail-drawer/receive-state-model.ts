export type ReceiveDraft = {
  quantity: number;
  locationId: string;
  memo: string;
};

export type ReceiveDraftState = Record<string, ReceiveDraft>;
export type ReceiveDraftField = keyof ReceiveDraft;

export function receiveDraftKey(documentId: string, skuId: string): string {
  return `${documentId}:${skuId}`;
}

export function getReceiveDraft(
  state: ReceiveDraftState,
  documentId: string,
  skuId: string,
  outstandingQty: number
): ReceiveDraft {
  return state[receiveDraftKey(documentId, skuId)] ?? {
    quantity: outstandingQty,
    locationId: '',
    memo: '',
  };
}

export function updateReceiveDraft(
  state: ReceiveDraftState,
  documentId: string,
  skuId: string,
  outstandingQty: number,
  field: ReceiveDraftField,
  value: string | number
): ReceiveDraftState {
  const key = receiveDraftKey(documentId, skuId);
  const current = getReceiveDraft(state, documentId, skuId, outstandingQty);
  if (field === 'quantity' && typeof value === 'number') {
    return { ...state, [key]: { ...current, quantity: value } };
  }
  if (field === 'locationId' && typeof value === 'string') {
    return { ...state, [key]: { ...current, locationId: value } };
  }
  if (field === 'memo' && typeof value === 'string') {
    return { ...state, [key]: { ...current, memo: value } };
  }
  return state;
}
