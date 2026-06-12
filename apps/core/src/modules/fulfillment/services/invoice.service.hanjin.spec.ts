import { BadRequestException, ConflictException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { InvoiceService, IssueInvoiceRequest } from './invoice.service';

/**
 * 한진 송장 발행/출력/취소/추적 격리 테스트.
 * 실제 한진 API 계약 전이므로 fake provider 로 InvoiceService 의 계약만 검증한다:
 * - provider 응답 → invoices/shipments 저장 규칙
 * - 상태 전이 가드, 취소 후 재발행, 동시 발행 방어(FOR UPDATE), 보상 취소
 * - goodsflow 호환 유지
 */
describe('InvoiceService (hanjin)', () => {
  const foId = 'fo-11111111-1111-1111-1111-111111111111';
  const dialect = new PgDialect();

  function makeFakeProvider() {
    return {
      isConfigured: jest.fn(() => true),
      issueInvoice: jest.fn().mockResolvedValue({
        serviceId: 'HJ-SVC-001',
        invoiceNumber: '551234567890',
        carrierCode: 'HANJIN',
      }),
      generatePrintUri: jest.fn().mockResolvedValue({ printUri: 'https://print.hanjin.example/labels/1' }),
      trackDelivery: jest.fn().mockResolvedValue({
        serviceId: 'HJ-SVC-001',
        invoiceNumber: '551234567890',
        status: 'in_transit',
        timestamp: new Date(),
      }),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
    };
  }

  /** select 호출 순서대로 결과를 돌려주고 where/for 인자를 기록하는 chainable mock tx */
  function makeTx(selectResults: unknown[][]) {
    let selectIndex = 0;
    const selectCalls: Array<{ whereArgs: unknown[]; forArgs: unknown[] }> = [];
    const inserts: Array<{ table: unknown; values: unknown; onConflict: unknown }> = [];
    const updates: Array<{ table: unknown; set: unknown; whereArgs: unknown[] }> = [];
    const deletes: Array<{ table: unknown }> = [];

    function makeSelectChain(result: unknown[]) {
      const record = { whereArgs: [] as unknown[], forArgs: [] as unknown[] };
      selectCalls.push(record);
      const chain: any = {};
      for (const m of ['from', 'limit', 'innerJoin', 'leftJoin', 'orderBy']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.where = jest.fn((arg: unknown) => {
        record.whereArgs.push(arg);
        return chain;
      });
      chain.for = jest.fn((arg: unknown) => {
        record.forArgs.push(arg);
        return chain;
      });
      chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    }

    const tx: any = {
      select: jest.fn(() => makeSelectChain(selectResults[selectIndex++] ?? [])),
      insert: jest.fn((table: unknown) => {
        const record = { table, values: undefined as unknown, onConflict: undefined as unknown };
        inserts.push(record);
        const chain: any = {
          values: jest.fn((v: unknown) => {
            record.values = v;
            return chain;
          }),
          onConflictDoUpdate: jest.fn((c: unknown) => {
            record.onConflict = c;
            return chain;
          }),
          returning: jest.fn(() => Promise.resolve([{ id: 'generated-invoice-id', ...(record.values as object) }])),
        };
        chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve, reject);
        return chain;
      }),
      update: jest.fn((table: unknown) => {
        const record = { table, set: undefined as unknown, whereArgs: [] as unknown[] };
        updates.push(record);
        const afterWhere: any = {
          returning: jest.fn(() => Promise.resolve([{ id: 'updated-1' }])),
        };
        afterWhere.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve, reject);
        return {
          set: jest.fn((s: unknown) => {
            record.set = s;
            return {
              where: jest.fn((arg: unknown) => {
                record.whereArgs.push(arg);
                return afterWhere;
              }),
            };
          }),
        };
      }),
      delete: jest.fn((table: unknown) => {
        deletes.push({ table });
        return { where: jest.fn(() => Promise.resolve()) };
      }),
    };

    return { tx, selectCalls, inserts, updates, deletes };
  }

  function makeService(selectResults: unknown[][]) {
    const { tx, selectCalls, inserts, updates, deletes } = makeTx(selectResults);
    const dbService: any = { db: { transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } };
    const fulfillmentsService: any = { ship: jest.fn().mockResolvedValue(undefined) };
    const goodsflowProvider = makeFakeProvider();
    const hanjinProvider = makeFakeProvider();

    const service = new InvoiceService(dbService, fulfillmentsService, goodsflowProvider as any, hanjinProvider as any);
    return {
      service,
      tx,
      selectCalls,
      inserts,
      updates,
      deletes,
      fulfillmentsService,
      goodsflowProvider,
      hanjinProvider,
    };
  }

  /**
   * issueInvoice 의 select 순서:
   * Phase 1 — ① FO 조회 ② 활성 invoice 중복 체크 ③ FOI 조회 ④ 단가 조회
   * Phase 3 — ⑤ FO 재조회(FOR UPDATE) ⑥ 활성 invoice 재체크
   */
  function issuableSelectResults(foStatus = 'picked'): unknown[][] {
    return [
      [{ id: foId, status: foStatus }],
      [],
      [{ foiId: 'foi-1', salesOrderLineId: 'sol-1', productName: '아몬드 250g', quantity: 2 }],
      [{ id: 'sol-1', unitPrice: 12000 }],
      [{ id: foId, status: foStatus }],
      [],
    ];
  }

  const issueRequest: IssueInvoiceRequest = {
    fulfillmentOrderId: foId,
    carrierCode: 'HANJIN',
    recipientName: '홍길동',
    recipientAddress: '서울시 강남구 테헤란로 1',
    recipientPhone: '010-1234-5678',
    issueMethod: 'hanjin',
  };

  describe('issueInvoice', () => {
    it('hanjin 발행: provider 응답이 invoices 에 issueMethod/invoiceNumber/외부 service id 로 저장된다', async () => {
      const { service, inserts, hanjinProvider } = makeService(issuableSelectResults());

      const invoiceId = await service.issueInvoice(issueRequest);

      expect(invoiceId).toBe('generated-invoice-id');
      expect(hanjinProvider.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          carrierCode: 'HANJIN',
          recipientName: '홍길동',
          items: [{ productName: '아몬드 250g', quantity: 2, price: 12000 }],
        }),
      );

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect(invoiceInsert?.values).toEqual(
        expect.objectContaining({
          fulfillmentOrderId: foId,
          invoiceNumber: '551234567890',
          carrierCode: 'HANJIN',
          issueMethod: 'hanjin',
          goodsflowServiceId: 'HJ-SVC-001',
          status: 'issued',
        }),
      );
    });

    it('hanjin 발행: shipments 에 trackingNo=운송장번호, carrier=HANJIN 으로 upsert 된다 (ship payload 근거)', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      const shipmentInsert = inserts.find((i) => i.table === wmsTables.shipments);
      expect(shipmentInsert?.values).toEqual(
        expect.objectContaining({
          fulfillmentOrderId: foId,
          trackingNo: '551234567890',
          carrier: 'HANJIN',
          status: 'created',
        }),
      );
      expect(shipmentInsert?.onConflict).toEqual(
        expect.objectContaining({
          set: expect.objectContaining({ trackingNo: '551234567890', carrier: 'HANJIN' }),
        }),
      );
    });

    it('issueMethod 미지정: 한진 env 설정 시 hanjin 이 기본', async () => {
      const { service, hanjinProvider, goodsflowProvider } = makeService(issuableSelectResults());
      hanjinProvider.isConfigured.mockReturnValue(true);

      await service.issueInvoice({ ...issueRequest, issueMethod: undefined });

      expect(hanjinProvider.issueInvoice).toHaveBeenCalled();
      expect(goodsflowProvider.issueInvoice).not.toHaveBeenCalled();
    });

    it('issueMethod 미지정: 한진 env 미설정(승인 전)이면 기존 기본값 goodsflow 유지 — 503 으로 깨지지 않는다', async () => {
      const { service, hanjinProvider, goodsflowProvider } = makeService(issuableSelectResults());
      hanjinProvider.isConfigured.mockReturnValue(false);

      await service.issueInvoice({ ...issueRequest, issueMethod: undefined, carrierCode: 'CJ' });

      expect(goodsflowProvider.issueInvoice).toHaveBeenCalled();
      expect(hanjinProvider.issueInvoice).not.toHaveBeenCalled();
    });

    it('hanjin 발행 시 요청 carrierCode 가 달라도 HANJIN 으로 강제된다', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice({ ...issueRequest, carrierCode: 'CJ' });

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect(invoiceInsert?.values).toEqual(expect.objectContaining({ carrierCode: 'HANJIN' }));
    });

    it('발행 성공 시 FO status 가 invoiced 로 전이된다', async () => {
      const { service, updates } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      const foUpdate = updates.find((u) => u.table === wmsTables.fulfillmentOrders);
      expect(foUpdate?.set).toEqual({ status: 'invoiced' });
    });

    it('inspected 상태 FO 도 발행 가능 (검수는 선택 단계)', async () => {
      const { service, hanjinProvider } = makeService(issuableSelectResults('inspected'));

      await service.issueInvoice(issueRequest);

      expect(hanjinProvider.issueInvoice).toHaveBeenCalled();
    });

    it('picked/inspected 외 상태에서는 ConflictException — provider 호출 전에 차단', async () => {
      const { service, hanjinProvider } = makeService(issuableSelectResults('allocated'));

      await expect(service.issueInvoice(issueRequest)).rejects.toThrow(ConflictException);
      expect(hanjinProvider.issueInvoice).not.toHaveBeenCalled();
    });

    it('같은 FO 에 활성 invoice 가 있으면 ConflictException — provider 호출 전에 차단', async () => {
      const selectResults = issuableSelectResults();
      selectResults[1] = [{ id: 'existing-invoice-id' }];
      const { service, hanjinProvider } = makeService(selectResults);

      await expect(service.issueInvoice(issueRequest)).rejects.toThrow(ConflictException);
      expect(hanjinProvider.issueInvoice).not.toHaveBeenCalled();
    });

    it('중복 체크는 canceled 를 제외한다 — 취소 후 재발행 가능 (where 에 status <> canceled)', async () => {
      const { service, selectCalls } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      // ② 활성 invoice 중복 체크의 where 조건 검증
      const duplicateCheckWhere = selectCalls[1].whereArgs[0];
      const rendered = dialect.sqlToQuery(duplicateCheckWhere as any);
      expect(rendered.sql).toContain('<>');
      expect(rendered.params).toEqual(expect.arrayContaining([foId, 'canceled']));
    });

    it('쓰기 단계 FO 재조회는 FOR UPDATE 로 잠근다 (동시 발행 race 방어)', async () => {
      const { service, selectCalls } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      expect(selectCalls[0].forArgs).toEqual([]); // Phase 1 은 lock 없음
      expect(selectCalls[4].forArgs).toEqual(['update']); // Phase 3 FO 재조회
    });

    it('외부 발급 성공 후 DB 기록 실패 시 보상 취소를 호출하고 에러를 다시 던진다', async () => {
      const { service, tx, hanjinProvider } = makeService(issuableSelectResults());
      tx.insert = jest.fn(() => {
        throw new Error('unique violation');
      });

      await expect(service.issueInvoice(issueRequest)).rejects.toThrow('unique violation');

      expect(hanjinProvider.issueInvoice).toHaveBeenCalled();
      expect(hanjinProvider.cancelInvoice).toHaveBeenCalledWith('HJ-SVC-001');
    });

    it('보상 취소 자체가 실패해도 원래 에러가 전파된다 (고아 송장은 로그로 기록)', async () => {
      const { service, tx, hanjinProvider } = makeService(issuableSelectResults());
      tx.insert = jest.fn(() => {
        throw new Error('unique violation');
      });
      hanjinProvider.cancelInvoice.mockRejectedValue(new Error('hanjin down'));

      await expect(service.issueInvoice(issueRequest)).rejects.toThrow('unique violation');
    });

    it('goodsflow 발행 호환: goodsflow provider 를 타고 요청 carrierCode 를 유지한다', async () => {
      const { service, inserts, goodsflowProvider, hanjinProvider } = makeService(issuableSelectResults());
      goodsflowProvider.issueInvoice.mockResolvedValue({
        serviceId: 'GF-SVC-001',
        invoiceNumber: 'GF-INV-001',
        carrierCode: 'CJ',
      });

      await service.issueInvoice({ ...issueRequest, issueMethod: 'goodsflow', carrierCode: 'CJ' });

      expect(goodsflowProvider.issueInvoice).toHaveBeenCalled();
      expect(hanjinProvider.issueInvoice).not.toHaveBeenCalled();

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect(invoiceInsert?.values).toEqual(
        expect.objectContaining({ issueMethod: 'goodsflow', carrierCode: 'CJ', goodsflowServiceId: 'GF-SVC-001' }),
      );
      const shipmentInsert = inserts.find((i) => i.table === wmsTables.shipments);
      expect(shipmentInsert?.values).toEqual(expect.objectContaining({ carrier: 'CJ', trackingNo: 'GF-INV-001' }));
    });

    it('direct 발행: 운영자가 입력한 실제 운송장 번호가 invoice/shipment 에 저장된다', async () => {
      const { service, inserts, goodsflowProvider, hanjinProvider } = makeService(issuableSelectResults());

      await service.issueInvoice({
        ...issueRequest,
        issueMethod: 'direct',
        carrierCode: 'LOTTE',
        invoiceNumber: '881122334455',
      });

      expect(goodsflowProvider.issueInvoice).not.toHaveBeenCalled();
      expect(hanjinProvider.issueInvoice).not.toHaveBeenCalled();

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect(invoiceInsert?.values).toEqual(
        expect.objectContaining({
          issueMethod: 'direct',
          carrierCode: 'LOTTE',
          invoiceNumber: '881122334455',
          goodsflowServiceId: undefined,
        }),
      );
      const shipmentInsert = inserts.find((i) => i.table === wmsTables.shipments);
      expect(shipmentInsert?.values).toEqual(expect.objectContaining({ carrier: 'LOTTE', trackingNo: '881122334455' }));
    });

    it('direct 발행은 운송장 번호 없이는 차단된다 (내부발번이 고객 tracking 으로 나가는 사고 방지)', async () => {
      const { service } = makeService(issuableSelectResults());

      await expect(
        service.issueInvoice({ ...issueRequest, issueMethod: 'direct', carrierCode: 'LOTTE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('self 발행: 내부 발번(INV-*) 사용', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice({ ...issueRequest, issueMethod: 'self', carrierCode: 'CJ' });

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect((invoiceInsert?.values as { invoiceNumber: string }).invoiceNumber).toMatch(/^INV-/);
    });

    it('carrier enum 에 없는 carrierCode 는 발행 자체가 거부된다 (CJ/빈 trackingNo fallback 사고 차단)', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await expect(
        service.issueInvoice({
          ...issueRequest,
          issueMethod: 'direct',
          carrierCode: 'POST',
          invoiceNumber: '881122334455',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(inserts.length).toBe(0);
    });

    it('발행 성공 시 shipment 는 항상 생성된다 (ship payload 의 carrier/trackingNo 보장)', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice({
        ...issueRequest,
        issueMethod: 'direct',
        carrierCode: 'LOGEN',
        invoiceNumber: '881122334455',
      });

      const shipmentInsert = inserts.find((i) => i.table === wmsTables.shipments);
      expect(shipmentInsert?.values).toEqual(expect.objectContaining({ carrier: 'LOGEN' }));
    });
  });

  describe('printInvoices', () => {
    it('hanjin invoice 출력: hanjin provider 의 printUri 반환, issued → printed', async () => {
      const { service, updates, hanjinProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'issued' }],
      ]);

      const result = await service.printInvoices(['inv-1']);

      expect(hanjinProvider.generatePrintUri).toHaveBeenCalledWith(['HJ-SVC-001']);
      expect(result.printUri).toBe('https://print.hanjin.example/labels/1');

      const invoiceUpdate = updates.find((u) => u.table === wmsTables.invoices);
      expect(invoiceUpdate?.set).toEqual(expect.objectContaining({ status: 'printed' }));
    });

    it('provider + direct 혼합 배치는 부분 출력 없이 전체 거부된다', async () => {
      const { service, hanjinProvider, updates } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'direct', goodsflowServiceId: null, status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('외부 service id 가 없는 provider invoice 가 섞이면 전체 거부된다', async () => {
      const { service, hanjinProvider } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'hanjin', goodsflowServiceId: null, status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
    });

    it('goodsflow/hanjin 혼합 배치 출력은 BadRequestException', async () => {
      const { service } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'goodsflow', goodsflowServiceId: 'GF-SVC-001', status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
    });

    it('direct/self 만 있으면 출력 불가 (BadRequestException)', async () => {
      const { service } = makeService([
        [{ id: 'inv-1', issueMethod: 'direct', goodsflowServiceId: null, status: 'issued' }],
      ]);

      await expect(service.printInvoices(['inv-1'])).rejects.toThrow(BadRequestException);
    });

    it('shipped/canceled invoice 가 포함되면 출력 거부 — printed 로 회귀 방지', async () => {
      const { service, hanjinProvider, updates } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-002', status: 'shipped' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(ConflictException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
      expect(updates.length).toBe(0);
    });

    it('printed 재출력은 허용된다 (멱등)', async () => {
      const { service, hanjinProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001', status: 'printed' }],
      ]);

      const result = await service.printInvoices(['inv-1']);

      expect(hanjinProvider.generatePrintUri).toHaveBeenCalledWith(['HJ-SVC-001']);
      expect(result.printUri).toBe('https://print.hanjin.example/labels/1');
    });
  });

  describe('markAsShipped', () => {
    function shipSelectResults(invoice: Record<string, unknown>): unknown[][] {
      return [[invoice]];
    }

    it('hanjin printed → shipped, FulfillmentsService.ship 위임', async () => {
      const { service, fulfillmentsService } = makeService(
        shipSelectResults({
          id: 'inv-1',
          fulfillmentOrderId: foId,
          issueMethod: 'hanjin',
          invoiceNumber: '551234567890',
          status: 'printed',
        }),
      );

      await service.markAsShipped('inv-1');

      expect(fulfillmentsService.ship).toHaveBeenCalledWith(foId, expect.anything());
    });

    it('hanjin issued 상태에서는 ship 불가 (printed 필요)', async () => {
      const { service } = makeService(
        shipSelectResults({
          id: 'inv-1',
          fulfillmentOrderId: foId,
          issueMethod: 'hanjin',
          invoiceNumber: '551234567890',
          status: 'issued',
        }),
      );

      await expect(service.markAsShipped('inv-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelInvoice', () => {
    // select 순서: ① invoice 조회(읽기) → provider 취소(tx 밖) → ② invoice 상태 재검증 ③ 완료된 inspection session 조회
    const hanjinInvoiceRow = {
      id: 'inv-1',
      fulfillmentOrderId: foId,
      issueMethod: 'hanjin',
      goodsflowServiceId: 'HJ-SVC-001',
      status: 'issued',
    };
    const cancelableSelects = (inspections: unknown[] = []): unknown[][] => [
      [hanjinInvoiceRow],
      [{ status: 'issued' }],
      inspections,
    ];

    it('hanjin invoice 취소: provider cancel 호출, invoice → canceled, FO → picked, shipment 정리', async () => {
      const { service, updates, deletes, hanjinProvider } = makeService(cancelableSelects());

      await service.cancelInvoice('inv-1');

      expect(hanjinProvider.cancelInvoice).toHaveBeenCalledWith('HJ-SVC-001');

      const invoiceUpdate = updates.find((u) => u.table === wmsTables.invoices);
      expect(invoiceUpdate?.set).toEqual({ status: 'canceled' });
      const foUpdate = updates.find((u) => u.table === wmsTables.fulfillmentOrders);
      expect(foUpdate?.set).toEqual({ status: 'picked' });
      expect(deletes.some((d) => d.table === wmsTables.shipments)).toBe(true);
    });

    it('검수 완료 FO 에서 발행한 송장 취소 시 FO 는 inspected 로 복귀한다 (검수 결과 유지)', async () => {
      const { service, updates } = makeService(cancelableSelects([{ id: 'inspection-session-1' }]));

      await service.cancelInvoice('inv-1');

      const foUpdate = updates.find((u) => u.table === wmsTables.fulfillmentOrders);
      expect(foUpdate?.set).toEqual({ status: 'inspected' });
    });

    it('provider 취소 실패 시 내부 취소도 진행하지 않는다 (외부 송장 살아있는데 재발행되는 사고 방지)', async () => {
      const { service, updates, hanjinProvider } = makeService(cancelableSelects());
      hanjinProvider.cancelInvoice.mockRejectedValue(new Error('Hanjin API error'));

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow('Hanjin API error');

      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
      expect(updates.find((u) => u.table === wmsTables.fulfillmentOrders)).toBeUndefined();
    });

    it('이미 canceled 면 아무것도 하지 않는다 (멱등)', async () => {
      const { service, updates, hanjinProvider } = makeService([[{ ...hanjinInvoiceRow, status: 'canceled' }]]);

      await service.cancelInvoice('inv-1');

      expect(hanjinProvider.cancelInvoice).not.toHaveBeenCalled();
      expect(updates.length).toBe(0);
    });

    it('shipped invoice 는 취소 불가', async () => {
      const { service } = makeService([[{ ...hanjinInvoiceRow, status: 'shipped' }]]);

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow(ConflictException);
    });

    it('provider 취소 도중 shipped 로 전이됐으면 내부 취소를 중단한다', async () => {
      const { service, updates } = makeService([[hanjinInvoiceRow], [{ status: 'shipped' }]]);

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow(ConflictException);
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('goodsflow invoice 취소 호환 유지', async () => {
      const { service, goodsflowProvider } = makeService([
        [{ ...hanjinInvoiceRow, issueMethod: 'goodsflow', goodsflowServiceId: 'GF-SVC-001' }],
        [{ status: 'issued' }],
        [],
      ]);

      await service.cancelInvoice('inv-1');

      expect(goodsflowProvider.cancelInvoice).toHaveBeenCalledWith('GF-SVC-001');
    });
  });

  describe('trackInvoice', () => {
    it('hanjin invoice 추적: hanjin provider 위임', async () => {
      const { service, hanjinProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'hanjin', goodsflowServiceId: 'HJ-SVC-001' }],
      ]);

      const tracking = await service.trackInvoice('inv-1');

      expect(hanjinProvider.trackDelivery).toHaveBeenCalledWith('HJ-SVC-001');
      expect(tracking.status).toBe('in_transit');
    });

    it('goodsflow invoice 추적 호환 유지', async () => {
      const { service, goodsflowProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'goodsflow', goodsflowServiceId: 'GF-SVC-001' }],
      ]);

      await service.trackInvoice('inv-1');

      expect(goodsflowProvider.trackDelivery).toHaveBeenCalledWith('GF-SVC-001');
    });

    it('direct/self invoice 는 추적 불가 (BadRequestException)', async () => {
      const { service } = makeService([[{ id: 'inv-1', issueMethod: 'direct', goodsflowServiceId: null }]]);

      await expect(service.trackInvoice('inv-1')).rejects.toThrow(BadRequestException);
    });
  });
});
