import { OriginalUploadFailedError, runInboundShipmentUpload } from './upload-flow';
import type { ReadWorkbookResult } from './read-workbook';

const read: ReadWorkbookResult = {
  sheetName: 'Sheet1',
  header: ['박스', '품명'],
  rows: [{ rowNumber: 2, cells: [{ text: '1', value: 1 }, { text: '컵', value: '컵' }] }],
  dataRowCount: 1,
};
const file = new File(['x'], '입고리스트.xlsx');
const base = { file, read, warehouseId: 'w1', name: '11월 선적', expectedArrival: '2026-11-30' };

describe('runInboundShipmentUpload', () => {
  it('원본을 올린 뒤 그 id 로 초안을 만든다', async () => {
    const uploadOriginal = jest.fn().mockResolvedValue({ id: 'f1' });
    const createDraft = jest.fn().mockResolvedValue({ shipmentId: 's1' });
    const result = await runInboundShipmentUpload(base, { uploadOriginal, createDraft });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith({
      warehouseId: 'w1',
      name: '11월 선적',
      expectedArrival: '2026-11-30',
      sourceFileId: 'f1',
      sourceFileName: '입고리스트.xlsx',
      header: read.header,
      rows: read.rows,
    });
    expect(result).toEqual({ shipmentId: 's1', sourceFileId: 'f1' });
  });

  it('원본 업로드가 실패하면 OriginalUploadFailedError 로 거절하고 초안을 만들지 않는다', async () => {
    const cause = new Error('boom');
    const uploadOriginal = jest.fn().mockRejectedValue(cause);
    const createDraft = jest.fn();
    const p = runInboundShipmentUpload(base, { uploadOriginal, createDraft });
    await expect(p).rejects.toBeInstanceOf(OriginalUploadFailedError);
    await expect(p).rejects.toMatchObject({ cause });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('allowWithoutOriginal 이면 원본을 올리지 않고 sourceFileId 없이 만든다', async () => {
    const uploadOriginal = jest.fn();
    const createDraft = jest.fn().mockResolvedValue({ shipmentId: 's2' });
    const result = await runInboundShipmentUpload(
      { ...base, allowWithoutOriginal: true },
      { uploadOriginal, createDraft },
    );
    expect(uploadOriginal).not.toHaveBeenCalled();
    expect(createDraft.mock.calls[0][0]).not.toHaveProperty('sourceFileId');
    expect(result).toEqual({ shipmentId: 's2', sourceFileId: null });
  });

  it('초안 만들기 오류는 감싸지 않고 그대로 전파한다', async () => {
    const err = new Error('409');
    const uploadOriginal = jest.fn().mockResolvedValue({ id: 'f1' });
    const createDraft = jest.fn().mockRejectedValue(err);
    await expect(runInboundShipmentUpload(base, { uploadOriginal, createDraft })).rejects.toBe(err);
  });
});
