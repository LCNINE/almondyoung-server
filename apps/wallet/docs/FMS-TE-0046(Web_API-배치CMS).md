# Web API – 배치 CMS

- 문서번호: FMS-TE-0046
- 개정차수: 10

이 문서의 저작권은 효성에프엠에스㈜에게 있으며 무단 복제 및 배포를 금합니다.

---

## 개정이력

| 개정차수 | 제ㆍ개정일 | 주요 내용 |
|---|---|---|
| 0 | 2016.11.08 | 최초 제정 |
| 1 | 2016.11.22 | 3. 동의자료 등록 및 조회 API 추가<br>6. 오류코드 추가<br>7. 테스트환경 추가 |
| 2 | 2016.12.15 | 우편번호 필드 변경<br>- 허용길이: 6 → 7<br>- 허용값: ‘-‘ 추가 (123-456, 123456, 12345 포맷 지원)<br>paymentKind 변경: ‘배치CMS’ → ‘CMS’<br>4. 출금관리 URL 변경: /v1/payments/account → /v1/payment/cms<br>5. 서비스 가능 은행 변경: 은행 명 → 공식 은행 코드(3자리) |
| 3 | 2017.04.19 | Postman 사용 가이드 추가 |
| 4 | 2019.08.29 | 1. 시작하기 전에 > Response 샘플 Location 및 links URL 정의 추가<br>5. 서비스 가능 은행 > 케이뱅크 추가<br>7. 테스트 환경 내용 수정 |
| 5 | 2020.07.10 | Host 및 location url 변경 : api(add).efnc.co.kr → api(add).hyosungcms.co.kr |
| 6 | 2020.09.11 | 7. Test 환경 1) 주소 회원관리, 출금관리 URL 변경 |
| 7 | 2020.12.07 | 5. 서비스 가능 은행 > 카카오뱅크 추가 |
| 8 | 2021.04.12 | 8. 기술지원 추가 |
| 9 | 2021.08.20 | Request 전문내 Host(Test) 정보 추가 |
| 10 | 2022.08.03 | 1. 6)포맷 오류 문구 수정<br>1. 7)기타 문구 수정<br>2. 1)회원등록 문구 수정, 추가<br>2. 2)회원수정 문구 수정<br>3. 1)동의자료 등록 문구 수정, 추가<br>4. 1)출금신청 문구 수정, 추가<br>4. 5)출금 검색조건 조회 추가<br>5. 서비스 가능 은행 > 토스뱅크 추가 |

## 목 차

1. 시작하기 전에  
2. 회원관리  
   1) 회원등록  
   2) 회원수정  
   3) 회원삭제  
   4) 회원조회  
3. 동의자료 관리  
   1) 동의자료 등록  
   2) 동의자료 조회  
4. 출금관리  
   1) 출금신청  
   2) 출금수정  
   3) 출금삭제  
   4) 출금조회  
   5) 출금 검색조건 조회  
5. 서비스 가능 은행  
6. 오류코드  
7. 테스트 환경  
8. 기술지원  

---

이 문서에서 설명하는 내용은 효성에프엠에스(주) 지적 자산입니다.

## 1. 시작하기 전에

### 1) 버전
- API 버전은 v1입니다. URL의 버전을 생략하실 경우 자동으로 최신 버전의 API를 사용합니다. 하지만 새로운 버전의 API는 기존 버전과 호환되지 않을 수 있으므로 버전을 명시하는 것을 권장 드립니다.

### 2) 표현
- `{key}` 양식은 실행 시에 value로 치환해야 합니다. (예. `{name}` -> 홍길동)
- 허용 값 항목에서 A는 알파벳(대소문자 구분), N은 숫자, H는 한글을 의미합니다.

### 3) 인증
- 인증 정보는 HTTP의 표준 Authorization 헤더를 사용합니다. 연동 기관일 경우 `Authorization: VAN {swKey}:{custKey}`에서 `{swKey}`와 `{custKey}`를 보유하신 연동기관 키, 이용기관 키로 치환하여 사용해 주십시오.

### 4) 보안
- 모든 통신은 SSL을 통해서만 가능합니다.

### 5) 요청
- Request에서 필수가 아닌 항목들은 생략할 수 있습니다.

### 6) 포맷 오류
- Request 오류에 대해서는 각 업무의 response 포맷이 아닌 아래의 포맷으로 응답합니다.

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=UTF-8
{
  "error": {
    "message": "오류 메시지",
    "developerMessage": "상세 오류 메시지"
  }
}
```

### 7) 기타
- Response 샘플의 Location 및 links URL에서 표시되는 apitest는 예시를 위한 custId(업체Id)이며 운영 환경에서는 클라이언트의 custId를 반영한 URL로 응답합니다.

```json
“links”: [
   {
      “rel”:  “self”,
      “href”: “https://{도메인주소}/v1/custs/{custId}/...
   }
]
```

---

## 2. 회원관리

### 1) 회원등록
- 회원정보를 등록할 수 있는 API이며 출금신청은 회원 등록이 완료된 회원에 한해서만 가능합니다.
- 회원 ID는 고유한 값이어야 하지만 삭제한 회원의 회원 ID는 재사용이 가능합니다.
- 입력 값의 오류로 인해 Status Code: 400 Bad Request로 응답하는 경우에는 회원정보가 서버에 등록되지 않습니다.  
  또한 Status Code: 201 Created로 응답하더라도 결제번호 오류 등의 사유로 신청실패 처리될 수 있으며 이러한 회원에 대해서는 출금신청을 할 수 없습니다. 이때는 회원삭제 후 다시 회원등록을 하시거나 아래의 회원수정 API를 이용해 회원정보를 다시 등록할 수 있습니다.
- 회원등록 마감시간은 12:00이며 마감시간 이후에 회원등록을 할 경우 다음 영업일에 처리됩니다. 회원등록 결과는 등록일의 다음 영업일에 확인할 수 있습니다.  
  *마감시간은 매 영업일 12:00 / 20일은 월요일로 가정.
- paymentCompany 항목을 위한 은행 정보는 5. 서비스 가능 은행에서 확인할 수 있습니다.
- paymentDay, defaultAmount 항목은 등록된 정보와 상관없이 자동 출금 처리가 되지 않으며, 출금이 필요한 경우 출금신청을 요청해야 합니다.
- 현금영수증 발행정보(receiptFlag, receiptNumber)를 등록한 회원 정보는 출금이 정상적으로 처리될 경우 현금영수증이 자동으로 발급됩니다. *단 현금영수증 서비스를 사용하는 경우에만 해당됩니다.
- 출금신청은 등록된 회원의 paymentStartDate와 paymentEndDate 사이 날짜에만 가능합니다.
- paymentEndDate가 만료된(당일 이전인 경우) 회원은 출금신청을 할 수 없습니다.

| 신청일 | 신청시간 | 처리일 | 결과확인일 |
|---|---|---|---|
| 20 일 | 11:00 | 20 일 | 21 일 |
| 20 일 | 13:00 | 21 일 | 22 일 |
| 23 일 | 15:00 | 24 일 | 27 일 |

#### (1) Request

##### ① Request 샘플

```http
POST /v1/members HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: application/json; charset=UTF-8

{
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "smsFlag": "N",
    "phone": "01012345678",
    "email": "hong@email.com",
    "zipcode": "06349",
    "address1": "서울특별시 강남구",
    "address2": "광평로 281",
    "joinDate": "20160101",
    "receiptFlag": "Y",
    "receiptNumber": "01012345678",
    "memberKind": "000",
    "managerId": "apitest",
    "memo": "회원에대한메모",
    "paymentStartDate": "20200101",
    "paymentEndDate": "20201231",
    "paymentDay": "25",
    "defaultAmount": 50000,
    "paymentKind": "CMS",
    "paymentCompany": "088",
    "paymentNumber": "1234567890",
    "payerName": "홍길동",
    "payerNumber": "900101"
}
```

##### ② Request Body 상세

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| memberId | 회원 ID(고유 값) | O | 20 | A,N, -, _, (, ) |
| memberName | 회원 이름 | O | 25 | ', ", \ 제외 |
| smsFlag | SMS 발송여부 | X(‘N’) | 1 | Y(y), N(n) |
| phone | 전화번호 | O | 12 | N |
| email | 이메일 | X | 40 | A, N, -, _, . |
| zipcode | 우편번호 | X | 7 | N, - |
| address1 | 주소(시, 동, 구) | X | 100 | ', ", \ 제외 |
| address2 | 상세주소 | X | 100 | ', ", \ 제외 |
| joinDate | 이용기관 가입일(YYYYMMDD 포맷) | X(회원등록일) | 8 | N |
| receiptFlag | 현금영수증 발행여부 | X(‘N’) | 1 | Y(y), N(n) |
| receiptNumber | 현금영수증 발행번호<br>receiptFlag가 ‘Y’면 필수 | △ | 20 | N |
| memberKind | 회원 구분 | X(‘000’) | 3 | N |
| managerId | 회원 관리자 | X(대표사용자 ID) | 10 | A, N |
| memo | 메모, 회원에 대한 부가 정보 | X | 1000 | ', ", \ 제외 |
| paymentStartDate | 결제기간 시작일 | X(회원등록일) | 8 | N |
| paymentEndDate | 결제기간 종료일 | X(99991231) | 8 | N |
| paymentDay | 매월 결제일 | X(01) | 2 | N |
| defaultAmount | 기본 결제금액 | X(0) | 12 | N |
| paymentKind | 결제 수단(‘CMS’ 입력) | O | 10 | A |
| paymentCompany | 결제 기관 | O | 3 | N |
| paymentNumber | 결제 번호 | O | 16 | N |
| payerName | 납부자 이름 | O | 15 | ', ", \ 제외 |
| payerNumber | 납부자 번호(생년월일/사업자번호) | O | 10 | N |

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=UTF-8
Location: https://api.hyosungcms.co.kr/v1/members/MEMBER-01
{
  "member": {
    "status": "신청대기",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "smsFlag": "N",
    "phone": "01012345678",
    "email": "hong@email.com",
    "zipcode": "06349",
    "address1": "서울특별시 강남구",
    "address2": "광평로 281",
    "joinDate": "2016/01/01",
    "receiptFlag": "Y",
    "receiptNumber": "01012345678",
    "memberKind": "000",
    "managerId": "apitest",
    "memo": "회원에대한메모",
    "paymentStartDate": "2020/01/01",
    "paymentEndDate": "2020/12/31",
    "paymentDay": "25",
    "defaultAmount": 50000,
    "paymentKind": "CMS",
    "paymentCompany": "088",
    "paymentNumber": "123****890",
    "payerName": "홍길동",
    "result": {
      "flag": null,
      "code": null,
      "message": null
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/members/MEMBER-01"
      }
    ]
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| status | 회원 상태(신청대기, 신청중, 신청실패, 신청완료) |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| smsFlag | SMS 발송여부 |
| phone | 전화번호 |
| email | 이메일 |
| zipcode | 우편번호 |
| address1 | 주소(시, 동, 구) |
| address2 | 상세주소 |
| joinDate | 이용기관 가입일 |
| receiptFlag | 현금영수증 발행여부 |
| receiptNumber | 현금영수증 발행번호 |
| memberKind | 회원 구분 |
| managerId | 회원 관리자 |
| memo | 메모, 회원에 대한 부가 정보 |
| paymentStartDate | 결제기간 시작일 |
| paymentEndDate | 결제기간 종료일 |
| paymentDay | 매월 결제일 |
| defaultAmount | 기본 결제금액 |
| paymentKind | 결제 수단 |
| paymentCompany | 결제 기관 |
| paymentNumber | 결제 번호 |
| payerName | 납부자 이름 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URL |

### 2) 회원수정
- 등록된 회원정보를 수정하거나 새롭게 회원을 등록하기 위한 기능을 제공하는 API입니다.
- URL의 `{memberId}`가 이미 등록된 회원 ID일 경우에는 등록된 회원정보를 수정하며 Status Code: 200 Ok로 응답합니다.
- 회원 ID가 아직 등록되지 않은 경우에는 회원을 신규로 등록하며 Status Code: 201 Created로 응답합니다.
- 대부분의 값은 필수가 아니며 값이 존재하는 항목에 대해서만 수정됩니다.
- 결제정보 변경은 모든 결제정보(결제기관, 결제번호, 납부자 이름, 납부자 번호) 를 필수로 입력해야 하며, 변경할 결제정보에 맞는 동의자료를 반드시 등록해야 합니다.
- 결제정보 변경은 기존에 등록된 회원 정보가 삭제되고 변경할 회원정보를 등록하는 프로세스로 처리됩니다.
- 결제정보 이외의 항목을 변경할 경우 상태에 상관없이 변경할 수 있습니다.
- 회원등록 중이거나, 출금내역이 완료되지 않은 경우(출금중, 출금대기) 결제정보를 변경할 수 없습니다.

#### (1) Request
고
##### ① Request 샘플

```http
PUT /v1/members/{memberId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: application/json; charset=UTF-8

{
    "memberName": null,
    "smsFlag": null,
    "phone": "01087654321",
    "email": null,
    "zipcode": null,
    "address1": null,
    "address2": null,
    "joinDate": null,
    "receiptFlag": null,
    "receiptNumber": null,
    "memberKind": null,
    "managerId": null,
    "memo": "전화번호변경 01012345678 -> 01087654321",
    "paymentStartDate": null,
    "paymentEndDate": null,
    "paymentDay": null,
    "defaultAmount": null,
    "paymentKind": "CMS",
    "paymentCompany": null,
    "paymentNumber": null,
    "payerName": null,
    "payerNumber": null
}
```

##### ② Request Body 상세

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| memberName | 회원 이름 | X | 25 | ', ", \ 제외 |
| smsFlag | SMS 발송여부 | X | 1 | Y(y), N(n) |
| phone | 전화번호(smsFlag가 ‘Y’면 필수) | X | 12 | N |
| email | 이메일 | X | 40 | A, N, -, _, . |
| zipcode | 우편번호 | X | 7 | N, - |
| address1 | 주소(시, 동, 구) | X | 100 | ', ", \ 제외 |
| address2 | 상세주소 | X | 100 | ', ", \ 제외 |
| joinDate | 이용기관 가입일(YYYYMMDD 포맷) | X | 8 | N |
| receiptFlag | 현금영수증 발행여부 | X | 1 | Y(y), N(n) |
| receiptNumber | 현금영수증 발행번호 | X | 20 | N |
| memberKind | 회원 구분 | X | 3 | N |
| managerId | 회원 관리자 | X | 10 | A, N |
| memo | 메모, 회원에 대한 부가 정보 | X | 1000 | ', ", \ 제외 |
| paymentStartDate | 결제기간 시작일 | X | 8 | N |
| paymentEndDate | 결제기간 종료일 | X | 8 | N |
| paymentDay | 매월 결제일 | X | 2 | N |
| defaultAmount | 기본 결제금액 | X | 12 | N |
| paymentKind | 결제 수단(‘CMS’ 입력) | O | 10 | A |
| paymentCompany | 결제 기관 | △ | 3 | N |
| paymentNumber | 결제 번호 | △ | 16 | N |
| payerName | 납부자 이름 | △ | 15 | ', ", \ 제외 |
| payerNumber | 납부자 번호(생년월일/사업자번호) | △ | 10 | N |

- 결제 정보를 변경하고자 할 경우 paymentCompany, paymentNumber, payerName, payerNumber를 모두 입력해야 합니다.

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "member":  {
    "status": "신청대기",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "smsFlag": "N",
    "phone": "01087654321",
    "email": "hong@email.com",
    "zipcode": "06349",
    "address1": "서울특별시 강남구",
    "address2": "광평로 281",
    "joinDate": "2016/01/01",
    "receiptFlag": "Y",
    "receiptNumber": "01012345678",
    "memberKind": "000",
    "managerId": "apitest",
    "memo": "전화번호변경 01012345678 -> 01087654321",
    "paymentStartDate": "2020/01/01",
    "paymentEndDate": "2020/12/31",
    "paymentDay": "25",
    "defaultAmount": 50000,
    "paymentKind": "CMS",
    "paymentCompany": "088",
    "paymentNumber": "123****890",
    "payerName": "홍길동",
    "result": {
      "flag": null,
      "code": null,
      "message": null
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api. hyosungcms.co.kr/v1/members/MEMBER-01"
      }
    ]
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| status | 회원 상태(신청대기, 신청중, 신청실패, 신청완료) |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| smsFlag | SMS 발송여부 |
| phone | 전화번호 |
| email | 이메일 |
| zipcode | 우편번호 |
| address1 | 주소(시, 동, 구) |
| address2 | 상세주소 |
| joinDate | 이용기관 가입일 |
| receiptFlag | 현금영수증 발행여부 |
| receiptNumber | 현금영수증 발행번호 |
| memberKind | 회원 구분 |
| managerId | 회원 관리자 |
| memo | 메모, 회원에 대한 부가 정보 |
| paymentStartDate | 결제기간 시작일 |
| paymentEndDate | 결제기간 종료일 |
| paymentDay | 매월 결제일 |
| defaultAmount | 기본 결제금액 |
| paymentKind | 결제 수단 |
| paymentCompany | 결제 기관 |
| paymentNumber | 결제 번호 |
| payerName | 납부자 이름 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URI |

### 3) 회원삭제
- 등록된 회원정보를 삭제하기 위한 API입니다.
- 회원등록 중이거나, 출금내역이 완료되지 않은 경우(출금중, 출금대기) 회원삭제가 불가능합니다.
- 삭제한 회원정보는 회원조회 API를 통해 조회할 수 없습니다.

#### (1) Request

##### ① Request 샘플

```http
DELETE /v1/members/{memberId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
```

##### ② Request Body 상세
- 없음

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 204 No Content
```

##### ② Response Body 상세
- 없음

### 4) 회원조회
- 등록된 회원정보를 조회하기 위한 API입니다.

#### (1) Request

##### ① Request 샘플

```http
GET /v1/members/{memberId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
```

##### ② Request Body 상세
- 없음

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "member": {
    "status": "신청완료",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "smsFlag": "N",
    "phone": "01087654321",
    "email": "hong@email.com",
    "zipcode": "06349",
    "address1": "서울특별시 강남구",
    "address2": "광평로 281",
    "joinDate": "2016/01/01",
    "receiptFlag": "Y",
    "receiptNumber": "01012345678",
    "memberKind": "000",
    "managerId": "apitest",
    "memo": "전화번호변경 01012345678 -> 01087654321",
    "paymentStartDate": "2020/01/01",
    "paymentEndDate": "2020/12/31",
    "paymentDay": "25",
    "defaultAmount": 50000,
    "paymentKind": "CMS",
    "paymentCompany": "088",
    "paymentNumber": "123****890",
    "payerName": "홍길동",
    "result":  {
      "flag": "Y",
      "code": "Q000",
      "message": "정상"
    },
    "links":  [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/members/MEMBER-01"
      }
    ]
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| status | 회원 상태(신청대기, 신청중, 신청실패, 신청완료) |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| smsFlag | SMS 발송여부 |
| phone | 전화번호 |
| email | 이메일 |
| zipcode | 우편번호 |
| address1 | 주소(시, 동, 구) |
| address2 | 상세주소 |
| joinDate | 이용기관 가입일 |
| receiptFlag | 현금영수증 발행여부 |
| receiptNumber | 현금영수증 발행번호 |
| memberKind | 회원 구분 |
| managerId | 회원 관리자 |
| memo | 메모 |
| paymentStartDate | 결제기간 시작일 |
| paymentEndDate | 결제기간 종료일 |
| paymentDay | 매월 결제일 |
| defaultAmount | 기본 결제금액 |
| paymentKind | 결제 수단 |
| paymentCompany | 결제 기관 |
| paymentNumber | 결제 번호 |
| payerName | 납부자 이름 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URL |

---

## 3. 동의자료관리

### 1) 동의자료 등록
- 회원등록, 수정(결제정보의 수정)된 회원의 자동이체 동의자료를 제출하기 위한 API입니다.
- 회원등록, 수정에서 사용한 회원 ID로 동의자료를 등록해야 합니다.
- 동의자료가 등록되지 않으면 회원은 신청실패(동의자료 미등록)로 처리됩니다.
- 동의자료 파일은 동의서를 촬영 또는 스캔한 사진 파일(서면), 납부자의 육성을 녹음한 음성 파일(녹취), 전자서명 파일을 등록할 수 있습니다.
- 동의자료 등록은 회원등록, 수정 요청한 일자의 14시 이전까지 등록되어야 하며, 가급적 회원 업무와 동일한 시간에 처리하는 것을 권장합니다.
- 동의자료 파일은 아래와 같은 확장자를 지원합니다.  
  서면: jpg, jpeg, png, gif, tif, tiff, pdf / 녹취: wav, mp3, wma 전자서명: der

#### (1) Request

##### ① Request 샘플

```http
POST /v1/custs/{custId}/agreements HTTP/1.1
Host: add.hyosungcms.co.kr (Real)
Host: add-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: multipart/form-data; boundary=-----011000010111000001101001

-----011000010111000001101001
Content-Disposition: form-data; name="memberId"

MEMBER-01
-----011000010111000001101001
Content-Disposition: form-data; name="file"; filename="MEMBER-01.jpg"
Content-Type:
-----011000010111000001101001--
```

##### ② Request Body 상세

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| memberId | 회원 ID | O | 20 | A, N, -, _, (, ) |
| file | 동의자료 파일<br>서면<br>녹취<br>전자서명 | O | 5MB<br>300KB<br>5KB | N |

- 동의자료 등록 API의 Content-Type은 multipart/form-data 입니다.
- boundary 및 Content-Disposition 부분은 HTTP 지원 라이브러리를 이용하는 것이 수월합니다.

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "agreementFile": {
    "registerStatus": "등록",
    "agreementKey": "1000000000000000000001",
    "memberId": "MEMBER-01",
    "memberName": null,
    "agreementTime": "2020/01/20 15:00:00",
    "agreementWay": "직접",
    "agreementKind": "서면",
    "fileExtension": "jpg",
    "result": {
      "code": "Y",
      "message": "정상 처리"
    }
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| registerStatus | 동의 상태 |
| agreementKey | 동의키 |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| agreementTime | 동의 일시 |
| agreementWay | 동의 구분 |
| agreementKind | 동의 자료 종류 (서면, 녹취, 전자서명) |
| fileExtension | 파일 확장자 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |

### 2) 동의자료 조회
- 등록된 동의자료 정보를 조회하기 위한 API입니다.
- 등록된 동의자료 파일은 상위기관에 제출하면서 삭제됩니다. 삭제된 이후에는 조회할 수 없습니다.

#### (1) Request

##### ① Request 샘플

```http
GET /v1/custs/{custId}/agreements/{agreementKey} HTTP/1.1
Host: add.hyosungcms.co.kr (Real)
Host: add-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
```

##### ② Request Body 상세
- 없음

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "agreementFile": {
    "registerStatus": "등록",
    "agreementKey": "1000000000000000000001",
    "memberId": "MEMBER-01",
    "memberName": null,
    "agreementTime": "2020/01/20 15:00:00",
    "agreementWay": "직접",
    "agreementKind": "서면",
    "fileExtension": "jpg",
    "result": {
      "code": "Y",
      "message": "정상 처리"
    }
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| registerStatus | 동의 상태 |
| agreementKey | 동의키 |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| agreementTime | 동의 일시 |
| agreementWay | 동의 구분 |
| agreementKind | 동의 자료 종류(서면, 녹취, 전자서명) |
| fileExtension | 파일 확장자 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |

---

## 4. 출금관리

### 1) 출금신청
- 회원등록, 수정이 완료되고 상태가 신청완료인 회원을 대상으로 결제를 하기 위한 API입니다.
- 거래 ID는 모든 결제 건에 대해서 고유한 값이어야 합니다. (예. YYYYMMDD + 연번) 삭제한 출금신청 내역의 거래 ID는 재사용 할 수 있습니다.
- 출금일은 1달 이내의 영업일로 설정할 수 있습니다.
- 출금신청 마감시간은 출금일 하루 전 영업일 17:00이며, 마감시간을 경과할 경우 그 다음 영업일에 출금이 가능합니다. 출금신청 결과는 출금일 다음 영업일에 확인할 수 있습니다.  
  *마감시간은 출금일의 전 영업일 17:00 / 20일은 월요일로 가정.

| 신청일 | 신청시간 | 출금가능일 | 결과확인일 |
|---|---|---|---|
| 20 일 | 16:00 | 21 일 | 22 일 |
| 20 일 | 18:00 | 22 일 | 23 일 |
| 23 일 | 15:00 | 24 일 | 27 일 |

#### (1) Request

##### ③ Request 샘플

```http
POST /v1/payments/cms HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: application/json; charset=UTF-8

{
    "transactionId": "TRANSACTION-01",
    "memberId": "MEMBER-01",
    "paymentDate": "20200125",
    "callAmount": 10000
}
```

##### ④ Request Body 상세

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| transactionId | 거래 ID(고유 값) | O | 30 | A, N, -, _, (, ) |
| memberId | 회원 ID | O | 20 | A, N, -, _, (, ) |
| paymentDate | 출금일 | O | 8 | N |
| callAmount | 결제 요청 금액 | O | 12 | N |

#### (2) Response

##### ③ Response 샘플

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=UTF-8
Location: https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-01

{
  "payment": {
    "status": "출금대기",
    "transactionId": "TRANSACTION-01",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "paymentDate": "2020/01/25",
    "callAmount": 10000,
    "actualAmount": 0,
    "fee": 0,
    "result": {
      "flag": null,
      "code": null,
      "message": null
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-01"
      }
    ],
  }
}
```

##### ④ Response Body 상세

| 항목 | 설명 |
|---|---|
| Status | 결제 상태(출금대기, 출금중, 출금실패, 출금성공) |
| transactionId | 거래 ID |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| paymentDate | 출금일 |
| callAmount | 요청 결제 금액 |
| actualAmount | 실제 결제 금액 |
| fee | 수수료(출금 처리 여부에 따라 결정) |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| Links | 리소스 URL |

### 2) 출금수정
- 마감시간이 경과하지 않은 출금신청 내역의 출금일이나 결제 요청 금액을 변경하기 위한 API입니다.
- 출금일의 변경 가능 스케줄은 출금신청과 동일합니다.  
  ex1) 출금수정 요청시각 24일 16:00일 경우: 27일 출금일 → 25일로 변경 가능  
  ex2) 출금수정 요청시각 24일 18:00일 경우: 27일 출금일 25일로 변경 불가(26일 변경 가능)

#### (1) Request

##### ⑤ Request 샘플

```http
PUT /v1/payments/cms/{transactionId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: application/json; charset=UTF-8

{
    "paymentDate": "20200130",
    "callAmount": 15000
}
```

##### ⑥ Request Body 상세

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| paymentDate | 출금일 | O | 8 | N |
| callAmount | 결제 요청 금액 | O | 12 | N |

#### (2) Response

##### ⑤ Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "payment": {
    "status": "출금대기",
    "transactionId": "TRANSACTION-01",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "paymentDate": "2020/01/30",
    "callAmount": 15000,
    "actualAmount": 0,
    "fee": 0,
    "result": {
      "flag": null,
      "code": null,
      "message": null
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-01"
      }
    ],
  }
}
```

##### ⑥ Response Body 상세

| 항목 | 설명 |
|---|---|
| status | 결제 상태(출금대기, 출금중, 출금실패, 출금성공) |
| transactionId | 거래 ID |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| paymentDate | 출금일 |
| callAmount | 요청 결제 금액 |
| actualAmount | 실제 결제 금액 |
| fee | 수수료 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URL |

### 3) 출금삭제
- 마감시간이 경과되지 않은 출금신청 내역을 삭제하기 위한 API입니다.
- 삭제한 출금신청 내역은 출금조회 API로 조회할 수 없습니다.
- 삭제가능 스케줄은 출금신청과 동일합니다.  
  ex1) 출금삭제 요청시각 24일 16:00일 경우: 출금일 25일 내역은 삭제 가능  
  ex2) 출금삭제 요청시각 24일 18:00일 경우: 출금일 25일 내역은 삭제 불가(26일 내역은 삭제 가능)

#### (1) Request

##### ① Request 샘플

```http
DELETE /v1/payments/cms/{transactionId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
```

##### ② Request Body 상세
- 없음

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 204 No Content
```

##### ② Response Body 상세
- 없음

### 4) 출금조회
- 출금신청 내역을 조회하기 위한 API입니다.

#### (1) Request

##### ① Request 샘플

```http
GET /v1/payments/cms/{transactionId} HTTP/1.1
Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
```

##### ② Request Body 상세
- 없음

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "payment": {
    "status": "출금성공",
    "transactionId": "TRANSACTION-01",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "paymentDate": "2016/01/30",
    "callAmount": 10000,
    "actualAmount": 10000,
    "fee": 250,
    "result": {
      "flag": "Y",
      "code": "Q000",
      "message": "정상"
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-01"
      }
    ]
  }
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| status | 결제 상태(출금대기, 출금중, 출금실패, 출금성공) |
| transactionId | 거래 ID |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| paymentDate | 출금일 |
| callAmount | 요청 결제 금액 |
| actualAmount | 실제 결제 금액 |
| fee | 수수료 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URL |

### 5) 출금 조건 조회
- 등록된 출금신청 내역을 검색 조건에 맞게 조회하기 위한 API입니다.
- 기간 조회의 경우 일별 내역이 다량일 경우 1일 단위의 조회를 권장합니다.  
  (fromPaymentDate 와 toPaymentDate 일자 동일한 값을 설정)
- 페이지(분할) 조회를 사용하고자 할 경우 pageSize, pageNumber를 지정하여 사용합니다.  
  pageSize는 한 페이지당 응답할 데이터 건수를 지정하며,  
  pageNumber는 조회될 페이지 순번을 지정합니다. (페이지 순번은 1부터 시작)
- 조회 1건당 최대 10만건까지 조회 가능합니다.

#### (1) Request

##### ① Request 샘플

```http
GET /v1/payments/cms?fromPaymentDate={YYYYMMDD}
&toPaymentDate={YYYYMMDD}&memberId={memberId}&memberName={memberName}
&pageSize={pageSize}&pageNumber={pageNumber} HTTP/1.1

Host: api.hyosungcms.co.kr (Real)
Host: api-test.hyosungcms.co.kr (Test)
Authorization: VAN {swKey}:{custKey}
Content-Type: application/json; charset=UTF-8
```

##### ② Request 항목

| 항목 | 설명 | 필수(default) | 허용길이 | 허용 값 |
|---|---|---|---|---|
| fromPaymentDate | 검색기간 시작일 (YYYYMMDD 포맷) | X | 8 | N |
| toPaymentDate | 검색기간 종료일 (YYYYMMDD 포맷) | X | 8 | N |
| memberId | 회원 ID | X | 20 | A, N, -, _, (, ) |
| memberName | 회원 이름 | X | 25 | ', ", \ 제외 |
| pageSize | 페이지 당 건수 | X | 5 | N |
| pageNumber | 페이지 순번 (1부터 시작) | X | 5 | N |

- fromPaymentDate와 toPaymentDate는 함께 요청되어야 합니다.
- fromPaymentDate와 toPaymentDate의 기간은 최대 6개월까지 가능합니다.
- pageSize와 pageNumber는 함께 요청되어야 합니다.

#### (2) Response

##### ① Response 샘플

```http
HTTP/1.1 200 Ok
Content-Type: application/json; charset=UTF-8

{
  "totalCnt":3,
  "payments":[
   {
    "status": "출금성공",
    "transactionId": "TRANSACTION-01",
    "memberId": "MEMBER-01",
    "memberName": "홍길동",
    "paymentDate": "2020/01/30",
    "callAmount": 10000,
    "actualAmount": 10000,
    "fee": 250,
    "result": {
      "flag": "Y",
      "code": "0000",
      "message": "정상"
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-01"
      }
    ]
   },
   {
    "status": "출금실패",
    "transactionId": "TRANSACTION-02",
    "memberId": "MEMBER-02",
    "memberName": "홍길자",
    "paymentDate": "2020/01/30",
    "callAmount": 1000,
    "actualAmount": 0,
    "fee": 0,
    "result": {
      "flag": "N",
      "code": "3001",
      "message": "잔액부족"
    },
    }
"links": [
      {
        "rel": "self",
        "href": "https://api.hyosungcms.co.kr/v1/payments/cms/TRANSACTION-02"
      }
    ]
   },
    {
    "status": "출금성공",
    "transactionId": "TRANSACTION-03",
    "memberId": "MEMBER-02",
    "memberName": "홍길자",
    "paymentDate": "2020/01/30",
    "callAmount": 22000,
    "actualAmount": 22000,
    "fee": 0,
    "result": {
      "flag": "Y",
      "code": "0000",
      "message": "정상"
    },
    "links": [
      {
        "rel": "self",
        "href": "https://api. hyosungcms.co.kr/v1/payments/cms/TRANSACTION-03"
      }
    ]
   },
],
"page" : {
  "pageNumber" : 1,
  "pageSize" : 1000,
  "totalPages" : 1,
  "totalCount" : 3
}
}
```

##### ② Response Body 상세

| 항목 | 설명 |
|---|---|
| totalCnt | 데이터 건수 (payments 항목의 데이터 건수) |
| payments | 출금 데이터 상세 |
| page | 페이지 정보 (페이지 요청시) |

- payments 항목 상세

| 항목 | 설명 |
|---|---|
| status | 결제 상태 |
| transactionId | 거래 ID |
| memberId | 회원 ID |
| memberName | 회원 이름 |
| paymentDate | 출금일 |
| callAmount | 요청 결제 금액 |
| actualAmount | 실제 결제 금액 |
| fee | 수수료 |
| result.flag | 처리 결과 |
| result.code | 처리 결과 코드 |
| result.message | 처리 결과 메시지 |
| links | 리소스 URL |

- page 항목 상세 (페이지 요청시만)

| 항목 | 설명 |
|---|---|
| pageNumber | 현재 페이지 순번 (request에서 지정한 값) |
| pageSize | 페이지 당 건수 (request에서 지정한 값) |
| totalPages | 전체 페이지 수 (마지막 pageNumber) |
| totalCount | 전체 데이터 건수 (페이지 처리 없는 경우 전체 데이터 건수) |

---

## 5. 서비스 가능 은행

| 은행명 | 은행코드 (PaymentCompany) | 은행명 | 은행코드 (paymentCompany) |
|---|---|---|---|
| 산업은행 | 002 | 기업은행 | 003 |
| 국민은행 | 004 | 수협중앙회 | 007 |
| 농협은행 | 011 | 우리은행 | 020 |
| SC은행 | 023 | 한국씨티은행 | 027 |
| 대구은행 | 031 | 부산은행 | 032 |
| 광주은행 | 034 | 제주은행 | 035 |
| 전북은행 | 037 | 경남은행 | 039 |
| 새마을금고 | 045 | 신협중앙회 | 048 |
| 우체국 | 071 | KEB하나은행 | 081 |
| 신한은행 | 088 | 유안타증권 | 209 |
| 삼성증권 | 240 | 케이뱅크 | 089 |
| 카카오뱅크 | 090 | 토스뱅크 | 092 |

## 6. 오류코드

| 오류코드 | 오류메시지 | 메시지설명 |
|---|---|---|
| Q000 | 정상 | 정상처리 |
| Q001 | 일부출금 | 부분출금성공 |
| Q101 | 계좌번호오류 | 없는 계좌번호 입니다. |
| Q102 | 해지된계좌 | 해지된 계좌번호 입니다. |
| Q106 | 잔액증명서발급계좌 | 잔액증명서 발행으로 당일출금이 제한되었습니다. |
| Q107 | 법적제한계좌 | 법적제한으로 거래할 수 없는 계좌입니다. |
| Q108 | 출금불가계좌 | 계좌가거래할수없는상태입니다. |
| Q110 | 비밀번호오류횟수초과 | 비밀번호 오류횟수초과로 거래가 중지상태입니다. |
| Q113 | 장기미사용계좌(잡좌) | 장기간 미사용으로 계좌가 휴면상태입니다. |
| Q114 | 계정과목오류 | 자동이체를 사용할 수 없는 유형의 계좌입니다.<br>(적금통장등) |
| Q115 | 자동이체해지(예금주해지) | 예금주에 의하여 자동이체가 해지되었습니다. |
| Q116 | 사망신고계좌 | 사망신고 되어있는 계좌입니다. |
| Q117 | 사고신고계좌 | 사고신고 되어있는 계좌입니다. |
| Q118 | 압류계좌 | 압류 되어있어 거래할 수 없는 계좌입니다. |
| Q119 | 파산신고계좌 | 파산신고 되어있는 계좌입니다. |
| Q120 | 연체계좌 | 연체로 거래할 수 없는 계좌입니다. |
| Q121 | 자동이체미등록계좌 | 자동이체등록이 되어있지 않은 계좌입니다. |
| Q122 | 계정과목또는계좌번호오류 | 자동이체를 사용할 수 없는 유형의 계좌이거나, 없는 계좌번호입니다. |
| Q201 | 생년월일/사업자번호불일치 | 생년월일 또는 사업자번호가 일치하지않습니다. |
| Q202 | 실명미확인계좌 | 실명 미확인된 상태에서 개설된 계좌입니다. |
| Q301 | 잔액부족 | 잔액이 부족하여 출금에 실패하였습니다. |
| Q999 | 기타오류 | 계좌가 거래할 수 없는 상태입니다. |

## 7. 테스트 환경

Web API의 경우 HTTP 사양에 맞춰 요청만 하면 되므로 별도의 샘플 코드는 제공하지 않고 있습니다.  
크롬 브라우저의 플러그인 Postman 툴을 이용하여 request를 분석해 보시면 도움이 될 수 있습니다.

### 1) 주소
- 회원관리, 출금관리: https://api-test.hyosungcms.co.kr
- 동의자료관리: https://add-test.hyosungcms.co.kr

### 2) 인증정보(Authorization Header)
- 인증정보 swKey와 custKey는 효성에프엠에스 서비스운영팀(1599-3945)으로 문의주시기 바랍니다.
- 테스트 API 서버는 효성에프엠에스 등록된 IP 정보만 접근이 가능합니다. 테스트 전 공인IP 정보를 파악해 서비스운영팀으로 등록 요청주시기 바랍니다. (*운영 API 서버는 모든 IP 접근을 허용합니다.)

### 3) 이용기관정보
- custId: apitest

### ※ Postman 사용 가이드
Postman은 HTTP 예제를 손쉽게 생성할 수 있는 프로그램으로 무료로 사용할 수 있습니다.  
단, 효성에프엠에스는 해당 프로그램의 오류 및 기능변경 등과 관련하여 책임을 지지 않습니다.

- Chrome 브라우저를 설치하고 Chrome 웹 스토어에서 postman을 설치합니다.  
  (참고 URL: www.getpostman.com)
- HTTP 메소드와 URL을 입력하고 Headers 탭에서 아래와 같이 Authorization 및 Content-Type을 입력합니다.

![Postman Headers 설정 예시](assets/postman_guide_1.png)

- Body 탭에서 raw를 클릭하고 JSON(application/json)을 선택합니다. 그리고 실제 전송할 JSON을 작성한 뒤에 Send 버튼을 클릭하면 Response를 확인할 수 있습니다.

![Postman Body 설정 예시](assets/postman_guide_2.png)

- Code를 클릭하면 주요 프로그래밍 언어에서 해당 Request를 작성하는 코드 예제를 확인할 수 있습니다.

## 8. 기술지원

기술지원 문의 ☎1599-3945 (통화 가능 시간: 09:00 ~ 18:00)  
기술지원 센터 (https://support.hyosungcms.co.kr)  
*기술지원 센터를 통해 자세한 에러코드 조회 및 최신버전의 기술문서를 다운로드 받으실 수 있습니다.
