import {
  FILE_CONTEXTS,
  INBOUND_SHIPMENT_LIST_CONTEXT_ID,
  INBOUND_SHIPMENT_LIST_MAX_SIZE_BYTES,
} from '../default-file-contexts';

describe('입고리스트 원본 file context', () => {
  it('비공개 xlsx 만 50 MiB 까지 받는다', () => {
    expect(INBOUND_SHIPMENT_LIST_CONTEXT_ID).toBe('inbound-shipment-list');
    expect(INBOUND_SHIPMENT_LIST_MAX_SIZE_BYTES).toBe(50 * 1024 * 1024);
    expect(FILE_CONTEXTS.find((context) => context.id === INBOUND_SHIPMENT_LIST_CONTEXT_ID)).toMatchObject({
      allowPublic: false,
      allowPrivate: true,
      allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      maxFileSize: 52428800,
      pathPrefix: 'inventory/inbound-shipment-lists',
      isActive: true,
    });
  });
});
