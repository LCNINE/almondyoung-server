# Platform Open API (v1.0)

Platform API Docs

**Base URL:** `https://test-api.goodsflow.io:443/`

**Meta**

- Terms of Service: https://www.goodsflow.io
- Contact: goodsFLOW <tm.platform@goodsflow.com> https://www.goodsflow.io

## Tags

| Name | Description |
|---|---|
| `OP_9999_Hidden` | Deprecated User Api Contract Controller |

## Endpoints Overview

| Method | Path | Summary | Tags |
|---|---|---|---|
| `GET` | `/api/centers` | 출고지 목록 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `POST` | `/api/centers` | 출고지 정보 등록 | OP_600_출고지관리, OP_9999_Hidden |
| `GET` | `/api/centers/default` | 기본 출고지 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `GET` | `/api/centers/seller/{sellerCodeCommaList}` | 출고지 정보 조회 - 판매자 코드(sellerCode) 기반으로 출고지 정보 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `GET` | `/api/centers/{centerCode}` | 출고지 정보 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `PUT` | `/api/centers/{centerCode}` | 출고지 정보 수정 | OP_600_출고지관리, OP_9999_Hidden |
| `DELETE` | `/api/centers/{centerCode}` | 출고지 삭제 - 출고지코드로 출고지 삭제 | OP_600_출고지관리, OP_9999_Hidden |
| `GET` | `/api/centers/{centerCode}/contracts` | 출고지 정보(계약 포함) 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `GET` | `/api/contracts` | 계약 정보 조회 - 회원사에 속해있는 모든 계약 정보 조회 | OP_700_계약관리, OP_9999_Hidden |
| `POST` | `/api/contracts` | 계약 생성 요청(출고지 동시 생성) | OP_700_계약관리, OP_9999_Hidden |
| `GET` | `/api/contracts/center/{centerCodeCommaList}` | 계약 정보 조회 - 출고지 코드(centerCode) 기반으로 계약 정보 조회 | OP_700_계약관리, OP_9999_Hidden |
| `POST` | `/api/contracts/center/{centerCode}` | 계약 생성 요청 | OP_700_계약관리, OP_9999_Hidden |
| `GET` | `/api/contracts/checkCode/{transporterCode}/{businessNo}/{contractCode}` | 계약관리-계약코드 유효성 확인 | OP_700_계약관리, OP_9999_Hidden |
| `GET` | `/api/contracts/seller/{sellerCodeCommaList}` | 계약 정보 조회 - 판매자 코드(sellerCode) 기반으로 계약 정보 조회 | OP_700_계약관리, OP_9999_Hidden |
| `GET` | `/api/contracts/{contractId}` | 계약 정보 조회 - 계약ID(contractId) 기반으로 계약 정보 조회 | OP_700_계약관리, OP_9999_Hidden |
| `PUT` | `/api/contracts/{contractId}` | 계약 수정 요청 - 계약ID(contractId) 기반으로 계약 수정 | OP_700_계약관리, OP_9999_Hidden |
| `DELETE` | `/api/contracts/{contractId}` | 계약 삭제 - 계약ID로 계약 삭제 | OP_700_계약관리, OP_9999_Hidden |
| `DELETE` | `/api/deliveries/cancel` | 취소(서비스ID) | OP_100_배송추적, OP_200_송장출력, OP_300_반품신청, OP_9999_Hidden |
| `POST` | `/api/deliveries/shipping/print` | 송장출력-송장출력정보 등록 | OP_200_송장출력, OP_9999_Hidden |
| `PUT` | `/api/deliveries/shipping/print-uri` | 송장출력-출력URI생성 | OP_200_송장출력, OP_9999_Hidden |
| `POST` | `/api/deliveries/shipping/print/deliveryItems` | 송장출력-송장출력정보 등록(물품정보분리) | OP_200_송장출력, OP_9999_Hidden |
| `POST` | `/api/deliveries/shipping/return` | 반품신청-반품접수정보 등록 | OP_300_반품신청, OP_9999_Hidden |
| `POST` | `/api/deliveries/shipping/return/deliveryItems` | 반품신청-반품접수정보 등록(물품정보분리) | OP_300_반품신청, OP_9999_Hidden |
| `POST` | `/api/deliveries/tracking` | 운송장번호등록 | OP_100_배송추적, OP_9999_Hidden |
| `GET` | `/api/deliveries/tracking/{id}` | 실시간배송조회(서비스ID) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/deliveries/tracking/{id}/cache` | 배송조회(서비스ID) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/deliveries/tracking/{transporterCode}/{invoiceNo}` | 배송조회(배송사,운송장번호) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `POST` | `/api/deliveries/tracking/{transporterCode}/{invoiceNo}` | 운송장번호등록(단건) | OP_100_배송추적, OP_9999_Hidden |
| `PUT` | `/api/deliveries/uniqueId/change` | 등록된 Unique ID 변경 | OP_100_배송추적, OP_200_송장출력, OP_300_반품신청, OP_9999_Hidden |
| `GET` | `/api/deliveries/validateInvoiceNo/{transporter}/{invoiceNoCommaList}` | 운송장번호유효성체크 | OP_100_배송추적, OP_9999_Hidden |
| `GET` | `/api/deliveries/webhooks` | Webhook 결과 조회(벌크) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/deliveries/webhooks/{id}` | Webhook 결과 조회(특정 서비스ID) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/deliveries/{dateFrom}/{dateTo}/{page}/{pageSize}` | 등록조회(기간별) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/deliveries/{idCommaList}` | 등록조회(서비스ID) | OP_500_배송(결과)조회, OP_9999_Hidden |
| `GET` | `/api/sellers` | 전체 판매자 목록 조회 | OP_600_출고지관리, OP_9999_Hidden |
| `PUT` | `/api/test/changeStatus/{serviceId}/{deliveryStatusString}` | 테스트상태변경 | OP_9998_테스트, OP_9999_Hidden |

## Paths

### GET `/api/centers`

**Summary:** 출고지 목록 조회

**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 목록` | OK |

### POST `/api/centers`

**Summary:** 출고지 정보 등록

출고지 정보 등록
- 출고지는 운송장출력과 반품 접수를 위한 계약의 상위에 존재하는 개념입니다.
- 하나의 출고지에는 여러 택배사 계약이 들어갈 수 있지만, 동일 택배사의 계약이 하나의 출고지에 등록할 수는 없습니다.
- 출고지 상위에는 판매자(seller) 개념이 있으나, 단일 판매자, 단독 쇼핑몰일 경우에는 별도로 seller 관리를 하지 않습니다.
  - 이러한 경우에는 Admin 사이트에서 출고지 및 계약 관리를 하는 게 보다 편리합니다.
- 플랫폼, 종합몰 운영자로써 하위 판매자를 관리하고자 할 경우에만 sellerCode, sellerName 을 등록하면 됩니다.
- `body` :
  - 판매자 정보인 sellerCode, sellerName 외의 값은 모두 필수
  - 🚨 하위 판매자 관리를 하지 않을 경우(기본 판매자일 경우), sellerCode, sellerName 은 null 입력.
  - `sellerCode` : null 입력시 기본 판매자의 출고지로 등록됩니다. 하위 판매자 관리를 하지 않을 경우 입력하지 마십시오.


**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 출고지 생성 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보` | OK |

### GET `/api/centers/default`

**Summary:** 기본 출고지 조회

플랫폼 회원사의 기본 출고지를 조회한다.

**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보` | OK |

### GET `/api/centers/seller/{sellerCodeCommaList}`

**Summary:** 출고지 정보 조회 - 판매자 코드(sellerCode) 기반으로 출고지 정보 조회

판매자 코드(`sellerCode`) 기반으로 출고지 정보를 조회한다.(컴마구분)


**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `sellerCodeCommaList` | `path` | string | ✅ |  |  | 판매자 코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 목록` | OK |

### DELETE `/api/centers/{centerCode}`

**Summary:** 출고지 삭제 - 출고지코드로 출고지 삭제

출고지코드(`centerCode`)로 출고지를 삭제합니다.
- 되도록이면 출고지 수정 API의 출고지 사용여부(`enabled`) 값을 `false` 로 지정하여 출고지를 무효화 하는 방식이 권장 됩니다.
- 삭제된 출고지 정보는 복구할 수 없습니다.
- 삭제가 성공하면, 삭제된 출고지 정보가 Response 됩니다.
- 삭제 대상 출고지 하위에 등록된 계약이 있는 경우 삭제가 불가능합니다.
- 특정 판매자의 출고지가 모두 삭제되고, 해당 판매자가 기본(`default`)판매자가 아닐 경우, 해당 판매자 정보도 삭제됩니다.


**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCode` | `path` | string | ✅ |  |  | 출고지코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보` | OK |

### GET `/api/centers/{centerCode}`

**Summary:** 출고지 정보 조회

출고지 정보 조회 : 출고지 코드(`centerCode`) 기반으로 출고지 정보를 조회한다.

**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCode` | `path` | string | ✅ |  |  | 출고지코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보` | OK |

### PUT `/api/centers/{centerCode}`

**Summary:** 출고지 정보 수정

출고지 정보 수정 : 출고지 코드(centerCode) 기반으로 출고지 정보를 수정합니다.
- `centerCode` : 기존에 등록된 출고지 코드
- `body` :
  - `sellerCode`, `sellerName`
    - 해당 출고지가 기본 판매자에 속할 경우, 코드는 수정되지 않습니다.
    - 해당 출고지가 속한 판매자의 모든 판매자 코드/명이(null이 아닌 경우) 수정됩니다.
    - 기본 판매자는 sellerCode가 수정되지 않습니다.


**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCode` | `path` | string | ✅ |  |  | 출고지코드 |
| `body` | `body` | object | ✅ |  |  | 출고지 수정 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보` | OK |

### GET `/api/centers/{centerCode}/contracts`

**Summary:** 출고지 정보(계약 포함) 조회

출고지 정보(계약 포함) 조회 : 출고지 코드(`centerCode`) 기반으로 출고지 정보를 조회한다.
- 출고지에 해당하는 계약 정보 포함하여 조회

**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCode` | `path` | string | ✅ |  |  | 출고지코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/출고지 정보(계약 목록 포함)` | OK |

### GET `/api/contracts`

**Summary:** 계약 정보 조회 - 회원사에 속해있는 모든 계약 정보 조회

- `status`
  - 계약의 상태
  - `REQUEST` : 접수완료 (계약 정보 승인 대기 중)
  - `PENDING` : 승인심사중 (승인 심사 중)
  - `APPROVED` : 승인완료 (승인 완료)
  - `REFUSED` : 승인불가 (승인 불가)
  - `CANCELED` : 신청취소


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 목록(출고지 정보 포함)` | OK |

### POST `/api/contracts`

**Summary:** 계약 생성 요청(출고지 동시 생성)

계약 생성 요청 : 출고지를 생성하면서 동시에 계약을 생성합니다.
- `center` :
  - 생성하는 계약 정보와 함께 생성할 출고지 정보 등록
  - `sellerCode`, `sellerName` (Optional) : 하위 판매자 관리를 하지 않을 경우 null
  - `sellerCode` 및 `sellerName`을 입력하면 관리하는 하위 판매자를 생성하게 됩니다.
  - `sellerCode`는 중복값을 허용하지 않으며, 소문자로 저장됩니다.
- 정산 기준 : **CREDIT_CALC**(신용), **PREPAID_CALC**(선불)
- 정산 기준에 맞게 사용하고자 하는 박스에 요금 입력 (CREDIT_CALC: creditCost, PREPAID_CALC: prepaidCost 필수 입력)
- 등록 Response 의 **centerCode**를 운송장출력 및 반품신청 호출 시 사용

**박스 규격**
- 계약별로 사용할 수 있는 박스 규격이 있습니다. 계약 내용을 확인하고 계약 등록을 해 주십시오.
- 택배사별 규격명은 변경될 수 있으니, 코드(`B01`,`B02`,`B05`,`B10`,`B20`,`B25`,`B30`,`B40`)를 사용을 권장합니다.
<table>
    <thead><tr><th>택배사</th><th>B01</th><th>B02</th><th>B05</th><th>B10</th><th>B20</th><th>B25</th><th>B30</th><th>B40</th></tr></thead>
    <tbody>
        <tr><td>우체국택배(<code>EPOST</code>)</td><td>초소</td><td>소</td><td>중</td><td>대</td><td>특대</td><td>-</td><td>이형</td><td>-</td></tr>
        <tr><td>CJ대한통운(<code>KOREX</code>)</td><td>-</td><td>극소형</td><td>소형</td><td>중형</td><td>대형</td><td>특대형</td><td>이형</td><td>취급제한</td></tr>
        <tr><td>로젠택배(<code>LOGEN</code>)</td><td>-</td><td>-</td><td>소형</td><td>중형</td><td>대형</td><td>-</td><td>초대형</td><td>-</td></tr>
        <tr><td>롯데택배(<code>LOTTE</code>)</td><td>-</td><td>A(초소형)</td><td>B(소형)</td><td>C(중형)</td><td>D(대형)</td><td>-</td><td>E(특대형)</td><td>-</td></tr>
        <tr><td>한진택배(<code>HANJIN</code>)</td><td>-</td><td>S</td><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td><td>-</td></tr>
        <tr><td>일양로지스(<code>ILYANG</code>)</td><td>극소</td><td>-</td><td>소형</td><td>중형</td><td>기본</td><td>-</td><td>특대형</td><td>-</td></tr>
    </tbody>
</table>


박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 계약생성 요청-출고지,계약 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### GET `/api/contracts/center/{centerCodeCommaList}`

**Summary:** 계약 정보 조회 - 출고지 코드(centerCode) 기반으로 계약 정보 조회

출고지 코드(centerCode) 기반으로 계약 정보를 조회한다.(컴마구분)
- `status`
  - 계약의 상태
  - `REQUEST` : 접수완료 (계약 정보 승인 대기 중)
  - `PENDING` : 승인심사중 (승인 심사 중)
  - `APPROVED` : 승인완료 (승인 완료)
  - `REFUSED` : 승인불가 (승인 불가)
  - `CANCELED` : 신청취소


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCodeCommaList` | `path` | string | ✅ |  |  | 출고지 코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### POST `/api/contracts/center/{centerCode}`

**Summary:** 계약 생성 요청

계약 생성 요청 : 출고지 코드(centerCode) 기반으로 계약을 등록할 수 있습니다. (부가적으로 동시에 출고지 정보를 수정할 수 있습니다.)
- `centerCode` : 기존에 등록된 출고지 코드
- 정산 기준 : **CREDIT_CALC**(신용), **PREPAID_CALC**(선불)
- 정산 기준에 맞게 사용하고자 하는 박스에 요금 입력 (CREDIT_CALC: creditCost, PREPAID_CALC: prepaidCost 필수 입력)


**박스 규격**
- 계약별로 사용할 수 있는 박스 규격이 있습니다. 계약 내용을 확인하고 계약 등록을 해 주십시오.
- 택배사별 규격명은 변경될 수 있으니, 코드(`B01`,`B02`,`B05`,`B10`,`B20`,`B25`,`B30`,`B40`)를 사용을 권장합니다.
<table>
    <thead><tr><th>택배사</th><th>B01</th><th>B02</th><th>B05</th><th>B10</th><th>B20</th><th>B25</th><th>B30</th><th>B40</th></tr></thead>
    <tbody>
        <tr><td>우체국택배(<code>EPOST</code>)</td><td>초소</td><td>소</td><td>중</td><td>대</td><td>특대</td><td>-</td><td>이형</td><td>-</td></tr>
        <tr><td>CJ대한통운(<code>KOREX</code>)</td><td>-</td><td>극소형</td><td>소형</td><td>중형</td><td>대형</td><td>특대형</td><td>이형</td><td>취급제한</td></tr>
        <tr><td>로젠택배(<code>LOGEN</code>)</td><td>-</td><td>-</td><td>소형</td><td>중형</td><td>대형</td><td>-</td><td>초대형</td><td>-</td></tr>
        <tr><td>롯데택배(<code>LOTTE</code>)</td><td>-</td><td>A(초소형)</td><td>B(소형)</td><td>C(중형)</td><td>D(대형)</td><td>-</td><td>E(특대형)</td><td>-</td></tr>
        <tr><td>한진택배(<code>HANJIN</code>)</td><td>-</td><td>S</td><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td><td>-</td></tr>
        <tr><td>일양로지스(<code>ILYANG</code>)</td><td>극소</td><td>-</td><td>소형</td><td>중형</td><td>기본</td><td>-</td><td>특대형</td><td>-</td></tr>
    </tbody>
</table>


박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `centerCode` | `path` | string | ✅ |  |  | 출고지코드 |
| `body` | `body` |  | ✅ |  |  | 계약생성 요청-출고지,계약 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### GET `/api/contracts/checkCode/{transporterCode}/{businessNo}/{contractCode}`

**Summary:** 계약관리-계약코드 유효성 확인

계약코드의 유효성을 확인합니다.
- 계약코드 유효성 확인은 한진택배, CJ대한통운, 로젠택배, 롯데택배만 가능합니다.
- 테스트 서버에서는 무조건 유효한 계약으로 응답합니다. 실제 계약 유효성 확인은 운영 서버에서 진행해 주십시오.
- 택배사코드/사업자번호/계약코드 로 해당 계약 코드의 유효성을 검증합니다.
- **우체국택배**의 경우, 우체국에서 제공하는 유효성 체크 API가 없습니다. 일단 신청하면, 굿스플로 운영팀에서 확인하여 승인 처리 합니다.
- 응답값의 available이 true 일 경우 사용 가능한 계약 코드입니다.
- ※ 만약, 계약과 연결된 사업자 번호를 모를 경우, 사업자 번호의 값을 **아무 값이나** 입력 후 계약 코드만의 유효성을 확인할 수 있습니다.
- 한진원클릭 코드, 굿스플로 제휴(전담)계약 코드에 대한 유효성 체크는 실패값을 리턴합니다.


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `transporterCode` | `path` | string | ✅ |  | HANJIN, KOREX, LOGEN, LOTTE | 배송사 |
| `businessNo` | `path` | string | ✅ |  |  | 사업자번호 |
| `contractCode` | `path` | string | ✅ |  |  | 계약코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 코드 유효성 확인` | OK |

### GET `/api/contracts/seller/{sellerCodeCommaList}`

**Summary:** 계약 정보 조회 - 판매자 코드(sellerCode) 기반으로 계약 정보 조회

판매자 코드(sellerCode) 기반으로 계약 정보를 조회한다.(컴마구분)
- `status`
  - 계약의 상태
  - `REQUEST` : 접수완료 (계약 정보 승인 대기 중)
  - `PENDING` : 승인심사중 (승인 심사 중)
  - `APPROVED` : 승인완료 (승인 완료)
  - `REFUSED` : 승인불가 (승인 불가)
  - `CANCELED` : 신청취소


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `sellerCodeCommaList` | `path` | string | ✅ |  |  | 판매자 코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 목록(출고지 정보 포함)` | OK |

### DELETE `/api/contracts/{contractId}`

**Summary:** 계약 삭제 - 계약ID로 계약 삭제

계약ID(`contractId`)로 계약을 삭제 합니다.
- 되도록이면 계약 수정 API의 만료일(`endDate`) 수정을 통해 계약을 만료 시켜 무효화 하는 방식이 권장 됩니다.
- 삭제된 계약은 복구할 수 없습니다.
- 삭제 시에는 해당 계약의 추가/수정 이력도 모두 삭제되며 복구할 수 없습니다.
- 삭제가 성공하면, 삭제된 계약 정보가 Response 됩니다.
- 삭제 대상 계약의 사용 이력(송장출력/반품신청)이 있으면 삭제 불가 합니다.


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `contractId` | `path` | string | ✅ |  |  | 계약ID |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### GET `/api/contracts/{contractId}`

**Summary:** 계약 정보 조회 - 계약ID(contractId) 기반으로 계약 정보 조회

- `status`
  - 계약의 상태
  - `REQUEST` : 접수완료 (계약 정보 승인 대기 중)
  - `PENDING` : 승인심사중 (승인 심사 중)
  - `APPROVED` : 승인완료 (승인 완료)
  - `REFUSED` : 승인불가 (승인 불가)
  - `CANCELED` : 신청취소


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `contractId` | `path` | string | ✅ |  |  | 계약ID |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### PUT `/api/contracts/{contractId}`

**Summary:** 계약 수정 요청 - 계약ID(contractId) 기반으로 계약 수정

계약 수정 요청 : 계약ID(contractId) 기반으로 계약을 수정.
- 계약 수정은 제한이 있습니다. 제한 사항 외의 변경이 필요할 경우 신규로 등록해 주십시오.
- 계약 유형별 수정 가능 값
  - 일반 계약 : 출고지, 시작/종료일 변경 가능, 요금 및 도선료/항공료 등등은 기존 값이 0원이 아닐 경우에만 0원이 아닌 값으로 수정 가능
  - 제휴택배 계약 : 수정 불가
  - 전담반품 계약 : 출고지 변경만 가능


**Tags:** `OP_700_계약관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `contractId` | `path` | string | ✅ |  |  | 계약ID |
| `body` | `body` |  | ✅ |  |  | 계약수정 요청 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/계약 정보 (출고지 정보 포함)` | OK |

### DELETE `/api/deliveries/cancel`

**Summary:** 취소(서비스ID)

플랫폼 서비스ID로 등록한 배송 주문 취소(컴마구분)
배송사 픽업 전 상태만 취소 가능합니다.
**cancelReason 코드표**
<table>
    <thead>
        <tr><th>cancelReason</th><th>설명</th><th>cancelReason</th><th>설명</th></tr>
    </thead>
    <tbody>
        <tr><td><code>NOT_SEND</code></td><td>미발송</td><td><code>RE_RECEIVED</code></td><td>취소 후 재신청</td></tr>
        <tr><td><code>OTHER_SERVICE</code></td><td>고객취소</td><td><code>PICKUP_DELAY</code></td><td>집화지연</td></tr>
        <tr><td><code>ETC</code></td><td>기타</td><td colspan="2"></td></tr>
    </tbody>
</table>


**Tags:** `OP_100_배송추적`, `OP_200_송장출력`, `OP_300_반품신청`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `cancelBulkDTO` | `body` |  | ✅ |  |  | 취소 요청값 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/취소 요청 응답` | OK |

### POST `/api/deliveries/shipping/print`

**Summary:** 송장출력-송장출력정보 등록

플랫폼 송장출력을 위한 정보 등록
- **송장 출력**을 하기 위해서는 계약 등록이 선행 되어야 합니다.
  - 택배사 계약은 아래 `계약관리` API를 통해 등록하면 됩니다.
  - 계약 API의 사용이 어렵거나, 계약이 자주 추가되는 상황이 아닌 경우, 관리자 페이지(admin)에서 등록하여 사용하는 방법도 있습니다.
- `invoiceNo(송장번호)`는 출력 URI를 생성(/api/deliveries/shipping/print-uri)하고 해당 URI에서 실제 송장 출력이 될 때 발번됩니다.
- `contractType` : 계약구분 - 미입력 시 기본값인 `USER`로 등록됩니다.
  - `USER` : 택배사계약 - 직접 택배사와 계약한 택배계약일 경우 : 기본값
  - `ALLIANCE` : 제휴택배 - 굿스플로가 제공하는 제휴택배 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청/승인 후 접수 가능
  - **제휴택배**(더착한택배포함) 계약은 물류비(실비)가 과금되는 서비스입니다.
  - `deliveryPaymentMethod` : 계약을 잘 확인해 주십시오. 특수한 경우가 아니라면 송장출력은 **"보내는분 부담(SENDER_PAY)"**입니다. (대부분 착불-현장 지불이 불가한 계약임)
  - **제휴택배**(더착한택배포함) 계약으로 접수할 경우, `deliveryPaymentMethod`(운임지불방법)은 **"보내는분 부담(SENDER_PAY)"**으로 고정됩니다.
  - `orderDate` 등 일자 항목은 택배사의 시스템 구조상 일자 범위 제한이 있습니다. 1900-01-01~2079-06-06
  - **보내는 분 정보(이름/주소 등) 미 입력 시** 계약의 출고지 정보로 입력 됩니다.
    - 보내는 분 이름, 연락처는 미 입력 시 계약의 출고지 이름 및 연락처가 적용 됩니다.
    - 보내는 분 주소 미 입력 시 계약의 출고지 정보 또는 계약에 따라 담당 대리점의 주소가 적용 됩니다.
    - 단, 우편번호, 주소1, 주소2 값 중 어느 하나라도 입력된 상태이면서 다른 정보 누락 시 출고지 정보는 적용되지 않고 주소 미 입력 오류가 발생할 수 있습니다.

박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_200_송장출력`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 송장출력-송장출력정보 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### PUT `/api/deliveries/shipping/print-uri`

**Summary:** 송장출력-출력URI생성

플랫폼 주문(송장출력) 출력 링크 조회
- 요청 건 중 출력 가능한 건에 대해서만 출력 됩니다.
- 송장출력 대상 자료는 단일 계약에 대해서만 가능합니다.(ex. 한진/우체국 등록건 동시 출력 불가)
- URI는 1분간만 유효합니다.
- 출력이 불가한 경우
  - 등록되지 않은 서비스ID (또는 회원사요청번호)
  - **사용자가 취소한 건인 경우**


**Tags:** `OP_200_송장출력`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` | array | ✅ |  |  | 주문(송장출력) 접수 데이터 리스트 - serviceId(기본값) 또는 uniqueId |
| `idType` | `query` | string |  | serviceId | serviceId, uniqueId | id구분(Nullable) |
| `includePrinted` | `query` | string |  | true | true, false | 기출력 건 포함 여부 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/송장출력 URL 정보` | OK |

### POST `/api/deliveries/shipping/print/deliveryItems`

**Summary:** 송장출력-송장출력정보 등록(물품정보분리)

플랫폼 송장출력을 위한 정보 등록 - 물품 정보 다수 건 입력 가능
- **송장 출력**을 하기 위해서는 계약 등록이 선행 되어야 합니다.
  - 택배사 계약은 아래 `계약관리` API를 통해 등록하면 됩니다.
  - 계약 API의 사용이 어렵거나, 계약이 자주 추가되는 상황이 아닌 경우, 관리자 페이지(admin)에서 등록하여 사용하는 방법도 있습니다.
- `invoiceNo(송장번호)`는 출력 URI를 생성(/api/deliveries/shipping/print-uri)하고 해당 URI에서 실제 송장 출력이 될 때 발번됩니다.
- `contractType` : 계약구분 - 미입력 시 기본값인 `USER`로 등록됩니다.
  - `USER` : 택배사계약 - 직접 택배사와 계약한 택배계약일 경우 : 기본값
  - `ALLIANCE` : 제휴택배 - 굿스플로가 제공하는 제휴택배 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청/승인 후 접수 가능
  - **제휴택배**(더착한택배포함) 계약은 물류비(실비)가 과금되는 서비스입니다.
  - `deliveryPaymentMethod` : 계약을 잘 확인해 주십시오. 특수한 경우가 아니라면 송장출력은 **"보내는분 부담(SENDER_PAY)"**입니다. (대부분 착불-현장 지불이 불가한 계약임)
  - **제휴택배**(더착한택배포함) 계약으로 접수할 경우, `deliveryPaymentMethod`(운임지불방법)은 **"보내는분 부담(SENDER_PAY)"**으로 고정됩니다.
  - `orderDate` 등 일자 항목은 택배사의 시스템 구조상 일자 범위 제한이 있습니다. 1900-01-01~2079-06-06
  - **보내는 분 정보(이름/주소 등) 미 입력 시** 계약의 출고지 정보로 입력 됩니다.
    - 보내는 분 이름, 연락처는 미 입력 시 계약의 출고지 이름 및 연락처가 적용 됩니다.
    - 보내는 분 주소 미 입력 시 계약의 출고지 정보 또는 계약에 따라 담당 대리점의 주소가 적용 됩니다.
    - 단, 우편번호, 주소1, 주소2 값 중 어느 하나라도 입력된 상태이면서 다른 정보 누락 시 출고지 정보는 적용되지 않고 주소 미 입력 오류가 발생할 수 있습니다.

박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_200_송장출력`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 송장출력-송장출력정보 데이터(물품정보분리) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### POST `/api/deliveries/shipping/return`

**Summary:** 반품신청-반품접수정보 등록

플랫폼 반품 접수
- **반품 접수**를 하기 위해서는 계약 등록이 선행 되어야 합니다.
  - 택배사 계약은 아래 `계약관리` API를 통해 등록하면 됩니다.
  - 계약 API의 사용이 어렵거나, 계약이 자주 추가되는 상황이 아닌 경우, 관리자 페이지(admin)에서 등록하여 사용하는 방법도 있습니다.
  - 택배사와의 계약이 반품 접수가 가능한 계약인지 확인해 주십시오.
- `contractType` : 계약구분 - 미입력 시 기본값인 `USER`로 등록됩니다.
  - `USER` : 택배사계약 - 직접 택배사와 계약한 택배계약일 경우 : 기본값
  - `GF_RETURN` : 전담반품 - 굿스플로가 제공하는 전담반품 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청 후 접수 가능
  - `ALLIANCE` : 제휴택배 - 굿스플로가 제공하는 제휴택배 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청/승인 후 접수 가능
  - **전담반품** 및 **제휴택배**(더착한택배포함) 계약은 물류비(실비)가 과금되는 서비스입니다.
  - `deliveryPaymentMethod` : 계약을 잘 확인해 주십시오. 특수한 경우가 아니라면 반품신청은 **"받는분 부담(RECEIVER_PAY)"**입니다. (대부분 선불-현장 지불이 불가한 계약임)
  - **전담반품** 및 **제휴택배**(더착한택배포함) 계약으로 접수할 경우, `deliveryPaymentMethod`(운임지불방법)은 **"받는분 부담(RECEIVER_PAY)"**으로 고정됩니다.
  - `orderDate` 등 일자 항목은 택배사의 시스템 구조상 일자 범위 제한이 있습니다. 1900-01-01~2079-06-06
  - **받는 분 정보(이름/주소 등) 미 입력 시** 계약의 출고지 정보로 입력 됩니다.
    - 받는 분 이름, 연락처는 미 입력 시 계약의 출고지 이름 및 연락처가 적용 됩니다.
    - 받는 분 주소 미 입력 시 계약의 출고지 정보 또는 계약에 따라 담당 대리점의 주소가 적용 됩니다.
    - 단, 우편번호, 주소1, 주소2 값 중 어느 하나라도 입력된 상태이면서 다른 정보 누락 시 출고지 정보는 적용되지 않고 주소 미 입력 오류가 발생할 수 있습니다.
- 테스트 환경(test-api.goodsflow.io)에서는 반품의 임시 운송장번호는 10~30분 이내로 발번됩니다.
- 우체국택배(`EPOST`), 로젠택배(`LOGEN`), 일양로지스(`ILYANG`)의 경우 원배송 운송장번호가 필수입니다.

박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_300_반품신청`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 반품 접수 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### POST `/api/deliveries/shipping/return/deliveryItems`

**Summary:** 반품신청-반품접수정보 등록(물품정보분리)

플랫폼 반품 접수 - 물품 정보 다수 건 입력 가능
- **반품 접수**를 하기 위해서는 계약 등록이 선행 되어야 합니다.
  - 택배사 계약은 아래 `계약관리` API를 통해 등록하면 됩니다.
  - 계약 API의 사용이 어렵거나, 계약이 자주 추가되는 상황이 아닌 경우, 관리자 페이지(admin)에서 등록하여 사용하는 방법도 있습니다.
  - 택배사와의 계약이 반품 접수가 가능한 계약인지 확인해 주십시오.
- `contractType` : 계약구분 - 미입력 시 기본값인 `USER`로 등록됩니다.
  - `USER` : 택배사계약 - 직접 택배사와 계약한 택배계약일 경우 : 기본값
  - `GF_RETURN` : 전담반품 - 굿스플로가 제공하는 전담반품 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청 후 접수 가능
  - `ALLIANCE` : 제휴택배 - 굿스플로가 제공하는 제휴택배 > [계약 등록](https://admin.goodsflow.io/service/contract)에서 신청/승인 후 접수 가능
  - **전담반품** 및 **제휴택배**(더착한택배포함) 계약은 물류비(실비)가 과금되는 서비스입니다.
  - `deliveryPaymentMethod` : 계약을 잘 확인해 주십시오. 특수한 경우가 아니라면 반품신청은 **"받는분 부담(RECEIVER_PAY)"**입니다. (대부분 선불-현장 지불이 불가한 계약임)
  - **전담반품** 및 **제휴택배**(더착한택배포함) 계약으로 접수할 경우, `deliveryPaymentMethod`(운임지불방법)은 **"받는분 부담(RECEIVER_PAY)"**으로 고정됩니다.
  - `orderDate` 등 일자 항목은 택배사의 시스템 구조상 일자 범위 제한이 있습니다. 1900-01-01~2079-06-06
  - **받는 분 정보(이름/주소 등) 미 입력 시** 계약의 출고지 정보로 입력 됩니다.
    - 받는 분 이름, 연락처는 미 입력 시 계약의 출고지 이름 및 연락처가 적용 됩니다.
    - 받는 분 주소 미 입력 시 계약의 출고지 정보 또는 계약에 따라 담당 대리점의 주소가 적용 됩니다.
    - 단, 우편번호, 주소1, 주소2 값 중 어느 하나라도 입력된 상태이면서 다른 정보 누락 시 출고지 정보는 적용되지 않고 주소 미 입력 오류가 발생할 수 있습니다.
- 테스트 환경(test-api.goodsflow.io)에서는 반품의 임시 운송장번호는 10~30분 이내로 발번됩니다.
- 우체국택배(`EPOST`), 로젠택배(`LOGEN`), 일양로지스(`ILYANG`)의 경우 원배송 운송장번호가 필수입니다.

박스 규격 유효성 확인
- 착불 운임이 없을 경우 받는분 부담 송장 출력 불가
- 롯데택배 반품접수의 경우 아래 규칙으로부터 산정된 운임이 없을 경우 접수 불가
<table>
    <thead><tr><th>서비스</th><th>배송비지불</th><th>1순위</th><th>2순위</th><th>3순위</th></tr></thead>
    <tbody>
        <tr>
            <th rowspan='2'>송장출력</th>
            <th>보내는분 부담</th><td>신용or선불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>착불운임</td><td></td><td></td>
        </tr>
        <tr>
            <th rowspan='2'>반품신청</th>
            <th>보내는분 부담</th><td>반품운임</td><td>신용or선불운임</td><td></td>
        </tr>
        <tr>
            <th>받는분 부담</th><td>반품운임</td><td>착불운임</td><td>신용운임</td>
        </tr>
    </tbody>
</table>



**Tags:** `OP_300_반품신청`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 반품 접수 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### POST `/api/deliveries/tracking`

**Summary:** 운송장번호등록

배송사와 운송장번호로 배송추적 요청
- 운송장번호를 배송사 룰에 맞게 등록해주세요. (🚨 아래 주의사항 참고)
    - 동일한 `uniqueId`로 등록하면 중복된 자료 등록으로 오류를 리턴합니다.
    - `uniqueId`를 입력하지 않을 경우, 동일 택배사, 동일 운송장번호 등록 시 기존 등록된 운송장번호 오류를 리턴합니다.
    - 동일 운송장번호를 중복 등록하고자 하는 경우에는 `uniqueId` 값을 달리 가져가면 등록 가능합니다.
      이 때 운송장번호가 동일하더라도 각각의 건에 대해 사용 건수가 차감 됩니다. 각각의 결과를 별도 처리해야 하는 경우에만 이용 바랍니다.
- 운송장번호는 영문(EMS등) 및 숫자만 허용됩니다.
- 하이픈(-)이 들어가 있는 운송장번호는 하이픈이 제거된 상태로 접수 됩니다.


**Tags:** `OP_100_배송추적`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `body` | `body` |  | ✅ |  |  | 배송추적 요청 데이터 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### GET `/api/deliveries/tracking/{id}`

**Summary:** 실시간배송조회(서비스ID)

플랫폼 서비스ID 또는 회원사 요청번호로 배송 주문 추적 종적 조회

- **Standard** 요금제를 사용하지 않을 경우 상세 종적은 제공하지 않습니다.
- 배송추적 요청한 건에 대해서만 조회 가능한 API 입니다.
- 상태에 따라 택배사로 실시간  배송 요청을 합니다.
- 🚨Tracking API는 1초에 10회 이상 조회 시 오류(429:Too many requests)가 발생합니다.

**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `id` | `path` | string | ✅ |  |  | 서비스ID 또는 회원사 요청번호 |
| `idType` | `query` | string |  | serviceId | serviceId, uniqueId | id구분(Nullable) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 종적 정보` | OK |

### GET `/api/deliveries/tracking/{id}/cache`

**Summary:** 배송조회(서비스ID)

플랫폼 서비스ID 또는 회원사 요청번호로 배송 주문 추적 종적 조회

- **Standard** 요금제를 사용하지 않을 경우 상세 종적은 제공하지 않습니다.
- 배송추적 요청한 건에 대해서만 조회 가능한 API 입니다.
- 플랫폼 서버에 저장된 자료 기반으로 조회 됩니다.

**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `id` | `path` | string | ✅ |  |  | 서비스ID 또는 회원사 요청번호 |
| `idType` | `query` | string |  | serviceId | serviceId, uniqueId | id구분(Nullable) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 종적 정보` | OK |

### GET `/api/deliveries/tracking/{transporterCode}/{invoiceNo}`

**Summary:** 배송조회(배송사,운송장번호)

배송사 코드와 운송장번호로 배송 주문 추적 종적 조회

- **Standard** 요금제를 사용하지 않을 경우 상세 종적은 제공하지 않습니다.
🚨 배송추적 요청한 건에 대해서만 조회 가능한 API 입니다.
🚨 Tracking API는 1초에 10회 이상 조회 시 오류(429:Too many requests)가 발생합니다.

**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `transporterCode` | `path` | string | ✅ |  |  | 배송사코드 |
| `invoiceNo` | `path` | string | ✅ |  |  | 운송장번호 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 종적 정보` | OK |

### POST `/api/deliveries/tracking/{transporterCode}/{invoiceNo}`

**Summary:** 운송장번호등록(단건)

1건의 배송사와 운송장번호로 배송추적 요청
- 운송장번호를 배송사 룰에 맞게 등록해주세요. (🚨 아래 주의사항 참고)
    - 동일한 `uniqueId`로 등록하면 중복된 자료 등록으로 오류를 리턴합니다.
    - `uniqueId`를 입력하지 않을 경우, 동일 택배사, 동일 운송장번호 등록 시 기존 등록된 운송장번호 오류를 리턴합니다.
    - 동일 운송장번호를 중복 등록하고자 하는 경우에는 `uniqueId` 값을 달리 가져가면 등록 가능합니다.
      이 때 운송장번호가 동일하더라도 각각의 건에 대해 사용 건수가 차감 됩니다. 각각의 결과를 별도 처리해야 하는 경우에만 이용 바랍니다.
- 운송장번호는 영문(EMS등) 및 숫자만 허용됩니다.
- 하이픈(-)이 들어가 있는 운송장번호는 하이픈이 제거된 상태로 접수 됩니다.


**Tags:** `OP_100_배송추적`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `transporterCode` | `path` | string | ✅ |  |  | 배송사코드 |
| `invoiceNo` | `path` | string | ✅ |  |  | 운송장번호 |
| `itemName` | `query` | string |  |  |  | 물품명 |
| `uniqueId` | `query` | string |  |  |  | 회원사요청번호 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 요청 응답` | OK |

### PUT `/api/deliveries/uniqueId/change`

**Summary:** 등록된 Unique ID 변경

이미 사용한 Unique ID를 다른 Unique ID로 변경합니다.

- 플랫폼 내의 모든 Unique ID를 찾아 변경합니다.
- 변경 전 생성된 Webhook 자료는 변경 전 Unique ID로 콜백 됩니다.
- newUniqueId 가 비어 있을 경우, 랜덤하게 생성된 UUID 가 부여됩니다.

**Tags:** `OP_100_배송추적`, `OP_200_송장출력`, `OP_300_반품신청`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `oldUniqueId` | `query` | string | ✅ |  |  | 변경전 UniqueID |
| `newUniqueId` | `query` | string |  |  |  | 변경후 UniqueID |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/회원사요청번호 및 서비스ID 응답` | OK |

### GET `/api/deliveries/validateInvoiceNo/{transporter}/{invoiceNoCommaList}`

**Summary:** 운송장번호유효성체크

운송장번호의 유효성을 체크합니다.
- `invoiceNoCommaList` : 컴마로 구분된 운송장번호 목록 (최대 100개)
- 배송추적 요청 시 운송장 번호 validation과 동일합니다.
- 운송장번호는 영문/숫자 외 모든 문자는 제거 후 검증합니다.
- 실제 택배사의 유효성 체크룰과 다를 수 있습니다. (주기적으로 확인, 제보 환영)


**Tags:** `OP_100_배송추적`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `transporter` | `path` | string | ✅ |  |  | 배송사 |
| `invoiceNoCommaList` | `path` | string | ✅ |  |  | 체크할운송장번호목록(컴마구분) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/운송장번호 유효성 체크` | OK |

### GET `/api/deliveries/webhooks`

**Summary:** Webhook 결과 조회(벌크)

플랫폼에서 보내질 Webhook callback 자료 조회
1회 호출 시 최대 1000개 데이터가 응답 됩니다.
Webhook 서버 구축이 어려울 경우 사용해 주세요.
TRANSFERRED 값은 송장출력, 반품신청 서비스를 이용하셨을 때 받을 수 있는 상태입니다.

🚨 한번 조회된 건은 다시 조회되지 않습니다.
🚨 3개월 이상 지난 Webhook 결과 자료는 수신/미수신 여부에 관계 없이 삭제 됩니다.

deliveryStatus (상태값 코드)
 - `PRINTED` : 택배사 배송상태값 아님 - 송장출력 서비스의 송장출력 시 상태값(seq = 0)
 - `TRANSFERRED` : 택배사 배송상태값 아님 - 송장출력/반품 등 택배사 전송시 상태값(seq = 0)
 - `PICKUP_FAILED` : 미픽업 (이후에 픽업될 수 있음)
 - `PICKUP` : 픽업완료 (출발지에서 기사가 물품 픽업)
 - `IN_TRANSIT` : 이동중 (간선, 지선, 터미널 입/출고 등 모든 이동)
 - `DLV_START` : 배송출발 (배송지에 도착하여 기사가 배달을 위해 출발한 상태)
 - `DLV_FAILED` : 미배송 (수취자 부재 등으로 배송완료하지 못한 경우 - 이후에 배송완료 가능)
 - `COMPLETED` : 배송완료 (배송 완료로 종적의 끝)
 - `RETURNED` : 반송완료 (배송 건이 반송되어 완료된 경우)
 - `CANCELED` : 취소
 - `ERROR` : 오류 (지점 오류, 반품의 경우 원송장 오류 등 택배사 오류 정보)


**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/Webhook 자료` | OK |

### GET `/api/deliveries/webhooks/{id}`

**Summary:** Webhook 결과 조회(특정 서비스ID)

플랫폼 서비스ID 또는 회원사 요청번호로 Webhook callback 자료 조회
Webhook 서버 구축이 어려울 경우 사용해 주세요.
TRANSFERRED 값은 송장출력, 반품신청 서비스를 이용하셨을 때 받을 수 있는 상태입니다.
사용상의 편의를 위해 벌크 조회와 달리 이미 조회된 건도 서비스ID로 자료 조회가 가능합니다.

🚨 한번 조회된 건은 다시 조회되지 않습니다.
🚨 3개월 이상 지난 Webhook 결과 자료는 수신/미수신 여부에 관계 없이 삭제 됩니다.

deliveryStatus (상태값 코드)
 - `PRINTED` : 택배사 배송상태값 아님 - 송장출력 서비스의 송장출력 시 상태값(seq = 0)
 - `TRANSFERRED` : 택배사 배송상태값 아님 - 송장출력/반품 등 택배사 전송시 상태값(seq = 0)
 - `PICKUP_FAILED` : 미픽업 (이후에 픽업될 수 있음)
 - `PICKUP` : 픽업완료 (출발지에서 기사가 물품 픽업)
 - `IN_TRANSIT` : 이동중 (간선, 지선, 터미널 입/출고 등 모든 이동)
 - `DLV_START` : 배송출발 (배송지에 도착하여 기사가 배달을 위해 출발한 상태)
 - `DLV_FAILED` : 미배송 (수취자 부재 등으로 배송완료하지 못한 경우 - 이후에 배송완료 가능)
 - `COMPLETED` : 배송완료 (배송 완료로 종적의 끝)
 - `RETURNED` : 반송완료 (배송 건이 반송되어 완료된 경우)
 - `CANCELED` : 취소
 - `ERROR` : 오류 (지점 오류, 반품의 경우 원송장 오류 등 택배사 오류 정보)


**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `id` | `path` | string | ✅ |  |  | 서비스ID 또는 회원사 요청번호 |
| `idType` | `query` | string |  | serviceId | serviceId, uniqueId | id구분(Nullable) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/Webhook 자료` | OK |

### GET `/api/deliveries/{dateFrom}/{dateTo}/{page}/{pageSize}`

**Summary:** 등록조회(기간별)

기간/판매자 조건으로 등록된 건 조회(페이징)

- 배송추적 요청건의 배송비 항목은 모두 0으로 표기 됩니다.
- 송장출력/반품신청 건의 배송비 항목은 실제 청구되는 배송비와 상이할 수 있습니다.

**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `dateFrom` | `path` | string | ✅ | 20231201 |  | 등록일 From |
| `dateTo` | `path` | string | ✅ | 20231231 |  | 등록일 To |
| `page` | `path` | integer | ✅ | 0 |  | 요청페이지(0부터 시작) |
| `pageSize` | `path` | integer | ✅ | 10 |  | 페이지당사이즈(최대 100) |
| `serviceType` | `query` | string |  |  | TRACKING, PRINT, RETURN | 서비스유형 |
| `sellerCode` | `query` | string |  |  |  | 판매자코드 |
| `centerCode` | `query` | string |  |  |  | 출고지코드 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 정보 - 페이징` | OK |

### GET `/api/deliveries/{idCommaList}`

**Summary:** 등록조회(서비스ID)

플랫폼 서비스ID 또는 회원사 요청번호로 등록한 배송 주문 조회(컴마구분)

- 배송추적 요청건의 배송비 항목은 모두 0으로 표기 됩니다.
- 송장출력/반품신청 건의 배송비 항목은 실제 청구되는 배송비와 상이할 수 있습니다.

**Tags:** `OP_500_배송(결과)조회`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `idCommaList` | `path` | string | ✅ |  |  | 서비스ID 또는 회원사 요청번호(컴마구분, 최대 100개) |
| `idType` | `query` | string |  | serviceId | serviceId, uniqueId | id구분(Nullable) |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 정보` | OK |

### GET `/api/sellers`

**Summary:** 전체 판매자 목록 조회

**Tags:** `OP_600_출고지관리`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/판매자 목록` | OK |

### PUT `/api/test/changeStatus/{serviceId}/{deliveryStatusString}`

**Summary:** 테스트상태변경

테스트상태변경 요청

**Tags:** `OP_9998_테스트`, `OP_9999_Hidden`

**Consumes:** `application/json`

**Produces:** `application/json`, `*/*`

**Parameters**

| Name | In | Type | Required | Default | Enum | Description |
|---|---|---:|:---:|---|---|---|
| `Authorization` | `header` | string | ✅ |  |  | 발급된 API 키 |
| `serviceId` | `path` | string | ✅ |  |  | 서비스ID |
| `deliveryStatusString` | `path` | string | ✅ |  | PICKUP_FAILED, PICKUP, IN_TRANSIT, DLV_START, DLV_FAILED, COMPLETED, RETURNED | 상태값 |

**Responses**

| Status | Schema | Description |
|---:|---|---|
| `200` | `#/definitions/배송 주문 종적 정보` | OK |


## Definitions (Schemas)

### API 응답

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "402894be838d327601838d3bd22e0004",
      "description": "식별ID"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "object",
      "description": "응답데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2022-12-06 10:20:22",
      "description": "응답 서버 시간"
    }
  }
}
```

### API 응답 오류정보

```json
{
  "type": "object",
  "required": [
    "detail",
    "message"
  ],
  "properties": {
    "message": {
      "type": "string",
      "example": "유효성 오류",
      "description": "오류 메시지"
    },
    "detail": {
      "example": "{ \"fromAddress1\" : \"보내는 주소 오류\" }",
      "description": "오류 메시지",
      "$ref": "#/definitions/API 응답 항목 오류 값"
    }
  }
}
```

### API 응답 항목 오류 값

```json
{
  "type": "object",
  "properties": {
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사코드"
    }
  }
}
```

### API 페이징 응답 공통«배송 주문 데이터»

```json
{
  "type": "object",
  "required": [
    "itemCount",
    "items",
    "page",
    "pageSize",
    "totalCount",
    "totalPageCount"
  ],
  "properties": {
    "totalCount": {
      "type": "integer",
      "format": "int64",
      "example": 1024,
      "description": "전체 데이터 카운트"
    },
    "totalPageCount": {
      "type": "integer",
      "format": "int64",
      "example": 101,
      "description": "전체 페이지 카운트"
    },
    "pageSize": {
      "type": "integer",
      "format": "int32",
      "example": 100,
      "description": "페이지당 사이즈"
    },
    "page": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "현재 조회한 페이지"
    },
    "itemCount": {
      "type": "integer",
      "format": "int64",
      "example": 100,
      "description": "현재 페이지 조회 건수"
    },
    "items": {
      "type": "array",
      "description": "조회 데이터",
      "items": {
        "$ref": "#/definitions/배송 주문 데이터"
      }
    }
  }
}
```

### Webhook 자료

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/Webhook 자료 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### Webhook 자료 데이터

```json
{
  "type": "object",
  "properties": {
    "seq": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "seq"
    },
    "serviceId": {
      "type": "string",
      "example": "22120513202300012459",
      "description": "서비스ID"
    },
    "uniqueId": {
      "type": "string",
      "example": "22120513202300012459",
      "description": "회원사 요청번호"
    },
    "orderNo": {
      "type": "string",
      "example": "2022120622",
      "description": "주문 번호"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사코드"
    },
    "invoiceNo": {
      "type": "string",
      "example": "534000964792",
      "description": "운송장번호"
    },
    "statusDateTime": {
      "type": "string",
      "example": "2023-01-02 09:19:00",
      "description": "종적 일시"
    },
    "deliveryStatus": {
      "type": "string",
      "example": "COMPLETED",
      "description": "배송상태"
    },
    "location": {
      "type": "string",
      "example": "강서방화(대)",
      "description": "위치정보"
    },
    "locationPhoneNo": {
      "type": "string",
      "example": "02-514-2050",
      "description": "위치연락처(ㅋ대리점등)"
    },
    "driverName": {
      "type": "string",
      "example": "홍길동",
      "description": "배송기사명"
    },
    "driverPhoneNo": {
      "type": "string",
      "example": "010-1111-0000",
      "description": "배송기사연락처"
    },
    "errorName": {
      "type": "string",
      "example": "배송사 처리 불가",
      "description": "연동오류명"
    },
    "exceptionName": {
      "type": "string",
      "example": "송장번호 오류",
      "description": "연동오류(예외)"
    }
  }
}
```

### 계약 결과 데이터

```json
{
  "type": "object",
  "properties": {
    "data": {
      "$ref": "#/definitions/계약 정보 결과 데이터"
    },
    "error": {
      "$ref": "#/definitions/API 응답 오류정보"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

### 계약 관리 응답

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/계약 정보 결과 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 계약 생성 요청 데이터

```json
{
  "type": "object",
  "required": [
    "businessNo",
    "contractCode",
    "contractRates",
    "deliveryCalcStandard",
    "transporter"
  ],
  "properties": {
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준",
      "enum": [
        "CREDIT_CALC",
        "PREPAID_CALC"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "사업자 번호"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사 계약 코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체코드(우체국택배만 필수)"
    },
    "startDate": {
      "type": "string",
      "example": "2023-05-05",
      "description": "시작일(빈 값 또는 유효하지 않은 값일 경우 오늘 날짜)"
    },
    "endDate": {
      "type": "string",
      "example": "2025-12-31",
      "description": "종료일(필수 아님)"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "example": 0,
      "description": "항공료"
    },
    "contractRates": {
      "type": "array",
      "description": "계약 요금",
      "items": {
        "$ref": "#/definitions/계약 요금 데이터"
      }
    }
  }
}
```

### 계약 생성 요청 데이터(출고지가 없는 경우)

```json
{
  "type": "object",
  "required": [
    "businessNo",
    "centerAddress1",
    "centerAddress2",
    "centerName",
    "centerPhoneNo1",
    "centerZipCode",
    "contractCode",
    "contractRates",
    "deliveryCalcStandard",
    "transporter"
  ],
  "properties": {
    "centerName": {
      "type": "string",
      "example": "한진계약",
      "description": "출고지명"
    },
    "centerZipCode": {
      "type": "string",
      "example": "06095",
      "description": "출고지 우편번호"
    },
    "centerAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "출고지 주소"
    },
    "centerAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "출고지 상세주소"
    },
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준",
      "enum": [
        "CREDIT_CALC",
        "PREPAID_CALC"
      ]
    },
    "centerPhoneNo1": {
      "type": "string",
      "example": "01011110000",
      "description": "출고지 전화번호"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "사업자 번호"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사 계약 코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체코드(우체국택배만 필수)"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "description": "항공료"
    },
    "contractRates": {
      "type": "array",
      "description": "계약 요금",
      "items": {
        "$ref": "#/definitions/계약 요금 데이터"
      }
    }
  }
}
```

### 계약 생성 요청 데이터(출고지도 동시 생성)

```json
{
  "type": "object",
  "required": [
    "businessNo",
    "center",
    "contractCode",
    "contractRates",
    "deliveryCalcStandard",
    "transporter"
  ],
  "properties": {
    "center": {
      "description": "출고지정보",
      "$ref": "#/definitions/출고지 생성 및 수정"
    },
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준",
      "enum": [
        "CREDIT_CALC",
        "PREPAID_CALC"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "사업자 번호"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사 계약 코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체코드(우체국택배만 필수)"
    },
    "startDate": {
      "type": "string",
      "example": "2023-05-05",
      "description": "시작일(빈 값 또는 유효하지 않은 값일 경우 오늘 날짜)"
    },
    "endDate": {
      "type": "string",
      "example": "2025-12-31",
      "description": "종료일(필수 아님)"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "example": 0,
      "description": "항공료"
    },
    "contractRates": {
      "type": "array",
      "description": "계약 요금",
      "items": {
        "$ref": "#/definitions/계약 요금 데이터"
      }
    }
  }
}
```

### 계약 수정 요청 데이터

```json
{
  "type": "object",
  "properties": {
    "centerId": {
      "type": "string",
      "example": "1000000002",
      "description": "출고지ID 변경하지 않을 경우 null"
    },
    "startDate": {
      "type": "string",
      "example": "2023-05-05",
      "description": "시작일(null 이거나 유효한 값이 아닐 경우 변경 안 됨)"
    },
    "endDate": {
      "type": "string",
      "example": "2025-12-31",
      "description": "종료일(필수 아님) - null 값을 입력하면 실제로 계속 사용할 수 있는 계약이 됩니다."
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "example": 3000,
      "description": "항공료"
    },
    "contractRates": {
      "type": "array",
      "description": "계약요금-요금 수정이 없을 경우 null",
      "items": {
        "$ref": "#/definitions/계약 요금 데이터"
      }
    }
  }
}
```

### 계약 요금 데이터

```json
{
  "type": "object",
  "properties": {
    "boxSize": {
      "type": "string",
      "example": "B05",
      "description": "박스 규격"
    },
    "creditCost": {
      "type": "integer",
      "format": "int32",
      "example": 4500,
      "description": "신용 요금"
    },
    "prepaidCost": {
      "type": "integer",
      "format": "int32",
      "description": "선불 요금"
    },
    "collectCost": {
      "type": "integer",
      "format": "int32",
      "example": 4500,
      "description": "착불 요금"
    },
    "returnCost": {
      "type": "integer",
      "format": "int32",
      "example": 4600,
      "description": "반품 요금"
    }
  }
}
```

### 계약 운임 데이터

```json
{
  "type": "object",
  "required": [
    "boxSize",
    "boxSizeName",
    "collectCost",
    "creditCost",
    "prepaidCost",
    "returnCost"
  ],
  "properties": {
    "boxSize": {
      "type": "string",
      "example": "B01",
      "description": "박스규격"
    },
    "boxSizeName": {
      "type": "string",
      "example": "소형",
      "description": "택배사별 박스규격명"
    },
    "creditCost": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "신용배송료"
    },
    "prepaidCost": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "선불배송료"
    },
    "collectCost": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "착불배송료"
    },
    "returnCost": {
      "type": "integer",
      "format": "int32",
      "example": 5500,
      "description": "반품배송료"
    }
  }
}
```

### 계약 정보 (출고지 정보 포함)

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/계약 정보 (출고지 정보 포함) 데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 계약 정보 (출고지 정보 포함) 데이터

```json
{
  "type": "object",
  "properties": {
    "center": {
      "description": "출고지정보",
      "$ref": "#/definitions/출고지 정보 데이터"
    },
    "contractId": {
      "type": "string",
      "example": "1000000123",
      "description": "계약ID(Key)"
    },
    "status": {
      "type": "string",
      "example": "APPROVED",
      "description": "승인 상태"
    },
    "refusalReason": {
      "type": "string",
      "example": "장기 미사용",
      "description": "승인 거절 사유"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "택배사코드"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사계약코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체 코드"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사계약 업체 사업자등록번호"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "example": 3000,
      "description": "항공료"
    },
    "verifiedDateTime": {
      "type": "string",
      "example": "2023-05-01 12:30",
      "description": "계약승인일시"
    },
    "startDate": {
      "type": "string",
      "example": "2023-05-01",
      "description": "시작일"
    },
    "endDate": {
      "type": "string",
      "example": "2023-05-01",
      "description": "시작일"
    },
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준"
    },
    "contractRates": {
      "type": "array",
      "description": "계약운임목록",
      "items": {
        "$ref": "#/definitions/계약 운임 데이터"
      }
    }
  }
}
```

### 계약 정보 결과 데이터

```json
{
  "type": "object",
  "required": [
    "businessNo",
    "centerAddress1",
    "centerCode",
    "centerPhoneNo1",
    "centerZipCode",
    "contractCode",
    "contractRates",
    "deliveryCalcStandard",
    "refusalReason",
    "status",
    "statusName",
    "transporter",
    "verifiedDateTime"
  ],
  "properties": {
    "centerCode": {
      "type": "string",
      "example": "1000000189",
      "description": "출고지 코드"
    },
    "centerZipCode": {
      "type": "string",
      "example": "06095",
      "description": "출고지 우편번호"
    },
    "centerAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "출고지 주소"
    },
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준",
      "enum": [
        "CREDIT_CALC",
        "PREPAID_CALC"
      ]
    },
    "centerPhoneNo1": {
      "type": "string",
      "example": "01011110000",
      "description": "출고지 전화번호"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "사업자 번호"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사 계약 코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체코드(우체국택배만 필수)"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "description": "항공료"
    },
    "verifiedDateTime": {
      "type": "string",
      "format": "date-time",
      "example": "2023-02-23",
      "description": "승인일시"
    },
    "contractRates": {
      "type": "array",
      "description": "계약 요금",
      "items": {
        "$ref": "#/definitions/계약 요금 데이터"
      }
    },
    "status": {
      "type": "string",
      "example": "REQUEST",
      "description": "상태 값"
    },
    "statusName": {
      "type": "string",
      "example": "요청",
      "description": "상태 값 설명"
    },
    "refusalReason": {
      "type": "string",
      "example": "취소된 계약 코드",
      "description": "승인 거절 사유"
    }
  }
}
```

### 계약 정보 데이터

```json
{
  "type": "object",
  "properties": {
    "contractId": {
      "type": "string",
      "example": "1000000123",
      "description": "계약ID(Key)"
    },
    "status": {
      "type": "string",
      "example": "APPROVED",
      "description": "승인 상태"
    },
    "refusalReason": {
      "type": "string",
      "example": "장기 미사용",
      "description": "승인 거절 사유"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "택배사코드"
    },
    "contractCode": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사계약코드"
    },
    "contractCustomerNo": {
      "type": "string",
      "example": "1234",
      "description": "택배사 업체 코드"
    },
    "businessNo": {
      "type": "string",
      "example": "0123456789",
      "description": "택배사계약 업체 사업자등록번호"
    },
    "ferryFee": {
      "type": "integer",
      "format": "int32",
      "example": 5000,
      "description": "도선료"
    },
    "flightFee": {
      "type": "integer",
      "format": "int32",
      "example": 3000,
      "description": "항공료"
    },
    "verifiedDateTime": {
      "type": "string",
      "example": "2023-05-01 12:30",
      "description": "계약승인일시"
    },
    "startDate": {
      "type": "string",
      "example": "2023-05-01",
      "description": "시작일"
    },
    "endDate": {
      "type": "string",
      "example": "2023-05-01",
      "description": "시작일"
    },
    "deliveryCalcStandard": {
      "type": "string",
      "example": "CREDIT_CALC",
      "description": "정산 기준"
    },
    "contractRates": {
      "type": "array",
      "description": "계약운임목록",
      "items": {
        "$ref": "#/definitions/계약 운임 데이터"
      }
    }
  }
}
```

### 계약 정보 목록(출고지 정보 포함)

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/계약 정보 (출고지 정보 포함) 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 계약 코드 유효성 확인

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/계약코드 사용가능 여부 응답"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 계약코드 사용가능 여부 응답

```json
{
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean",
      "example": false,
      "description": "계약코드 사용가능 여부"
    },
    "message": {
      "type": "string",
      "example": "사용 불가한 계약 코드입니다.",
      "description": "오류 내용 또는 추가 메시지"
    }
  }
}
```

### 단순 성공or실패 응답«회원사요청번호 및 서비스ID 데이터»

```json
{
  "type": "object",
  "required": [
    "data",
    "idx",
    "success"
  ],
  "properties": {
    "idx": {
      "type": "integer",
      "format": "int32",
      "example": 0,
      "description": "데이터순번(0부터)"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "성공데이터",
      "$ref": "#/definitions/회원사요청번호 및 서비스ID 데이터"
    },
    "error": {
      "example": "null",
      "description": "실패데이터(오류정보)",
      "$ref": "#/definitions/API 응답 오류정보"
    }
  }
}
```

### 등록 응답 데이터«단순 성공or실패 응답«회원사요청번호 및 서비스ID 데이터»»

```json
{
  "type": "object",
  "required": [
    "failCnt",
    "items",
    "successCnt",
    "totalCnt"
  ],
  "properties": {
    "totalCnt": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "전체요청건수"
    },
    "successCnt": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "성공건수"
    },
    "failCnt": {
      "type": "integer",
      "format": "int32",
      "example": 0,
      "description": "실패건수"
    },
    "items": {
      "type": "array",
      "description": "성공/실패 데이터",
      "items": {
        "$ref": "#/definitions/단순 성공or실패 응답«회원사요청번호 및 서비스ID 데이터»"
      }
    }
  }
}
```

### 반품신청

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "requestId": {
      "type": "string",
      "example": "REQ-20241202-1750",
      "description": "회원사 요청 그룹번호",
      "maxLength": 255
    },
    "contractType": {
      "type": "string",
      "example": "USER",
      "description": "계약구분",
      "enum": [
        "USER",
        "GF_RETURN",
        "ALLIANCE"
      ]
    },
    "items": {
      "type": "array",
      "description": "반품신청 데이터",
      "items": {
        "$ref": "#/definitions/반품신청 데이터"
      }
    }
  }
}
```

### 반품신청 데이터

```json
{
  "type": "object",
  "required": [
    "boxSize",
    "centerCode",
    "deliveryPaymentMethod",
    "fromAddress1",
    "fromAddress2",
    "fromName",
    "fromPhoneNo",
    "fromZipcode",
    "itemName",
    "itemPrice",
    "itemQuantity",
    "orderDate",
    "orderNo",
    "toAddress1",
    "toAddress2",
    "toName",
    "toPhoneNo",
    "toZipcode",
    "transporter"
  ],
  "properties": {
    "centerCode": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지(계약) 코드",
      "maxLength": 10
    },
    "uniqueId": {
      "type": "string",
      "example": "webhook-100001",
      "description": "회원사 요청 번호",
      "maxLength": 255
    },
    "boxSize": {
      "type": "string",
      "example": "B05",
      "description": "박스 사이즈",
      "enum": [
        "B01",
        "B02",
        "B05",
        "B10",
        "B20",
        "B25",
        "B30"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사",
      "maxLength": 20
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분 이름",
      "maxLength": 50
    },
    "fromPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "보내는분 연락처",
      "maxLength": 12
    },
    "fromAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "보내는분 주소",
      "maxLength": 100
    },
    "fromAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "보내는분 상세주소",
      "maxLength": 100
    },
    "pickupRequestDate": {
      "type": "string",
      "example": "2023-01-02",
      "description": "방문 희망일"
    },
    "fromZipcode": {
      "type": "string",
      "example": "06095",
      "description": "보내는분 우편 번호",
      "maxLength": 6
    },
    "toName": {
      "type": "string",
      "example": "임꺽정",
      "description": "받는분 이름",
      "maxLength": 50
    },
    "toPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "받는분 연락처",
      "maxLength": 12
    },
    "toAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "받는분 주소",
      "maxLength": 100
    },
    "toAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "받는분 상세주소",
      "maxLength": 100
    },
    "toZipcode": {
      "type": "string",
      "example": "06095",
      "description": "받는분 우편 번호",
      "maxLength": 6
    },
    "deliveryMessage": {
      "type": "string",
      "example": "집 앞에 놓아 주세요.",
      "description": "배송 메시지",
      "maxLength": 100
    },
    "consumerName": {
      "type": "string",
      "example": "홍길동",
      "description": "주문자 이름",
      "maxLength": 50
    },
    "consumerPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "주문자 연락처",
      "maxLength": 12
    },
    "deliveryPaymentMethod": {
      "type": "string",
      "example": "SENDER_PAY",
      "description": "운임 지불 방법",
      "enum": [
        "SENDER_PAY(보내는분 부담)",
        "RECEIVER_PAY(받는분 부담)"
      ]
    },
    "originalInvoiceNo": {
      "type": "string",
      "example": "1234567890",
      "description": "원배송 운송장번호\n우체국택배(EPOST), 로젠택배(LOGEN), 일양로지스(ILYANG)의 경우 원배송 운송장번호가 필수입니다.",
      "maxLength": 20
    },
    "originalTransporterCode": {
      "type": "string",
      "example": "HANJIN",
      "description": "원배송 택배사",
      "maxLength": 20
    },
    "orderNo": {
      "type": "string",
      "example": "2022120622",
      "description": "주문 번호",
      "maxLength": 50
    },
    "orderDate": {
      "type": "string",
      "example": "2023-01-20 13:14",
      "description": "주문 일시"
    },
    "itemName": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명",
      "maxLength": 250
    },
    "itemPrice": {
      "type": "integer",
      "format": "int32",
      "example": 30000,
      "description": "물품 가격"
    },
    "itemQuantity": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "물품 수량"
    },
    "itemCode": {
      "type": "string",
      "example": "black_001",
      "description": "물품 코드",
      "maxLength": 30
    },
    "itemOption": {
      "type": "string",
      "example": "Black",
      "description": "물품 옵션",
      "maxLength": 255
    }
  }
}
```

### 반품신청 데이터(상품리스트)

```json
{
  "type": "object",
  "required": [
    "boxSize",
    "centerCode",
    "deliveryItems",
    "deliveryPaymentMethod",
    "fromAddress1",
    "fromAddress2",
    "fromName",
    "fromPhoneNo",
    "fromZipcode",
    "toAddress1",
    "toAddress2",
    "toName",
    "toPhoneNo",
    "toZipcode",
    "transporter"
  ],
  "properties": {
    "centerCode": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지(계약) 코드",
      "maxLength": 10
    },
    "uniqueId": {
      "type": "string",
      "example": "webhook-100001",
      "description": "회원사 요청 번호",
      "maxLength": 255
    },
    "boxSize": {
      "type": "string",
      "example": "B05",
      "description": "박스 사이즈",
      "enum": [
        "B01",
        "B02",
        "B05",
        "B10",
        "B20",
        "B25",
        "B30"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사",
      "maxLength": 20
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분 이름",
      "maxLength": 50
    },
    "fromPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "보내는분 연락처",
      "maxLength": 12
    },
    "fromAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "보내는분 주소",
      "maxLength": 100
    },
    "fromAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "보내는분 상세주소",
      "maxLength": 100
    },
    "pickupRequestDate": {
      "type": "string",
      "example": "2023-01-02",
      "description": "방문 희망일"
    },
    "fromZipcode": {
      "type": "string",
      "example": "06095",
      "description": "보내는분 우편 번호",
      "maxLength": 6
    },
    "toName": {
      "type": "string",
      "example": "임꺽정",
      "description": "받는분 이름",
      "maxLength": 50
    },
    "toPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "받는분 연락처",
      "maxLength": 12
    },
    "toAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "받는분 주소",
      "maxLength": 100
    },
    "toAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "받는분 상세주소",
      "maxLength": 100
    },
    "toZipcode": {
      "type": "string",
      "example": "06095",
      "description": "받는분 우편 번호",
      "maxLength": 6
    },
    "deliveryMessage": {
      "type": "string",
      "example": "집 앞에 놓아 주세요.",
      "description": "배송 메시지",
      "maxLength": 100
    },
    "consumerName": {
      "type": "string",
      "example": "홍길동",
      "description": "주문자 이름",
      "maxLength": 50
    },
    "consumerPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "주문자 연락처",
      "maxLength": 12
    },
    "deliveryPaymentMethod": {
      "type": "string",
      "example": "SENDER_PAY",
      "description": "운임 지불 방법",
      "enum": [
        "SENDER_PAY(보내는분 부담)",
        "RECEIVER_PAY(받는분 부담)"
      ]
    },
    "originalInvoiceNo": {
      "type": "string",
      "example": "1234567890",
      "description": "원배송 운송장 번호",
      "maxLength": 20
    },
    "originalTransporterCode": {
      "type": "string",
      "example": "HANJIN",
      "description": "원배송 택배사",
      "maxLength": 20
    },
    "deliveryItems": {
      "type": "array",
      "description": "주문 정보",
      "items": {
        "$ref": "#/definitions/송장출력 자료 물품정보"
      }
    }
  }
}
```

### 반품신청(물품정보분리)

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "requestId": {
      "type": "string",
      "example": "REQ-20241202-1750",
      "description": "회원사 요청 그룹번호",
      "maxLength": 255
    },
    "contractType": {
      "type": "string",
      "example": "USER",
      "description": "계약구분",
      "enum": [
        "USER",
        "GF_RETURN",
        "ALLIANCE"
      ]
    },
    "items": {
      "type": "array",
      "description": "반품신청(물품정보분리) 데이터",
      "items": {
        "$ref": "#/definitions/반품신청 데이터(상품리스트)"
      }
    }
  }
}
```

### 배송 요청 응답

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "3ea887e41f384d9ebb486c9c4b58db05",
      "description": "트랜잭션ID"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/등록 응답 데이터«단순 성공or실패 응답«회원사요청번호 및 서비스ID 데이터»»"
    },
    "error": {
      "example": "null",
      "description": "오류정보",
      "$ref": "#/definitions/API 응답 오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2022-12-06 10:20:22",
      "description": "응답 서버 시간"
    }
  }
}
```

### 배송 주문 데이터

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "example": "22120513202300012459",
      "description": "서비스ID"
    },
    "createdDateTime": {
      "type": "string",
      "example": "2022-12-06 09:50:00",
      "description": "생성일시"
    },
    "lastModifiedDateTime": {
      "type": "string",
      "example": "2022-12-06 09:50:00",
      "description": "마지막수정일시"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사코드"
    },
    "transporterName": {
      "type": "string",
      "example": "한진택배",
      "description": "배송사명"
    },
    "invoiceNo": {
      "type": "string",
      "example": "534000964792",
      "description": "운송장번호"
    },
    "serviceType": {
      "type": "string",
      "example": "TRACKING",
      "description": "서비스유형"
    },
    "itemName": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명"
    },
    "status": {
      "type": "string",
      "example": "COMPLETED",
      "description": "배송상태코드"
    },
    "statusName": {
      "type": "string",
      "example": "배송완료",
      "description": "배송상태명"
    },
    "uniqueId": {
      "type": "string",
      "example": "ID-20241202-1750",
      "description": "회원사 요청 번호"
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분이름"
    },
    "toName": {
      "type": "string",
      "example": "박길동",
      "description": "받는분이름"
    },
    "inflowType": {
      "type": "string",
      "example": "API",
      "description": "접수채널"
    },
    "sellerCode": {
      "type": "string",
      "example": "hoho-mall",
      "description": "판매자코드"
    },
    "centerCode": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지코드"
    },
    "boxCost": {
      "type": "integer",
      "format": "int32",
      "example": 4000,
      "description": "배송비"
    },
    "addedCost": {
      "type": "integer",
      "format": "int32",
      "example": 3000,
      "description": "항공료및도선료"
    },
    "totalCost": {
      "type": "integer",
      "format": "int32",
      "example": 7000,
      "description": "배송비합계"
    }
  }
}
```

### 배송 주문 정보

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/배송 주문 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 배송 주문 정보 - 페이징

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/API 페이징 응답 공통«배송 주문 데이터»"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 배송 주문 종적 데이터

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "example": "22092914030000000001",
      "description": "서비스ID"
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사코드"
    },
    "transporterName": {
      "type": "string",
      "example": "한진택배",
      "description": "배송사명"
    },
    "invoiceNo": {
      "type": "string",
      "example": "571772733630",
      "description": "운송장번호"
    },
    "uniqueId": {
      "type": "string",
      "example": "20221130201433587694",
      "description": "회원사고유번호"
    },
    "pickupDateTime": {
      "type": "string",
      "example": "2022-12-06 09:50:00",
      "description": "픽업일시"
    },
    "completeDateTime": {
      "type": "string",
      "example": "2022-12-07 14:50:00",
      "description": "배달완료일시"
    },
    "lastDlvStatType": {
      "type": "string",
      "example": "70",
      "description": "최종상태코드"
    },
    "lastStatus": {
      "type": "string",
      "example": "COMPLETED",
      "description": "최종상태코드"
    },
    "lastDlvStatName": {
      "type": "string",
      "example": "배달완료",
      "description": "최종상태명"
    },
    "lastStatusName": {
      "type": "string",
      "example": "배송완료",
      "description": "최종상태명"
    },
    "lastStatusDateTime": {
      "type": "string",
      "example": "2022-12-07 14:50:00",
      "description": "최종상태일시"
    },
    "driverName": {
      "type": "string",
      "example": "홍길동",
      "description": "배송기사명"
    },
    "driverPhoneNo": {
      "type": "string",
      "example": "010-1111-0000",
      "description": "배송기사연락처"
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분이름"
    },
    "toName": {
      "type": "string",
      "example": "박길동",
      "description": "받는분이름"
    },
    "itemName": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명"
    },
    "taker": {
      "type": "string",
      "example": "직장동료",
      "description": "수취인"
    },
    "errorMessage": {
      "type": "string",
      "example": "계약코드오류",
      "description": "오류메시지"
    },
    "remark": {
      "type": "string",
      "example": "조심히 다뤄 주세요.",
      "description": "비고"
    },
    "details": {
      "type": "array",
      "description": "종적 상세",
      "items": {
        "$ref": "#/definitions/배송 주문 종적 데이터 - 상세"
      }
    }
  }
}
```

### 배송 주문 종적 데이터 - 상세

```json
{
  "type": "object",
  "properties": {
    "seq": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "종적순번"
    },
    "statusDateTime": {
      "type": "string",
      "example": "2022-12-07 14:50:00",
      "description": "상태일시"
    },
    "location": {
      "type": "string",
      "example": "학동대리점",
      "description": "위치"
    },
    "locationPhoneNo": {
      "type": "string",
      "example": "02-514-2050",
      "description": "위치연락처"
    },
    "status": {
      "type": "string",
      "example": "COMPLETED",
      "description": "상태코드"
    },
    "statusName": {
      "type": "string",
      "example": "배송완료",
      "description": "상태명"
    },
    "dlvStatType": {
      "type": "string",
      "example": "70",
      "description": "상태코드"
    },
    "dlvStatName": {
      "type": "string",
      "example": "배달완료",
      "description": "상태명"
    },
    "transporterStatusName": {
      "type": "string",
      "example": "배달확인",
      "description": "상태명(배송사)"
    },
    "driverName": {
      "type": "string",
      "example": "홍길동",
      "description": "배송기사명"
    },
    "driverPhoneNo": {
      "type": "string",
      "example": "010-1111-0000",
      "description": "배송기사연락처"
    },
    "errorCode": {
      "type": "string",
      "example": "8204",
      "description": "연동오류코드"
    },
    "errorName": {
      "type": "string",
      "example": "배송사 처리 불가",
      "description": "연동오류명"
    },
    "transporterErrorName": {
      "type": "string",
      "example": "수취인 부재",
      "description": "배송사연동오류명"
    },
    "remark": {
      "type": "string",
      "description": "비고"
    }
  }
}
```

### 배송 주문 종적 정보

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/배송 주문 종적 데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 배송추적 요청 데이터

```json
{
  "type": "object",
  "required": [
    "invoiceNo",
    "transporter"
  ],
  "properties": {
    "uniqueId": {
      "type": "string",
      "example": "ID-20241202-1750",
      "description": "회원사 요청 번호",
      "maxLength": 255
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사"
    },
    "invoiceNo": {
      "type": "string",
      "example": "534000964792",
      "description": "운송장번호",
      "maxLength": 50
    },
    "itemName": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명",
      "maxLength": 255
    }
  }
}
```

### 배송추적(대량)

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "requestId": {
      "type": "string",
      "example": "REQ-20241202-1750",
      "description": "회원사 요청 그룹번호"
    },
    "items": {
      "type": "array",
      "description": "배송추적 요청 데이터",
      "items": {
        "$ref": "#/definitions/배송추적 요청 데이터"
      }
    }
  }
}
```

### 송장출력

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "requestId": {
      "type": "string",
      "example": "REQ-20241202-1750",
      "description": "회원사 요청 그룹번호",
      "maxLength": 255
    },
    "contractType": {
      "type": "string",
      "example": "USER",
      "description": "계약구분",
      "enum": [
        "USER",
        "GF_RETURN",
        "ALLIANCE"
      ]
    },
    "items": {
      "type": "array",
      "description": "송장출력 데이터",
      "items": {
        "$ref": "#/definitions/송장출력접수 데이터"
      }
    }
  }
}
```

### 송장출력 URL 정보

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/송장출력 URL 정보 데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 송장출력 URL 정보 데이터

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "example": "666c2988681aad0a86c708ea6410b2f9",
      "description": "id"
    },
    "url": {
      "type": "string",
      "example": "https://admin.goodsflow.io/invoice-print/public/print",
      "description": "출력호출 URL"
    },
    "uri": {
      "type": "string",
      "example": "https://admin.goodsflow.io/invoice-print/public/print/64250b474305b1297acb572e4ee86a1b",
      "description": "출력호출 URI + id"
    },
    "requestCount": {
      "type": "integer",
      "format": "int32",
      "example": 10,
      "description": "요청 건수"
    },
    "printCount": {
      "type": "integer",
      "format": "int32",
      "example": 9,
      "description": "출력 대상(가능) 건수"
    },
    "expireDateTime": {
      "type": "string",
      "example": "2023-04-06 13:30",
      "description": "출력URI 만료일시"
    }
  }
}
```

### 송장출력 자료 물품정보

```json
{
  "type": "object",
  "required": [
    "name",
    "orderDate",
    "orderNo",
    "price",
    "quantity"
  ],
  "properties": {
    "orderNo": {
      "type": "string",
      "example": "2022120622",
      "description": "주문 번호",
      "maxLength": 50
    },
    "orderDate": {
      "type": "string",
      "example": "2023-01-20 13:14",
      "description": "주문 일시"
    },
    "name": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명",
      "maxLength": 250
    },
    "quantity": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "물품 수량"
    },
    "price": {
      "type": "integer",
      "format": "int32",
      "example": 30000,
      "description": "물품 가격"
    },
    "code": {
      "type": "string",
      "example": "black_001",
      "description": "물품 코드",
      "maxLength": 30
    },
    "option": {
      "type": "string",
      "example": "Black",
      "description": "물품 옵션",
      "maxLength": 255
    }
  }
}
```

### 송장출력(물품정보분리)

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "requestId": {
      "type": "string",
      "example": "REQ-20241202-1750",
      "description": "회원사 요청 그룹번호",
      "maxLength": 255
    },
    "contractType": {
      "type": "string",
      "example": "USER",
      "description": "계약구분",
      "enum": [
        "USER",
        "GF_RETURN",
        "ALLIANCE"
      ]
    },
    "items": {
      "type": "array",
      "description": "송장출력(물품정보분리) 데이터",
      "items": {
        "$ref": "#/definitions/송장출력접수 데이터(상품리스트)"
      }
    }
  }
}
```

### 송장출력접수 데이터

```json
{
  "type": "object",
  "required": [
    "boxSize",
    "centerCode",
    "deliveryPaymentMethod",
    "fromAddress1",
    "fromAddress2",
    "fromName",
    "fromPhoneNo",
    "fromZipcode",
    "itemName",
    "itemPrice",
    "itemQuantity",
    "orderDate",
    "orderNo",
    "toAddress1",
    "toAddress2",
    "toName",
    "toPhoneNo",
    "toZipcode",
    "transporter"
  ],
  "properties": {
    "centerCode": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지(계약) 코드",
      "maxLength": 10
    },
    "uniqueId": {
      "type": "string",
      "example": "webhook-100001",
      "description": "회원사 요청 번호",
      "maxLength": 255
    },
    "boxSize": {
      "type": "string",
      "example": "B05",
      "description": "박스 사이즈",
      "enum": [
        "B01",
        "B02",
        "B05",
        "B10",
        "B20",
        "B25",
        "B30"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사",
      "maxLength": 20
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분 이름",
      "maxLength": 50
    },
    "fromPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "보내는분 연락처",
      "maxLength": 12
    },
    "fromAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "보내는분 주소",
      "maxLength": 100
    },
    "fromAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "보내는분 상세주소",
      "maxLength": 100
    },
    "fromZipcode": {
      "type": "string",
      "example": "06095",
      "description": "보내는분 우편 번호",
      "maxLength": 6
    },
    "toName": {
      "type": "string",
      "example": "임꺽정",
      "description": "받는분 이름",
      "maxLength": 50
    },
    "toPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "받는분 연락처",
      "maxLength": 12
    },
    "toAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "받는분 주소",
      "maxLength": 100
    },
    "toAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "받는분 상세주소",
      "maxLength": 100
    },
    "toZipcode": {
      "type": "string",
      "example": "06095",
      "description": "받는분 우편 번호",
      "maxLength": 6
    },
    "deliveryMessage": {
      "type": "string",
      "example": "집 앞에 놓아 주세요.",
      "description": "배송 메시지",
      "maxLength": 100
    },
    "consumerName": {
      "type": "string",
      "example": "홍길동",
      "description": "주문자 이름",
      "maxLength": 50
    },
    "consumerPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "주문자 연락처",
      "maxLength": 12
    },
    "deliveryPaymentMethod": {
      "type": "string",
      "example": "SENDER_PAY",
      "description": "운임 지불 방법",
      "enum": [
        "SENDER_PAY(보내는분 부담)",
        "RECEIVER_PAY(받는분 부담)"
      ]
    },
    "orderNo": {
      "type": "string",
      "example": "2022120622",
      "description": "주문 번호",
      "maxLength": 50
    },
    "orderDate": {
      "type": "string",
      "example": "2023-01-20 13:14",
      "description": "주문 일시"
    },
    "itemName": {
      "type": "string",
      "example": "굿스플로-보조배터리-10000mAh",
      "description": "물품명",
      "maxLength": 250
    },
    "itemPrice": {
      "type": "integer",
      "format": "int32",
      "example": 30000,
      "description": "물품 가격"
    },
    "itemQuantity": {
      "type": "integer",
      "format": "int32",
      "example": 1,
      "description": "물품 수량"
    },
    "itemCode": {
      "type": "string",
      "example": "black_001",
      "description": "물품 코드",
      "maxLength": 30
    },
    "itemOption": {
      "type": "string",
      "example": "Black",
      "description": "물품 옵션",
      "maxLength": 255
    }
  }
}
```

### 송장출력접수 데이터(상품리스트)

```json
{
  "type": "object",
  "required": [
    "boxSize",
    "centerCode",
    "deliveryItems",
    "deliveryPaymentMethod",
    "fromAddress1",
    "fromAddress2",
    "fromName",
    "fromPhoneNo",
    "fromZipcode",
    "toAddress1",
    "toAddress2",
    "toName",
    "toPhoneNo",
    "toZipcode",
    "transporter"
  ],
  "properties": {
    "centerCode": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지(계약) 코드",
      "maxLength": 10
    },
    "uniqueId": {
      "type": "string",
      "example": "webhook-100001",
      "description": "회원사 요청 번호",
      "maxLength": 255
    },
    "boxSize": {
      "type": "string",
      "example": "B05",
      "description": "박스 사이즈",
      "enum": [
        "B01",
        "B02",
        "B05",
        "B10",
        "B20",
        "B25",
        "B30"
      ]
    },
    "transporter": {
      "type": "string",
      "example": "HANJIN",
      "description": "배송사",
      "maxLength": 20
    },
    "fromName": {
      "type": "string",
      "example": "홍길동",
      "description": "보내는분 이름",
      "maxLength": 50
    },
    "fromPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "보내는분 연락처",
      "maxLength": 12
    },
    "fromAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "보내는분 주소",
      "maxLength": 100
    },
    "fromAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "보내는분 상세주소",
      "maxLength": 100
    },
    "fromZipcode": {
      "type": "string",
      "example": "06095",
      "description": "보내는분 우편 번호",
      "maxLength": 6
    },
    "toName": {
      "type": "string",
      "example": "임꺽정",
      "description": "받는분 이름",
      "maxLength": 50
    },
    "toPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "받는분 연락처",
      "maxLength": 12
    },
    "toAddress1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "받는분 주소",
      "maxLength": 100
    },
    "toAddress2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "받는분 상세주소",
      "maxLength": 100
    },
    "toZipcode": {
      "type": "string",
      "example": "06095",
      "description": "받는분 우편 번호",
      "maxLength": 6
    },
    "deliveryMessage": {
      "type": "string",
      "example": "집 앞에 놓아 주세요.",
      "description": "배송 메시지",
      "maxLength": 100
    },
    "consumerName": {
      "type": "string",
      "example": "홍길동",
      "description": "주문자 이름",
      "maxLength": 50
    },
    "consumerPhoneNo": {
      "type": "string",
      "example": "01011110000",
      "description": "주문자 연락처",
      "maxLength": 12
    },
    "deliveryPaymentMethod": {
      "type": "string",
      "example": "SENDER_PAY",
      "description": "운임 지불 방법",
      "enum": [
        "SENDER_PAY(보내는분 부담)",
        "RECEIVER_PAY(받는분 부담)"
      ]
    },
    "deliveryItems": {
      "type": "array",
      "description": "주문 정보",
      "items": {
        "$ref": "#/definitions/송장출력 자료 물품정보"
      }
    }
  }
}
```

### 운송장번호 유효성 체크

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/운송장번호 유효성 체크 결과"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 운송장번호 유효성 체크 결과

```json
{
  "type": "object",
  "properties": {
    "requestTransporter": {
      "type": "string",
      "example": "CJ대한통운",
      "description": "운송장번호 체크 요청 배송사"
    },
    "transporter": {
      "type": "string",
      "example": "KOREX",
      "description": "정제된 배송사 코드"
    },
    "transporterName": {
      "type": "string",
      "example": "CJ대한통운",
      "description": "정제된 배송사 명"
    },
    "invoiceNoList": {
      "type": "array",
      "description": "운송장번호 체크 결과 목록",
      "items": {
        "$ref": "#/definitions/운송장번호 유효성 체크 결과(번호 내역)"
      }
    }
  }
}
```

### 운송장번호 유효성 체크 결과(번호 내역)

```json
{
  "type": "object",
  "properties": {
    "requestInvoiceNo": {
      "type": "string",
      "example": "6848-0962-3814",
      "description": "운송장번호 체크 요청값"
    },
    "invoiceNo": {
      "type": "string",
      "example": "684809623814",
      "description": "정제된 운송장번호(영문/숫자 제외한 모든 문자 제거)"
    },
    "valid": {
      "type": "boolean",
      "example": true,
      "description": "운송장번호 유효성 여부"
    }
  }
}
```

### 출고지 목록

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/출고지 정보 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 출고지 생성 및 수정

```json
{
  "type": "object",
  "required": [
    "address1",
    "address2",
    "defaultCenter",
    "name",
    "phoneNo1",
    "zipCode"
  ],
  "properties": {
    "name": {
      "type": "string",
      "example": "굿스몰-양천창고",
      "description": "출고지명"
    },
    "zipCode": {
      "type": "string",
      "example": "06095",
      "description": "출고지 우편번호"
    },
    "address1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "출고지 주소"
    },
    "address2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "출고지 상세주소"
    },
    "phoneNo1": {
      "type": "string",
      "example": "025142050",
      "description": "출고지 연락처"
    },
    "sellerCode": {
      "type": "string",
      "example": "goods-mall",
      "description": "판매자코드"
    },
    "sellerName": {
      "type": "string",
      "example": "굿스몰",
      "description": "판매자명"
    },
    "defaultCenter": {
      "type": "boolean",
      "example": false,
      "description": "기본 출고지 여부"
    },
    "enabled": {
      "type": "boolean",
      "example": true,
      "description": "출고지 사용 여부"
    }
  }
}
```

### 출고지 정보

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/출고지 정보 데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 출고지 정보 데이터

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "example": "1000000001",
      "description": "출고지코드"
    },
    "name": {
      "type": "string",
      "example": "삼성동창고",
      "description": "출고지명"
    },
    "zipCode": {
      "type": "string",
      "example": "06095",
      "description": "출고지 우편번호"
    },
    "address1": {
      "type": "string",
      "example": "서울시 강남구 봉은사로 479(삼성동)",
      "description": "출고지 주소"
    },
    "address2": {
      "type": "string",
      "example": "16층 굿스플로",
      "description": "출고지 상세주소"
    },
    "phoneNo1": {
      "type": "string",
      "example": "01011110000",
      "description": "출고지 전화번호"
    },
    "sellerCode": {
      "type": "string",
      "example": "goods_seller",
      "description": "판매자코드"
    },
    "sellerName": {
      "type": "string",
      "example": "굿스쇼핑",
      "description": "판매자명"
    },
    "defaultSeller": {
      "type": "boolean",
      "example": true,
      "description": "기본판매자여부"
    },
    "defaultCenter": {
      "type": "boolean",
      "example": true,
      "description": "기본출고지여부"
    },
    "enabled": {
      "type": "boolean",
      "example": true,
      "description": "사용여부"
    }
  }
}
```

### 출고지 정보(계약 목록 포함)

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "description": "응답데이터",
      "$ref": "#/definitions/출고지 정보 데이터"
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 취소 요청 응답

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/회원사요청번호 및 서비스ID 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 취소대상 및 사유 정보

```json
{
  "type": "object",
  "required": [
    "id",
    "reasonType"
  ],
  "properties": {
    "id": {
      "type": "string",
      "example": "22092914030000000001",
      "description": "서비스 ID"
    },
    "reasonType": {
      "type": "string",
      "example": "PICKUP_DELAY",
      "description": "취소 사유",
      "enum": [
        "NOT_SEND",
        "RE_RECEIVED",
        "SENDER_CANCEL",
        "PICKUP_DELAY",
        "OTHER_SERVICE",
        "PICKUP_OTHER",
        "ETC"
      ]
    },
    "contents": {
      "type": "string",
      "example": "구매자 주문 취소",
      "description": "취소 사유(직접기록)"
    }
  }
}
```

### 취소신청(대량)

```json
{
  "type": "object",
  "required": [
    "items"
  ],
  "properties": {
    "items": {
      "type": "array",
      "description": "배송 취소 데이터",
      "items": {
        "$ref": "#/definitions/취소대상 및 사유 정보"
      }
    }
  }
}
```

### 판매자 목록

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/판매자 정보 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```

### 판매자 정보 데이터

```json
{
  "type": "object",
  "properties": {
    "sellerCode": {
      "type": "string",
      "example": "goods_seller",
      "description": "판매자코드"
    },
    "sellerName": {
      "type": "string",
      "example": "굿스쇼핑",
      "description": "판매자명"
    },
    "defaultSeller": {
      "type": "boolean",
      "example": true,
      "description": "기본판매자여부"
    }
  }
}
```

### 회원사요청번호 및 서비스ID 데이터

```json
{
  "type": "object",
  "properties": {
    "uniqueId": {
      "type": "string",
      "example": "ID-20241202-1750",
      "description": "회원사요청번호"
    },
    "serviceId": {
      "type": "string",
      "example": "22120513202300012459",
      "description": "서비스ID"
    }
  }
}
```

### 회원사요청번호 및 서비스ID 응답

```json
{
  "type": "object",
  "required": [
    "responseDateTime",
    "success",
    "transactionId"
  ],
  "properties": {
    "transactionId": {
      "type": "string",
      "example": "28b25a465d0445628c7fa42185195384",
      "description": "작업단위"
    },
    "success": {
      "type": "boolean",
      "example": true,
      "description": "성공여부"
    },
    "data": {
      "type": "array",
      "description": "응답데이터",
      "items": {
        "$ref": "#/definitions/회원사요청번호 및 서비스ID 데이터"
      }
    },
    "error": {
      "type": "object",
      "example": "null",
      "description": "오류정보"
    },
    "responseDateTime": {
      "type": "string",
      "example": "2024-05-01 10:00:00",
      "description": "응답 서버 시간"
    }
  }
}
```
