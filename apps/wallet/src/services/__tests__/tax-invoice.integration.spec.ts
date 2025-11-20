import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { getTsid } from 'tsid-ts';

// 테스트 대상 모듈 및 서비스

import { TaxInvoiceService } from '../tax/tax-invoice.service';
import { TaxInvoiceAdminService } from '../tax/tax-invoice-admin.service';
import { TaxInvoicePreferenceService } from '../tax/tax-invoice-preference.service';
import { OmsClientMock } from '../tax/oms-client.mock';

import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { TaxInvoiceReader } from '../tax/tax-invoice.reader';
import { TaxInvoiceCreator } from '../tax/tax-invoice.creator';
import { TaxInvoiceManager } from '../tax/tax-invoice.manager';
import { TaxInvoiceRepository } from '../tax/tax-invoice.repository';
describe('세금계산서 통합 테스트 - 전체 플로우', () => {
  let module: TestingModule;
  let dbService: DbService<typeof walletSchema>;

  let taxInvoiceService: TaxInvoiceService;
  let adminService: TaxInvoiceAdminService;
  let preferenceService: TaxInvoicePreferenceService;
  let omsClient: OmsClientMock;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: walletSchema,
        }),
      ],
      providers: [
        TaxInvoiceService,
        TaxInvoiceAdminService,
        TaxInvoicePreferenceService,
        TaxInvoiceReader,
        TaxInvoiceCreator,
        TaxInvoiceManager,
        TaxInvoiceRepository,
        OmsClientMock,
      ],
    }).compile();

    dbService = module.get<DbService<typeof walletSchema>>(DbService);
    taxInvoiceService = module.get<TaxInvoiceService>(TaxInvoiceService);
    adminService = module.get<TaxInvoiceAdminService>(TaxInvoiceAdminService);
    preferenceService = module.get<TaxInvoicePreferenceService>(
      TaxInvoicePreferenceService,
    );
    omsClient = module.get<OmsClientMock>('OMS_CLIENT');
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('🎯 세금계산서 전체 플로우 테스트', () => {
    it('🎯 [성공] 세금계산서 신청 → 엑셀 내보내기 → 발행 완료까지의 전체 흐름', async () => {
      // =======================================================
      // 1. Given (주어진 상황)
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: '테스트 주식회사',
        businessNumber: '123-45-67890',
        address: '서울시 강남구 테스트로 123',
        ownerName: '김대표',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-001',
        userId,
        amount: 110000, // 10만원 + 부가세
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // =======================================================
      // 2. When (행동) - 단계별 플로우 실행
      // =======================================================

      // 🔹 Step 1: 세금계산서 신청
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      expect(invoice).toBeDefined();
      expect(invoice.status).toBe('REQUESTED');
      expect(invoice.userId).toBe(userId);
      expect(invoice.orderId).toBe(orderId);
      expect(invoice.businessName).toBe(businessInfo.name);

      // 🔹 Step 2: 발행 대기 목록 조회
      const requestedList = await adminService.getRequested(10, 0);
      expect(requestedList.length).toBeGreaterThan(0);
      expect(requestedList[0].id).toBe(invoice.id);

      // 🔹 Step 3: 엑셀 내보내기 처리
      const exportResult = await adminService.markExported(
        [invoice.id],
        operatorId,
      );

      expect(exportResult.success).toContain(invoice.id);
      expect(exportResult.failed).toHaveLength(0);
      expect(exportResult.batchId).toBeDefined();

      // 🔹 Step 4: 상태 확인 (EXPORTED)
      const exportedInvoice = await adminService.getInvoiceById(invoice.id);
      expect(exportedInvoice?.status).toBe('EXPORTED');
      expect(exportedInvoice?.exportedBy).toBe(operatorId);
      expect(exportedInvoice?.exportedAt).toBeDefined();

      // 🔹 Step 5: 발행 완료 처리
      const hometaxIssueNo = `HT${Date.now()}`;
      const hometaxIssueDate = '2025-01-15';

      await adminService.confirmIssued(
        invoice.id,
        hometaxIssueNo,
        hometaxIssueDate,
        operatorId,
      );

      // =======================================================
      // 3. Then (결과 검증)
      // =======================================================

      // 🔍 최종 상태 확인
      const finalInvoice = await adminService.getInvoiceById(invoice.id);
      expect(finalInvoice?.status).toBe('ISSUED_CONFIRMED');
      expect(finalInvoice?.hometaxIssueNo).toBe(hometaxIssueNo);
      expect(finalInvoice?.hometaxIssueDate).toBe(hometaxIssueDate);

      // 🔍 스냅샷 확인
      const invoiceWithSnapshot =
        await taxInvoiceService.getInvoiceWithSnapshot(invoice.id);
      expect(invoiceWithSnapshot).toBeDefined();
      expect(invoiceWithSnapshot?.snapshot).toBeDefined();
      expect(invoiceWithSnapshot?.snapshot?.payload).toBeDefined();

      // 🔍 이벤트 로그 확인
      const invoiceWithEvents = await taxInvoiceService.getInvoiceWithEvents(
        invoice.id,
      );
      expect(invoiceWithEvents).toBeDefined();
      expect(invoiceWithEvents?.events).toBeDefined();
      expect(invoiceWithEvents!.events.length).toBeGreaterThan(0);

      // 최소 3개의 이벤트 확인: REQUESTED, EXPORTED, ISSUED
      const eventTypes = invoiceWithEvents!.events.map((e) => e.eventType);
      expect(eventTypes).toContain('TAX_INVOICE_REQUESTED');
      expect(eventTypes).toContain('TAX_INVOICE_EXPORTED');
      expect(eventTypes).toContain('TAX_INVOICE_ISSUED');
    }, 15000);

    it('🎯 [성공] 기본 설정 저장 후 세금계산서 신청 (사업자 정보 자동 적용)', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;

      const businessInfo = {
        name: '자동설정 주식회사',
        businessNumber: '987-65-43210',
        address: '서울시 서초구 자동로 456',
        ownerName: '박사장',
      };

      // 🔹 Step 1: 기본 설정 저장
      await preferenceService.updatePreference(
        userId,
        true, // defaultEnabled
        businessInfo,
      );

      // 🔹 Step 2: 기본 설정 조회 확인
      const savedPreference = await preferenceService.getPreference(userId);
      expect(savedPreference).toBeDefined();
      expect(savedPreference?.defaultEnabled).toBe(1); // DB에 integer로 저장됨
      expect(savedPreference?.defaultBusinessInfo).toBeDefined();

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-002',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // =======================================================
      // 2. When
      // =======================================================

      // 🔹 Step 3: 세금계산서 신청 (사업자 정보 없이)
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        // businessInfo 없음 - preference에서 자동으로 가져와야 함
      });

      // =======================================================
      // 3. Then
      // =======================================================
      expect(invoice).toBeDefined();
      expect(invoice.businessName).toBe(businessInfo.name);
      expect(invoice.businessNumber).toBe(businessInfo.businessNumber);
      expect(invoice.businessAddress).toBe(businessInfo.address);
      expect(invoice.businessOwnerName).toBe(businessInfo.ownerName);
    }, 15000);

    it('🎯 [실패] 중복 주문에 대한 세금계산서 신청 실패', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;

      const businessInfo = {
        name: '중복테스트 주식회사',
        businessNumber: '111-22-33444',
        address: '서울시 중복구 테스트로 789',
        ownerName: '이대표',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-003',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // 첫 번째 신청
      const firstInvoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      expect(firstInvoice).toBeDefined();

      // =======================================================
      // 2. When & Then
      // =======================================================

      // 같은 주문에 대한 중복 신청 시도
      await expect(
        taxInvoiceService.createIntent(userId, {
          orderId,
          businessInfo,
        }),
      ).rejects.toThrow('이미 처리 중인 세금계산서가 있습니다');
    }, 15000);

    it('🎯 [실패] 잘못된 상태에서 발행 완료 처리 실패', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: '상태오류 주식회사',
        businessNumber: '555-66-77888',
        address: '서울시 오류구 상태로 999',
        ownerName: '최대표',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-004',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // 세금계산서 신청 (REQUESTED 상태)
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      // =======================================================
      // 2. When & Then
      // =======================================================

      // EXPORTED 상태가 아닌데 발행 완료 처리 시도
      const hometaxIssueNo = `HT${Date.now()}`;
      const hometaxIssueDate = '2025-01-15';

      await expect(
        adminService.confirmIssued(
          invoice.id,
          hometaxIssueNo,
          hometaxIssueDate,
          operatorId,
        ),
      ).rejects.toThrow();

      // 상태가 변경되지 않았는지 확인
      const unchangedInvoice = await adminService.getInvoiceById(invoice.id);
      expect(unchangedInvoice?.status).toBe('REQUESTED');
    }, 15000);

    it('🎯 [성공] 여러 세금계산서 일괄 내보내기', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: '일괄처리 주식회사',
        businessNumber: '888-99-00111',
        address: '서울시 일괄구 처리로 321',
        ownerName: '정대표',
      };

      const orderId1 = `order_${getTsid().toString()}`;
      const orderId2 = `order_${getTsid().toString()}`;
      const orderId3 = `order_${getTsid().toString()}`;

      // OMS에 Mock 주문 데이터 추가
      [orderId1, orderId2, orderId3].forEach((id, index) => {
        omsClient.addMockOrder({
          orderId: id,
          orderNumber: `ORD-TEST-005-${index + 1}`,
          userId,
          amount: 110000,
          status: 'DELIVERED',
          completedAt: new Date('2025-01-15'),
          createdAt: new Date('2025-01-10'),
          updatedAt: new Date('2025-01-15'),
        });
      });

      // 3개의 세금계산서 신청
      const invoice1 = await taxInvoiceService.createIntent(userId, {
        orderId: orderId1,
        businessInfo,
      });

      const invoice2 = await taxInvoiceService.createIntent(userId, {
        orderId: orderId2,
        businessInfo,
      });

      const invoice3 = await taxInvoiceService.createIntent(userId, {
        orderId: orderId3,
        businessInfo,
      });

      // =======================================================
      // 2. When
      // =======================================================

      // 일괄 내보내기
      const exportResult = await adminService.markExported(
        [invoice1.id, invoice2.id, invoice3.id],
        operatorId,
      );

      // =======================================================
      // 3. Then
      // =======================================================
      expect(exportResult.success).toHaveLength(3);
      expect(exportResult.failed).toHaveLength(0);
      expect(exportResult.batchId).toBeDefined();

      // 모든 세금계산서가 EXPORTED 상태인지 확인
      const exported1 = await adminService.getInvoiceById(invoice1.id);
      const exported2 = await adminService.getInvoiceById(invoice2.id);
      const exported3 = await adminService.getInvoiceById(invoice3.id);

      expect(exported1?.status).toBe('EXPORTED');
      expect(exported2?.status).toBe('EXPORTED');
      expect(exported3?.status).toBe('EXPORTED');
    }, 15000);

    it('🎯 [성공] 발행 실패 처리', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: '실패테스트 주식회사',
        businessNumber: '222-33-44555',
        address: '서울시 실패구 테스트로 654',
        ownerName: '강대표',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-006',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // 세금계산서 신청 및 내보내기
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      await adminService.markExported([invoice.id], operatorId);

      // =======================================================
      // 2. When
      // =======================================================

      // 발행 실패 처리
      const failReason = '사업자등록번호 오류';
      const errorCode = 'BUSINESS_NUMBER_INVALID';

      await adminService.markFailed(
        invoice.id,
        failReason,
        errorCode,
        operatorId,
      );

      // =======================================================
      // 3. Then
      // =======================================================
      const failedInvoice = await adminService.getInvoiceById(invoice.id);
      expect(failedInvoice?.status).toBe('FAILED');
      expect(failedInvoice?.failReason).toBe(failReason);
      expect(failedInvoice?.errorCode).toBe(errorCode);
    }, 15000);

    it('🎯 [성공] 취소 처리', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: '취소테스트 주식회사',
        businessNumber: '333-44-55666',
        address: '서울시 취소구 테스트로 987',
        ownerName: '송대표',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-007',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // 세금계산서 신청
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      // =======================================================
      // 2. When
      // =======================================================

      // 취소 처리
      const cancelReason = '고객 요청';

      await adminService.cancel(invoice.id, cancelReason, operatorId);

      // =======================================================
      // 3. Then
      // =======================================================
      const cancelledInvoice = await adminService.getInvoiceById(invoice.id);
      expect(cancelledInvoice?.status).toBe('CANCELLED');
      expect(cancelledInvoice?.cancelReason).toBe(cancelReason);
    }, 15000);

    it('🎯 [성공] 홈택스 엑셀 Export 데이터 조회', async () => {
      // =======================================================
      // 1. Given
      // =======================================================
      const userId = `user_${getTsid().toString()}`;
      const orderId = `order_${getTsid().toString()}`;
      const operatorId = `admin_${getTsid().toString()}`;

      const businessInfo = {
        name: 'Export테스트 주식회사',
        businessNumber: '444-55-66777',
        address: '서울시 Export구 테스트로 111',
        ownerName: '윤대표',
        businessType: '제조업',
        businessItem: '화장품',
        email: 'test@example.com',
      };

      // OMS에 Mock 주문 데이터 추가
      omsClient.addMockOrder({
        orderId,
        orderNumber: 'ORD-TEST-008',
        userId,
        amount: 110000,
        status: 'DELIVERED',
        completedAt: new Date('2025-01-15'),
        items: [
          {
            itemId: 'item_001',
            itemName: '테스트 상품 A',
            specification: '규격 A',
            quantity: 2,
            unitPrice: 50000,
            totalPrice: 100000,
          },
        ],
        paymentMethod: 'CARD',
        memo: 'Export 테스트 주문',
        createdAt: new Date('2025-01-10'),
        updatedAt: new Date('2025-01-15'),
      });

      // 세금계산서 신청
      const invoice = await taxInvoiceService.createIntent(userId, {
        orderId,
        businessInfo,
      });

      // 엑셀 내보내기 처리 (EXPORTED 상태로 변경)
      await adminService.markExported([invoice.id], operatorId);

      // =======================================================
      // 2. When
      // =======================================================

      // Export 데이터 조회
      const exportData = await adminService.getExportCandidates({
        status: 'EXPORTED',
      });

      // =======================================================
      // 3. Then
      // =======================================================
      expect(exportData).toBeDefined();
      expect(exportData.length).toBeGreaterThan(0);

      const exportRow = exportData.find(
        (row) => row.taxInvoiceId === invoice.id,
      );
      expect(exportRow).toBeDefined();

      // 공급자 정보 확인 (SUPPLIER_PROFILE 상수)
      expect(exportRow?.supplierBusinessNumber).toBe('123-45-67890');
      expect(exportRow?.supplierName).toBe('알몬드영 주식회사');
      expect(exportRow?.supplierOwnerName).toBe('홍길동');

      // 공급받는자 정보 확인
      expect(exportRow?.buyerBusinessNumber).toBe(businessInfo.businessNumber);
      expect(exportRow?.buyerName).toBe(businessInfo.name);
      expect(exportRow?.buyerOwnerName).toBe(businessInfo.ownerName);
      expect(exportRow?.buyerBusinessType).toBe(businessInfo.businessType);
      expect(exportRow?.buyerBusinessItem).toBe(businessInfo.businessItem);
      expect(exportRow?.buyerEmail).toBe(businessInfo.email);

      // 거래 정보 확인
      expect(exportRow?.supplyAmount).toBe(100000);
      expect(exportRow?.taxAmount).toBe(10000);
      expect(exportRow?.totalAmount).toBe(110000);

      // 품목 요약 확인
      expect(exportRow?.productSummary).toContain('테스트 상품 A');

      // 결제수단 확인
      expect(exportRow?.paymentMethod).toBe('신용카드');

      // 비고 확인
      expect(exportRow?.remark).toBe('Export 테스트 주문');
    }, 15000);
  });

  /**
   * DB 청소 헬퍼 함수
   */
  async function cleanupDatabase() {
    try {
      // 외래키 제약 때문에 자식부터 삭제
      await dbService.db.delete(schema.taxInvoiceEvents);
      await dbService.db.delete(schema.taxInvoiceSnapshots);
      await dbService.db.delete(schema.taxInvoices);
      await dbService.db.delete(schema.userTaxInvoicePreferences);
    } catch (error) {
      console.warn('청소 중 에러 발생 (테스트는 계속):', error);
    }
  }
});
