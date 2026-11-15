import type { UploadInboundShipmentBody } from '@/lib/types/dto/inbound-shipment';
import type { ReadWorkbookResult } from './read-workbook';

/** 원본 엑셀을 보관하지 못했다. 초안은 만들지 않았다 — 사용자가 «원본 없이 올릴까요?» 에 답한다. */
export class OriginalUploadFailedError extends Error {
  constructor(readonly cause: unknown) {
    super('원본 파일을 보관하지 못했습니다.');
    this.name = 'OriginalUploadFailedError';
  }
}

export interface InboundShipmentUploadInput {
  file: File;
  read: ReadWorkbookResult;
  warehouseId: string;
  name: string;
  expectedArrival?: string;
  allowWithoutOriginal?: boolean;
}

export interface InboundShipmentUploadDeps {
  uploadOriginal(file: File): Promise<{ id: string }>;
  createDraft(body: UploadInboundShipmentBody): Promise<{ shipmentId: string }>;
}

/** ① 원본 보관 → ② 초안 생성. 원본이 실패하면 core 를 부르지 않는다. */
export async function runInboundShipmentUpload(
  input: InboundShipmentUploadInput,
  deps: InboundShipmentUploadDeps,
): Promise<{ shipmentId: string; sourceFileId: string | null }> {
  let sourceFileId: string | null = null;
  if (!input.allowWithoutOriginal) {
    try {
      sourceFileId = (await deps.uploadOriginal(input.file)).id;
    } catch (cause) {
      throw new OriginalUploadFailedError(cause);
    }
  }
  const { shipmentId } = await deps.createDraft({
    warehouseId: input.warehouseId,
    name: input.name,
    ...(input.expectedArrival ? { expectedArrival: input.expectedArrival } : {}),
    ...(sourceFileId ? { sourceFileId } : {}),
    sourceFileName: input.file.name,
    header: input.read.header,
    rows: input.read.rows,
  });
  return { shipmentId, sourceFileId };
}
