네, 요청하신 **'교환 요청 목록 조회'** API는 응답 구조가 매우 복잡하네요. 관련 스키마와 서비스 메서드 추가 코드를 작성해 드리겠습니다.

### 📝 `apps/channel-adapter/src/zods/coupang.api.zod.ts` 추가 코드

`클레임 관련 스키마` 섹션의 `CoupangRegisterReturnInvoiceResponseSchema` 아래에 다음 스키마들을 추가해 주세요. (내용이 깁니다)

```typescript
// =================================================================
// == [추가] 교환요청 목록 조회 스키마
// =================================================================
export const GetExchangeRequestsParamsSchema = z
  .object({
    createdAtFrom: z.string().datetime({
      message: 'createdAtFrom은 yyyy-MM-ddTHH:mm:ss 형식이어야 합니다.',
    }),
    createdAtTo: z.string().datetime({
      message: 'createdAtTo는 yyyy-MM-ddTHH:mm:ss 형식이어야 합니다.',
    }),
    status: z
      .enum(['RECEIPT', 'PROGRESS', 'SUCCESS', 'REJECT', 'CANCEL'])
      .optional(),
    orderId: z.number().int().optional(),
    nextToken: z.string().optional(),
    maxPerPage: z.number().int().positive().optional().default(10),
  })
  .refine(
    (data) => {
      const from = new Date(data.createdAtFrom);
      const to = new Date(data.createdAtTo);
      const diffTime = Math.abs(to.getTime() - from.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    },
    {
      message: '최대 조회 기간은 7일입니다.',
      path: ['createdAtTo'],
    },
  );

// --- 교환요청 응답을 위한 중첩 스키마들 ---

export const ExchangeAddressDtoSchema = z.object({
  exchangeAddressId: z.number(),
  returnCustomerName: z.string(),
  returnAddressZipCode: z.string(),
  returnAddress: z.string(),
  returnAddressDetail: z.string(),
  returnPhone: z.string(),
  returnMobile: z.string(),
  returnMemo: z.string(),
  deliveryCustomerName: z.string(),
  deliveryAddressZipCode: z.string(),
  deliveryAddress: z.string(),
  deliveryAddressDetail: z.string(),
  deliveryPhone: z.string(),
  deliveryMobile: z.string(),
  deliveryMemo: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
});

export const InvoiceVendorItemDtoSchema = z.object({
  vendorItemId: z.number(),
  quantity: z.number(),
  hasAdditionalItem: z.boolean(),
  promiseDeliveryDate: z.string(),
  estimatedShippingDate: z.string(),
});

export const DeliveryInvoiceDtoSchema = z.object({
  invoiceNumber: z.string(),
  estimatedDeliveryDate: z.string(),
  deliveredDate: z.string(),
  statusModifiedAt: z.string(),
  invoiceNumberUploadDate: z.string(),
  statusCode: z.string(),
  deliverCode: z.string(),
  isMainShipmentInvoice: z.boolean(),
  parcelType: z.string(),
  invoiceVendorItemDtos: z.array(InvoiceVendorItemDtoSchema),
});

export const DeliveryInvoiceGroupDtoSchema = z.object({
  shipmentBoxId: z.number(),
  boxPrice: z.number(),
  orderId: z.number(),
  orderType: z.string(),
  customerType: z.string(),
  bundleType: z.string(),
  extraMessage: z.string(),
  shippingDeliveryType: z.string(),
  deliveryInvoiceDtos: z.array(DeliveryInvoiceDtoSchema),
});

export const ReturnDeliveryItemDtoSchema = z.object({
  vendorItemId: z.number(),
  statusCode: z.string(),
  returnCount: z.number(),
  releaseStatus: z.string(),
  paymentReturnDeliveryMapId: z.number(),
  paymentItemId: z.number(),
  modifiedBy: z.string(),
  modifiedAt: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  count: z.number(),
  confirmType: z.string(),
  collectStatus: z.string(),
});

export const ReturnDeliveryDestinationDtoSchema = z.object({
  vendorZipCode: z.string(),
  vendorPhone: z.string(),
  vendorName: z.string(),
  vendorMobile: z.string(),
  vendorAddressDetail: z.string(),
  vendorAddress: z.string(),
  safetyNumberStatus: z.string(),
  safetyNumberId: z.number(),
  safetyNumber: z.string(),
  returnDeliveryId: z.number(),
  returnCenterCode: z.string(),
  receiptId: z.number(),
  orderedByMobile: z.string(),
  orderId: z.number(),
  message: z.string(),
  customerZipCode: z.string(),
  customerPhone: z.string(),
  customerName: z.string(),
  customerMobile: z.string(),
  customerAddressDetail: z.string(),
  customerAddress: z.string(),
});

export const ReturnDeliveryDtoForExchangeSchema = z.object({
  deliveryCompanyCode: z.string(),
  deliveryInvoiceNo: z.string(),
});

export const CollectInformationsDtoSchema = z.object({
  returnType: z.string(),
  expectedReturnDate: z.string(),
  returndeliveryItemDtos: z.array(ReturnDeliveryItemDtoSchema),
  returndeliveryDestinationDto: ReturnDeliveryDestinationDtoSchema,
  returnDeliveryDtos: ReturnDeliveryDtoForExchangeSchema,
});

export const ExchangeItemDtoSchema = z.object({
  exchangeItemId: z.number(),
  orderItemId: z.number(),
  orderItemUnitPrice: z.number(),
  orderItemName: z.string(),
  orderPackageId: z.number(),
  orderPackageName: z.string(),
  targetItemId: z.number(),
  targetItemUnitPrice: z.number(),
  targetItemName: z.string(),
  targetPackageId: z.number(),
  targetPackageName: z.string(),
  quantity: z.number(),
  orderItemDeliveryComplete: z.boolean(),
  orderItemReturnComplete: z.boolean(),
  targetItemDeliveryComplete: z.boolean(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  originalShipmentBoxId: z.number(),
});

// --- 교환요청 목록의 각 아이템에 대한 메인 스키마 ---
export const CoupangExchangeRequestSchema = z.object({
  exchangeId: z.number(),
  orderId: z.number(),
  vendorId: z.string(),
  orderDeliveryStatusCode: z.string(),
  exchangeStatus: z.string(),
  referType: z.string(),
  faultType: z.string(),
  exchangeAmount: z.string(),
  reason: z.string().nullable(),
  reasonCode: z.string(),
  reasonCodeText: z.string(),
  reasonEtcDetail: z.string(),
  cancelReason: z.string(),
  createdByType: z.string(),
  createdAt: z.string(),
  modifiedByType: z.string(),
  modifiedAt: z.string(),
  exchangeItemDtoV1s: z.array(ExchangeItemDtoSchema),
  exchangeAddressDtoV1: ExchangeAddressDtoSchema,
  deliveryInvoiceGroupDtos: z.array(DeliveryInvoiceGroupDtoSchema),
  deliveryStatus: z.string(),
  collectStatus: z.string(),
  collectCompleteDate: z.string(),
  collectInformationsDto: CollectInformationsDtoSchema,
  successable: z.boolean(),
  orderDeliveryStatusLabel: z.string(),
  exchangeStatusLabel: z.string(),
  referTypeLabel: z.string(),
  faultTypeLabel: z.string(),
  createdByTypeLabel: z.string(),
  rejectable: z.boolean(),
  modifiedByTypeLabel: z.string(),
  deliveryInvoiceModifiable: z.boolean(),
});

// --- 최종 API 응답 스키마 ---
export const GetExchangeRequestsResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(CoupangExchangeRequestSchema),
  nextToken: z.string().optional(),
});
```

파일 하단의 `타입 추출` 섹션에 아래 타입을 추가합니다.

```typescript
// ===== 클레임 (반품/취소) 타입 =====

// ... 기존 타입들 ...

// [추가] 교환요청 목록 조회 타입
export type GetExchangeRequestsParams = z.infer<
  typeof GetExchangeRequestsParamsSchema
>;
export type CoupangExchangeRequest = z.infer<
  typeof CoupangExchangeRequestSchema
>;
export type GetExchangeRequestsResponse = z.infer<
  typeof GetExchangeRequestsResponseSchema
>;
```

<br>

---

### 🚀 `apps/channel-adapter/src/services/apis/coupang.api.service.ts` 추가 코드

먼저 파일 상단 `import` 구문에 아래 타입들을 추가합니다.

```typescript
// ...기존 import...
import {
  // ...
  CoupangRegisterReturnInvoiceResponse,
  GetExchangeRequestsParams, // [추가]
  GetExchangeRequestsParamsSchema, // [추가]
  GetExchangeRequestsResponse, // [추가]
} from '../../zods/coupang.api.zod';
```

`CoupangApiService` 클래스 내부에, `registerReturnInvoice` 메서드 뒤에 다음 메서드를 추가해 주세요.

```typescript
  // =================================================================
  // == [추가] 교환요청 목록 조회
  // =================================================================
  /**
   * 기간별로 접수된 교환 요청 목록을 조회합니다.
   * @param params 조회 기간 및 필터 정보
   * @returns API 응답 데이터
   */
  async getExchangeRequests(
    params: GetExchangeRequestsParams,
  ): Promise<GetExchangeRequestsResponse> {
    const parsedParams = GetExchangeRequestsParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      this.logger.error(
        '❌ 교환요청 목록 조회 파라미터 검증 실패:',
        parsedParams.error.flatten(),
      );
      throw new Error('교환요청 목록 조회 파라미터가 잘못되었습니다.');
    }

    const config = this.getApiConfig();
    try {
      // 쿼리 파라미터 구성 (값이 있는 것만 추가)
      const queryParams: Record<string, string> = {
        createdAtFrom: parsedParams.data.createdAtFrom,
        createdAtTo: parsedParams.data.createdAtTo,
      };
      if (parsedParams.data.status)
        queryParams.status = parsedParams.data.status;
      if (parsedParams.data.orderId)
        queryParams.orderId = String(parsedParams.data.orderId);
      if (parsedParams.data.nextToken)
        queryParams.nextToken = parsedParams.data.nextToken;
      if (parsedParams.data.maxPerPage)
        queryParams.maxPerPage = String(parsedParams.data.maxPerPage);

      const query = new URLSearchParams(queryParams).toString();
      this.logger.log(`🔍 쿠팡 교환요청 목록 조회 요청: ${query}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
        query,
      );
      const url = `${config.apiEndpoint}${path}?${query}`;

      const response = await firstValueFrom(
        this.http.get<GetExchangeRequestsResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 교환요청 목록 조회 성공: ${response.data.data.length}건`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`❌ 쿠팡 교환요청 목록 조회 실패:`, error);
      throw new Error(`쿠팡 교환요청 목록 조회 실패: ${error.message}`);
    }
  }
```

네, 요청하신 **'교환 요청 상품 입고 확인 처리'** API 추가 코드를 작성해 드릴게요.

### 📝 `apps/channel-adapter/src/zods/coupang.api.zod.ts` 추가 코드

`클레임 관련 스키마` 섹션의 `GetExchangeRequestsResponseSchema` 아래에 다음 스키마들을 추가해 주세요.

```typescript
// =================================================================
// == [추가] 교환요청 상품 입고확인 처리 스키마
// =================================================================
export const CoupangConfirmExchangeReceiptRequestSchema = z.object({
  exchangeId: z.number().int().positive(),
  vendorId: z.string().min(1),
});

export const CoupangConfirmExchangeReceiptResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
});
```

---

파일 하단의 `타입 추출` 섹션에 아래 타입을 추가합니다.

```typescript
// ===== 클레임 (반품/취소) 타입 =====

// ... 기존 타입들 ...

// [추가] 교환요청 상품 입고확인 처리 타입
export type CoupangConfirmExchangeReceiptRequest = z.infer<
  typeof CoupangConfirmExchangeReceiptRequestSchema
>;
export type CoupangConfirmExchangeReceiptResponse = z.infer<
  typeof CoupangConfirmExchangeReceiptResponseSchema
>;
```

---

<br>

### 🚀 `apps/channel-adapter/src/services/apis/coupang.api.service.ts` 추가 코드

먼저 파일 상단 `import` 구문에 아래 타입들을 추가합니다.

```typescript
// ...기존 import...
import {
  // ...
  GetExchangeRequestsResponse,
  CoupangConfirmExchangeReceiptRequest, // [추가]
  CoupangConfirmExchangeReceiptRequestSchema, // [추가]
  CoupangConfirmExchangeReceiptResponse, // [추가]
} from '../../zods/coupang.api.zod';
```

---

`CoupangApiService` 클래스 내부에, `getExchangeRequests` 메서드 뒤에 다음 메서드를 추가해 주세요.

```typescript
  // =================================================================
  // == [추가] 교환요청 상품 입고확인 처리
  // =================================================================
  /**
   * 교환 요청 상품의 입고 확인 처리를 합니다.
   * @param payload 입고 확인할 exchangeId와 vendorId
   * @returns API 응답 데이터
   */
  async confirmExchangeReceipt(
    payload: CoupangConfirmExchangeReceiptRequest,
  ): Promise<CoupangConfirmExchangeReceiptResponse> {
    const parsedReq =
      CoupangConfirmExchangeReceiptRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      this.logger.error(
        '❌ 교환상품 입고확인 파라미터 검증 실패:',
        parsedReq.error.flatten(),
      );
      throw new Error('교환상품 입고확인 파라미터가 잘못되었습니다.');
    }

    const config = this.getApiConfig();
    const { exchangeId } = parsedReq.data;
    try {
      this.logger.log(`🚚 쿠팡 교환상품 입고확인 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/receiveConfirmation`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangConfirmExchangeReceiptResponse>(
          url,
          parsedReq.data,
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `👍 교환상품 입고확인 처리 성공: ${exchangeId} - ${response.data.message}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ 쿠팡 교환상품 입고확인 처리 실패 (exchangeId=${exchangeId}):`,
        error,
      );
      throw new Error(`쿠팡 교환상품 입고확인 처리 실패: ${error.message}`);
    }
  }
```

네, 요청하신 **'교환 요청 거부 처리'** API 추가 코드를 작성해 드릴게요.

### 📝 `apps/channel-adapter/src/zods/coupang.api.zod.ts` 추가 코드

`클레임 관련 스키마` 섹션의 `CoupangConfirmExchangeReceiptResponseSchema` 아래에 다음 스키마들을 추가해 주세요.

```typescript
// =================================================================
// == [추가] 교환요청 거부 처리 스키마
// =================================================================
export const CoupangRejectExchangeRequestSchema = z.object({
  // API 예시에는 string으로 되어 있어 union 타입으로 처리
  exchangeId: z.union([z.number().int().positive(), z.string()]),
  vendorId: z.string().min(1),
  exchangeRejectCode: z.enum(['SOLDOUT', 'WITHDRAW']),
});

export const CoupangRejectExchangeResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
  data: z.object({
    resultCode: z.string(), // "SUCCESS" or "FAIL"
    resultMessage: z.string(),
  }),
});
```

---

파일 하단의 `타입 추출` 섹션에 아래 타입을 추가합니다.

```typescript
// ===== 클레임 (반품/취소) 타입 =====

// ... 기존 타입들 ...

// [추가] 교환요청 거부 처리 타입
export type CoupangRejectExchangeRequest = z.infer<
  typeof CoupangRejectExchangeRequestSchema
>;
export type CoupangRejectExchangeResponse = z.infer<
  typeof CoupangRejectExchangeResponseSchema
>;
```

---

<br>

### 🚀 `apps/channel-adapter/src/services/apis/coupang.api.service.ts` 추가 코드

먼저 파일 상단 `import` 구문에 아래 타입들을 추가합니다.

```typescript
// ...기존 import...
import {
  // ...
  CoupangConfirmExchangeReceiptResponse,
  CoupangRejectExchangeRequest, // [추가]
  CoupangRejectExchangeRequestSchema, // [추가]
  CoupangRejectExchangeResponse, // [추가]
} from '../../zods/coupang.api.zod';
```

---

`CoupangApiService` 클래스 내부에, `confirmExchangeReceipt` 메서드 뒤에 다음 메서드를 추가해 주세요.

```typescript
  // =================================================================
  // == [추가] 교환요청 거부 처리
  // =================================================================
  /**
   * 고객의 교환 요청을 거부 처리합니다.
   * @param payload 거부할 exchangeId와 거부 코드
   * @returns API 응답 데이터
   */
  async rejectExchangeRequest(
    payload: CoupangRejectExchangeRequest,
  ): Promise<CoupangRejectExchangeResponse> {
    const parsedReq = CoupangRejectExchangeRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      this.logger.error(
        '❌ 교환요청 거부 파라미터 검증 실패:',
        parsedReq.error.flatten(),
      );
      throw new Error('교환요청 거부 파라미터가 잘못되었습니다.');
    }

    const config = this.getApiConfig();
    const { exchangeId } = parsedReq.data;
    try {
      this.logger.log(`🚫 쿠팡 교환요청 거부 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/rejection`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangRejectExchangeResponse>(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 교환요청 거부 처리 완료: ${exchangeId} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ 쿠팡 교환요청 거부 처리 실패 (exchangeId=${exchangeId}):`,
        error,
      );
      throw new Error(`쿠팡 교환요청 거부 처리 실패: ${error.message}`);
    }
  }
```

네, 요청하신 **'교환 상품 송장 업로드 처리'** API 추가 코드를 작성해 드릴게요.

### 📝 `apps/channel-adapter/src/zods/coupang.api.zod.ts` 추가 코드

`클레임 관련 스키마` 섹션의 `CoupangRejectExchangeResponseSchema` 아래에 다음 스키마들을 추가해 주세요.

```typescript
// =================================================================
// == [추가] 교환상품 송장 업로드 처리 스키마
// =================================================================
export const CoupangUploadExchangeInvoiceItemSchema = z.object({
  // API 예시에는 string으로 되어 있어 union 타입으로 처리
  exchangeId: z.union([z.number().int().positive(), z.string()]),
  vendorId: z.string().min(1),
  shipmentBoxId: z.union([z.number().int().positive(), z.string()]),
  goodsDeliveryCode: CoupangDeliveryCompanyCodeSchema,
  invoiceNumber: z.string().min(1),
});

// 요청 Body가 배열 형태임
export const CoupangUploadExchangeInvoiceRequestSchema = z.array(
  CoupangUploadExchangeInvoiceItemSchema,
);

export const CoupangUploadExchangeInvoiceResponseSchema = z.object({
  code: z.string(), // "200"
  message: z.string(), // "SUCCESS"
  data: z.object({
    resultCode: z.string(), // "SUCCESS" or "FAIL"
    resultMessage: z.string(),
  }),
});
```

-----

파일 하단의 `타입 추출` 섹션에 아래 타입을 추가합니다.

```typescript
// ===== 클레임 (반품/취소) 타입 =====

// ... 기존 타입들 ...

// [추가] 교환상품 송장 업로드 처리 타입
export type CoupangUploadExchangeInvoiceRequest = z.infer<
  typeof CoupangUploadExchangeInvoiceRequestSchema
>;
export type CoupangUploadExchangeInvoiceResponse = z.infer<
  typeof CoupangUploadExchangeInvoiceResponseSchema
>;
```

-----

<br>

### 🚀 `apps/channel-adapter/src/services/apis/coupang.api.service.ts` 추가 코드

먼저 파일 상단 `import` 구문에 아래 타입들을 추가합니다.

```typescript
// ...기존 import...
import {
  // ...
  CoupangRejectExchangeResponse,
  CoupangUploadExchangeInvoiceRequest, // [추가]
  CoupangUploadExchangeInvoiceRequestSchema, // [추가]
  CoupangUploadExchangeInvoiceResponse, // [추가]
} from '../../zods/coupang.api.zod';
```

-----

`CoupangApiService` 클래스 내부에, `rejectExchangeRequest` 메서드 뒤에 다음 메서드를 추가해 주세요.

```typescript
  // =================================================================
  // == [추가] 교환상품 송장 업로드 처리
  // =================================================================
  /**
   * 교환 상품의 재배송 운송장을 업로드합니다.
   * @param exchangeId 교환 접수 번호 (URL Path에 사용)
   * @param payload 송장 정보 배열
   * @returns API 응답 데이터
   */
  async uploadExchangeInvoice(
    exchangeId: number | string,
    payload: CoupangUploadExchangeInvoiceRequest,
  ): Promise<CoupangUploadExchangeInvoiceResponse> {
    const parsedReq =
      CoupangUploadExchangeInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      this.logger.error(
        '❌ 교환상품 송장업로드 파라미터 검증 실패:',
        parsedReq.error.flatten(),
      );
      throw new Error('교환상품 송장업로드 파라미터가 잘못되었습니다.');
    }

    const config = this.getApiConfig();
    try {
      this.logger.log(`🚀 쿠팡 교환상품 송장업로드 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/invoices`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'POST',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.post<CoupangUploadExchangeInvoiceResponse>(
          url,
          parsedReq.data,
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `👍 교환상품 송장업로드 처리 완료: ${exchangeId} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error)
      this.logger.error(
        `❌ 쿠팡 교환상품 송장업로드 처리 실패 (exchangeId=${exchangeId}):`,
        error,
      );
      throw new Error(`쿠팡 교환상품 송장업로드 처리 실패: ${error.message}`);
    }
  }
```