import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { DirectShipController } from './direct-ship.controller';
import { SupplierHandoffService } from '../supplier-shipment/supplier-handoff.service';
import { SupplierSheetApplyService } from '../supplier-shipment/supplier-sheet-apply.service';
import { SupplierHandoffListReader } from '../supplier-shipment/supplier-handoff-list.reader';
import { SupplierShipmentQueueReader } from '../supplier-shipment/supplier-shipment-queue.reader';
import { DirectShipService } from '../services/direct-ship.service';
import { DirectShipCancelNoticeService } from '../direct-ship-cancel-notice/direct-ship-cancel-notice.service';

type Part = { type: 'file'; fieldname: string; buffer: Buffer } | { type: 'field'; fieldname: string; value: string };

/** `@fastify/multipart` 의 `request.parts()` 대역(선례 `bulk-upload.multipart.spec.ts`). */
function multipart(parts: Part[]): FastifyRequest {
  return {
    isMultipart: () => true,
    parts: async function* () {
      for (const part of parts) {
        if (part.type === 'file') {
          yield {
            type: 'file' as const,
            fieldname: part.fieldname,
            filename: '직배.xlsx',
            file: { truncated: false },
            toBuffer: async () => part.buffer,
          };
        } else {
          yield { type: 'field' as const, fieldname: part.fieldname, value: part.value };
        }
      }
    },
  } as unknown as FastifyRequest;
}

const SUPPLIER = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const FILE: Part = { type: 'file', fieldname: 'file', buffer: Buffer.from('xlsx') };

describe('POST /direct-ship/suppliers/:supplierId/uploads/{preview,apply}', () => {
  const preview = jest.fn().mockResolvedValue({ rows: [], counts: {}, token: 'tok' });
  const apply = jest.fn().mockResolvedValue({ counts: {}, shippedShipmentIds: [] });
  let controller: DirectShipController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DirectShipController],
      providers: [
        { provide: DirectShipService, useValue: {} },
        { provide: SupplierShipmentQueueReader, useValue: {} },
        { provide: SupplierHandoffListReader, useValue: {} },
        { provide: SupplierHandoffService, useValue: {} },
        { provide: DirectShipCancelNoticeService, useValue: {} },
        { provide: SupplierSheetApplyService, useValue: { preview, apply } },
      ],
    }).compile();
    controller = module.get(DirectShipController);
  });
  beforeEach(() => {
    preview.mockClear();
    apply.mockClear();
  });

  it('미리보기는 파일 바이트만 서비스에 넘긴다', async () => {
    await controller.previewSupplierUpload(SUPPLIER, multipart([FILE]));
    expect(preview).toHaveBeenCalledWith(SUPPLIER, Buffer.from('xlsx'));
  });

  it('적용은 폼 칸 previewToken 과 운영자 id 를 넘긴다', async () => {
    await controller.applySupplierUpload(
      SUPPLIER,
      multipart([{ type: 'field', fieldname: 'previewToken', value: ' tok ' }, FILE]),
      { userId: ACTOR },
    );
    expect(apply).toHaveBeenCalledWith(SUPPLIER, Buffer.from('xlsx'), 'tok', ACTOR);
  });

  it.each([
    ['없음', [FILE]],
    ['공백뿐', [FILE, { type: 'field' as const, fieldname: 'previewToken', value: '  ' }]],
  ])('previewToken 이 %s 이면 400, 서비스를 부르지 않는다', async (_label, parts) => {
    await expect(controller.applySupplierUpload(SUPPLIER, multipart(parts), { userId: ACTOR })).rejects.toThrow(
      new BadRequestException('previewToken is required'),
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
