import { BadRequestException, ConflictException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { InvoiceService, IssueInvoiceRequest } from './invoice.service';

/**
 * 한진 송장 발행/출력/취소(void)/추적 격리 테스트.
 * 실제 한진 API 계약 전이므로 fake provider 로 InvoiceService 의 계약만 검증한다:
 * - provider 응답 → invoices 저장 규칙(새 컬럼명: trackingNo/carrier/externalServiceId/issuedForFulfillmentOrderId)
 * - 상태 전이 가드, 취소 후 재발행, 동시 발행 방어(FOR UPDATE), 보상 취소
 * - issueInvoice 는 선발급-only(박스 upsert 없음 — 박스는 송장 스캔에서 생성)
 * - cancelInvoice 는 void 화(status='voided', 붙은 박스만 canceled)
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
    const dbService: any = {
      db: { transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) },
      run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)),
    };
    const goodsflowProvider = makeFakeProvider();
    const hanjinProvider = makeFakeProvider();

    const service = new InvoiceService(dbService, goodsflowProvider as any, hanjinProvider as any);
    return {
      service,
      tx,
      selectCalls,
      inserts,
      updates,
      deletes,
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
    it('hanjin 발행: provider 응답이 invoices 에 issueMethod/trackingNo/외부 service id 로 저장된다', async () => {
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
          issuedForFulfillmentOrderId: foId,
          trackingNo: '551234567890',
          carrier: 'HANJIN',
          issueMethod: 'hanjin',
          externalServiceId: 'HJ-SVC-001',
          status: 'issued',
        }),
      );
    });

    it('선발급-only: 박스(shipments) 는 더 이상 발급 시점에 생성되지 않는다', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      expect(inserts.find((i) => i.table === wmsTables.shipments)).toBeUndefined();
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

    it('hanjin 발행 시 요청 carrierCode 가 달라도 carrier=HANJIN 으로 강제된다', async () => {
      const { service, inserts } = makeService(issuableSelectResults());

      await service.issueInvoice({ ...issueRequest, carrierCode: 'CJ' });

      const invoiceInsert = inserts.find((i) => i.table === wmsTables.invoices);
      expect(invoiceInsert?.values).toEqual(expect.objectContaining({ carrier: 'HANJIN' }));
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

    it('중복 체크는 voided 를 제외한다 — 취소 후 재발행 가능 (where 에 status <> voided)', async () => {
      const { service, selectCalls } = makeService(issuableSelectResults());

      await service.issueInvoice(issueRequest);

      // ② 활성 invoice 중복 체크의 where 조건 검증
      const duplicateCheckWhere = selectCalls[1].whereArgs[0];
      const rendered = dialect.sqlToQuery(duplicateCheckWhere as any);
      expect(rendered.sql).toContain('<>');
      expect(rendered.params).toEqual(expect.arrayContaining([foId, 'voided']));
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
        expect.objectContaining({ issueMethod: 'goodsflow', carrier: 'CJ', externalServiceId: 'GF-SVC-001' }),
      );
    });

    it('direct 발행: 운영자가 입력한 실제 운송장 번호가 invoice 에 저장된다', async () => {
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
          carrier: 'LOTTE',
          trackingNo: '881122334455',
          externalServiceId: undefined,
        }),
      );
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
      expect((invoiceInsert?.values as { trackingNo: string }).trackingNo).toMatch(/^INV-/);
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
  });

  describe('printInvoices', () => {
    it('hanjin invoice 출력: hanjin provider 의 printUri 반환, status 전이 없음(멱등)', async () => {
      const { service, updates, hanjinProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001', status: 'issued' }],
      ]);

      const result = await service.printInvoices(['inv-1']);

      expect(hanjinProvider.generatePrintUri).toHaveBeenCalledWith(['HJ-SVC-001']);
      expect(result.printUri).toBe('https://print.hanjin.example/labels/1');

      // 인쇄는 외부 URI 생성만 — invoices status 를 바꾸지 않는다
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('provider + direct 혼합 배치는 부분 출력 없이 전체 거부된다', async () => {
      const { service, hanjinProvider, updates } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'direct', externalServiceId: null, status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('외부 service id 가 없는 provider invoice 가 섞이면 전체 거부된다', async () => {
      const { service, hanjinProvider } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'hanjin', externalServiceId: null, status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
    });

    it('goodsflow/hanjin 혼합 배치 출력은 BadRequestException', async () => {
      const { service } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'goodsflow', externalServiceId: 'GF-SVC-001', status: 'issued' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(BadRequestException);
    });

    it('direct/self 만 있으면 출력 불가 (BadRequestException)', async () => {
      const { service } = makeService([
        [{ id: 'inv-1', issueMethod: 'direct', externalServiceId: null, status: 'issued' }],
      ]);

      await expect(service.printInvoices(['inv-1'])).rejects.toThrow(BadRequestException);
    });

    it('issued 외 상태(voided 등) invoice 가 포함되면 출력 거부 — 멱등 인쇄는 issued 에서만', async () => {
      const { service, hanjinProvider, updates } = makeService([
        [
          { id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001', status: 'issued' },
          { id: 'inv-2', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-002', status: 'voided' },
        ],
      ]);

      await expect(service.printInvoices(['inv-1', 'inv-2'])).rejects.toThrow(ConflictException);
      expect(hanjinProvider.generatePrintUri).not.toHaveBeenCalled();
      expect(updates.length).toBe(0);
    });
  });

  describe('cancelInvoice (void)', () => {
    // select 순서: ① invoice 조회(읽기) → provider 취소(tx 밖) → ② invoice 상태/박스 재조회 ③ (박스 있으면) 박스 상태 조회
    const hanjinInvoiceRow = {
      id: 'inv-1',
      issuedForFulfillmentOrderId: foId,
      issueMethod: 'hanjin',
      externalServiceId: 'HJ-SVC-001',
      status: 'issued',
    };

    it('hanjin invoice void: provider cancel 호출, invoice → voided, FO → picked (박스 미연결)', async () => {
      const { service, updates, hanjinProvider } = makeService([
        [hanjinInvoiceRow],
        [{ status: 'issued', shipmentId: null }],
      ]);

      await service.cancelInvoice('inv-1');

      expect(hanjinProvider.cancelInvoice).toHaveBeenCalledWith('HJ-SVC-001');

      const invoiceUpdate = updates.find((u) => u.table === wmsTables.invoices);
      expect(invoiceUpdate?.set).toEqual(expect.objectContaining({ status: 'voided' }));
      const foUpdate = updates.find((u) => u.table === wmsTables.fulfillmentOrders);
      expect(foUpdate?.set).toEqual({ status: 'picked' });
      expect(updates.find((u) => u.table === wmsTables.shipments)).toBeUndefined();
    });

    it('박스가 연결된 invoice void 시 출고 전 박스는 canceled 로 정리된다', async () => {
      const { service, updates } = makeService([
        [hanjinInvoiceRow],
        [{ status: 'issued', shipmentId: 'box-1' }],
        [{ status: 'open' }],
      ]);

      await service.cancelInvoice('inv-1');

      const shipmentUpdate = updates.find((u) => u.table === wmsTables.shipments);
      expect(shipmentUpdate?.set).toEqual(expect.objectContaining({ status: 'canceled' }));
      const invoiceUpdate = updates.find((u) => u.table === wmsTables.invoices);
      expect(invoiceUpdate?.set).toEqual(expect.objectContaining({ status: 'voided' }));
    });

    it('박스가 이미 shipped 면 void 불가 (ConflictException) — provider 외부취소도 호출하지 않는다 (선검사)', async () => {
      // 진입 read 에서 shipmentId 가 잡히면 provider 취소 *전* 에 박스 상태를 선검사한다.
      const { service, updates, hanjinProvider } = makeService([
        [{ ...hanjinInvoiceRow, shipmentId: 'box-1' }],
        [{ status: 'shipped' }],
      ]);

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow(ConflictException);
      expect(hanjinProvider.cancelInvoice).not.toHaveBeenCalled();
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('provider 취소 도중 박스가 shipped 로 전이되면 tx 내 backstop 이 void 를 중단한다', async () => {
      // 진입 시점엔 박스 미연결(shipmentId 없음) → 선검사 통과 → provider 취소 후 tx 안에서 shipped 발견.
      const { service, updates } = makeService([
        [hanjinInvoiceRow],
        [{ status: 'issued', shipmentId: 'box-1' }],
        [{ status: 'shipped' }],
      ]);

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow(ConflictException);
      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
    });

    it('provider 취소 실패 시 내부 void 도 진행하지 않는다 (외부 송장 살아있는데 재발행되는 사고 방지)', async () => {
      const { service, updates, hanjinProvider } = makeService([[hanjinInvoiceRow]]);
      hanjinProvider.cancelInvoice.mockRejectedValue(new Error('Hanjin API error'));

      await expect(service.cancelInvoice('inv-1')).rejects.toThrow('Hanjin API error');

      expect(updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
      expect(updates.find((u) => u.table === wmsTables.fulfillmentOrders)).toBeUndefined();
    });

    it('이미 voided 면 아무것도 하지 않는다 (멱등)', async () => {
      const { service, updates, hanjinProvider } = makeService([[{ ...hanjinInvoiceRow, status: 'voided' }]]);

      await service.cancelInvoice('inv-1');

      expect(hanjinProvider.cancelInvoice).not.toHaveBeenCalled();
      expect(updates.length).toBe(0);
    });

    it('goodsflow invoice void 호환 유지', async () => {
      const { service, goodsflowProvider } = makeService([
        [{ ...hanjinInvoiceRow, issueMethod: 'goodsflow', externalServiceId: 'GF-SVC-001' }],
        [{ status: 'issued', shipmentId: null }],
      ]);

      await service.cancelInvoice('inv-1');

      expect(goodsflowProvider.cancelInvoice).toHaveBeenCalledWith('GF-SVC-001');
    });
  });

  describe('trackInvoice', () => {
    it('hanjin invoice 추적: hanjin provider 위임', async () => {
      const { service, hanjinProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'hanjin', externalServiceId: 'HJ-SVC-001' }],
      ]);

      const tracking = await service.trackInvoice('inv-1');

      expect(hanjinProvider.trackDelivery).toHaveBeenCalledWith('HJ-SVC-001');
      expect(tracking.status).toBe('in_transit');
    });

    it('goodsflow invoice 추적 호환 유지', async () => {
      const { service, goodsflowProvider } = makeService([
        [{ id: 'inv-1', issueMethod: 'goodsflow', externalServiceId: 'GF-SVC-001' }],
      ]);

      await service.trackInvoice('inv-1');

      expect(goodsflowProvider.trackDelivery).toHaveBeenCalledWith('GF-SVC-001');
    });

    it('direct/self invoice 는 추적 불가 (BadRequestException)', async () => {
      const { service } = makeService([[{ id: 'inv-1', issueMethod: 'direct', externalServiceId: null }]]);

      await expect(service.trackInvoice('inv-1')).rejects.toThrow(BadRequestException);
    });
  });
});
