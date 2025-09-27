---
title: AlmondYoung BNPL API Documentation v1.0.0
language_tabs:
  - shell: Shell
  - http: HTTP
  - javascript: JavaScript
  - ruby: Ruby
  - python: Python
  - php: PHP
  - java: Java
  - go: Go
toc_footers: []
includes: []
search: true
highlight_theme: darkula
headingLevel: 2

---

<!-- Generator: Widdershins v4.0.1 -->

<h1 id="almondyoung-bnpl-api-documentation">AlmondYoung BNPL API Documentation v1.0.0</h1>

> Scroll down for code samples, example requests and responses. Select a language for code samples from the tabs above or the mobile navigation menu.

BNPL(나중결제) 시스템의 API 문서입니다. 결제 프로필 생성, 결제 처리, 환불 등의 기능을 제공합니다.

Base URLs:

* <a href="https://api.almondyoung.com">https://api.almondyoung.com</a>

<h1 id="almondyoung-bnpl-api-documentation-auth">Auth</h1>

## postSignup

<a id="opIdpostSignup"></a>

`POST /signup`

*회원가입 API*

아이디와 패스워드를 받아 회원가입을 수행합니다.

> Body parameter

```json
{
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "example": "username",
      "description": "사용자 이름"
    },
    "password": {
      "type": "string",
      "example": "P@ssw0rd123!@#",
      "description": "패스워드"
    }
  },
  "required": [
    "username",
    "password"
  ]
}
```

<h3 id="postsignup-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|body|body|object|true|none|
|» username|body|string|true|사용자 이름|
|» password|body|string|true|패스워드|

> Example responses

> 회원가입 성공

```json
{
  "message": "user created"
}
```

> 아이디 누락 시 실패

```json
{
  "error": {
    "message": "아이디 누락 시 실패",
    "code": "ERROR_400"
  }
}
```

```json
{
  "error": {
    "message": "패스워드가 8자 미만이면 실패",
    "code": "ERROR_400"
  }
}
```

<h3 id="postsignup-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|201|[Created](https://tools.ietf.org/html/rfc7231#section-6.3.2)|회원가입 성공|Inline|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|아이디 누락 시 실패|Inline|

<h3 id="postsignup-responseschema">Response Schema</h3>

Status Code **201**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» message|string|true|none|성공 메시지|

Status Code **400**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» error|string|true|none|에러 메시지|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

<h1 id="almondyoung-bnpl-api-documentation-user">User</h1>

## getUsersByuserid

<a id="opIdgetUsersByuserid"></a>

`GET /users/:userId`

*사용자 조회 API*

특정 사용자의 상세 정보를 조회합니다.

<h3 id="getusersbyuserid-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|userId|path|string|true|유효한 사용자 ID|

> Example responses

> 유효한 사용자 ID면 200 응답

```json
{
  "userId": "penek",
  "username": "hun",
  "email": "penekhun@gmail.com",
  "friends": [
    "zagabi",
    "json"
  ]
}
```

> 존재하지 않는 사용자면 404 응답

```json
{
  "error": {
    "message": "존재하지 않는 사용자면 404 응답",
    "code": "ERROR_404"
  }
}
```

<h3 id="getusersbyuserid-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|유효한 사용자 ID면 200 응답|Inline|
|404|[Not Found](https://tools.ietf.org/html/rfc7231#section-6.5.4)|존재하지 않는 사용자면 404 응답|Inline|

<h3 id="getusersbyuserid-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» userId|string|true|none|유저 ID|
|» username|string|true|none|유저 이름|
|» email|string(email)|true|none|유저 이메일|
|» friends|[string]|true|none|유저의 친구|

Status Code **404**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» error|string|true|none|에러 메시지|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

<h1 id="almondyoung-bnpl-api-documentation-payment">Payment</h1>

## postV2PaymentsIntents

<a id="opIdpostV2PaymentsIntents"></a>

`POST /v2/payments/intents`

*결제 의도 생성*

결제를 위한 Intent를 생성합니다.

> Body parameter

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Intent ID"
    },
    "customerId": {
      "type": "string",
      "example": "0N0WXWY6TSNM8",
      "description": "고객 ID"
    },
    "amount": {
      "type": "integer",
      "example": 150000,
      "description": "결제 금액"
    },
    "type": {
      "type": "string",
      "example": "ORDER",
      "description": "결제 타입"
    }
  },
  "required": [
    "id",
    "customerId",
    "amount",
    "type"
  ]
}
```

<h3 id="postv2paymentsintents-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|body|body|object|true|none|
|» id|body|string|true|Intent ID|
|» customerId|body|string|true|고객 ID|
|» amount|body|integer|true|결제 금액|
|» type|body|string|true|결제 타입|

> Example responses

> 결제 의도 생성 성공

```json
{
  "customerId": "0N0WXWY6TSNM8",
  "amount": 150000,
  "type": "ORDER"
}
```

> 필수 필드 누락 시 실패

```json
{
  "error": {
    "message": "필수 필드 누락 시 실패",
    "code": "ERROR_400"
  }
}
```

<h3 id="postv2paymentsintents-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|201|[Created](https://tools.ietf.org/html/rfc7231#section-6.3.2)|결제 의도 생성 성공|Inline|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|필수 필드 누락 시 실패|Inline|

<h3 id="postv2paymentsintents-responseschema">Response Schema</h3>

Status Code **201**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» customerId|string|true|none|고객 ID|
|» amount|integer|true|none|결제 금액|
|» type|string|true|none|결제 타입|

Status Code **400**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» statusCode|integer|true|none|상태 코드|
|» message|string|true|none|에러 메시지|
|» errors|[object]|true|none|에러 목록|
|»» code|string|true|none|코드|
|»» expected|string|true|none|예상 타입|
|»» received|string|true|none|받은 값|
|»» path|[string]|true|none|에러 경로|
|»» message|string|true|none|에러 메시지|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

