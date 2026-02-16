# Wallet Rebuild - HMAC Integrity (Draft)

## 1. Purpose

이 문서는 `CreatePaymentIntent` 요청의 주문 스냅샷 무결성 검증 규칙을 정의한다.
목표는 SoT(판매채널/청구 서비스)가 계산한 결제 스냅샷이 Wallet에 전달될 때 동일성(deterministic integrity)을 보장하는 것이다.

## 2. Scope

- 본 문서는 `01`, `03`, `04` 문서를 전제로 한다.
- 적용 대상:
  - HTTP: `POST /v1/intents`
  - Command: `CreatePaymentIntent`
- 검증 대상 필드:
  - `snapshotPayload`
  - `signature`
  - `signatureVersion`
  - `signedAt`

## 3. v1 Security Decisions

- 알고리즘: `HMAC-SHA256` 단일 고정
- 키 운영: 단일 공유 HMAC 키(키 로테이션 없음)
- 인코딩: UTF-8
- 서명 포맷: Base64URL(no padding) 권장
- 비교 방식: 상수 시간 비교(constant-time compare) 필수

## 4. Snapshot Canonicalization

`snapshotPayload`는 canonical JSON으로 직렬화한 뒤 해시/서명한다.

canonicalization 규칙(v1):

1. JSON object key는 사전순 정렬
2. 공백/개행 제거(minified JSON)
3. 문자열은 UTF-8 기준 직렬화
4. 금액 필드는 minor unit 정수만 허용 (`KRW` 기준 원 단위 정수)
5. 숫자는 지수표기 금지
6. `null`/빈값 필드는 SoT 규약에 맞춰 명시적으로 포함 또는 제외를 고정

권장 구현:

- SoT와 Wallet이 동일 canonicalizer 라이브러리/규칙을 공유
- 테스트 벡터(JSON 입력/출력/해시)를 문서화해 회귀 테스트에 포함

## 5. Signing Input and Signature

## 5.1 Payload Hash

- `payloadHash = SHA256(canonicalSnapshotPayload)` (hex lower-case)

## 5.2 Signing String (v1)

아래 문자열을 개행(`\n`)으로 결합한다.

1. `signatureVersion`
2. `signedAt` (ISO-8601 UTC)
3. `payloadHash`

예시:

```text
v1
2026-02-14T12:34:56.000Z
2c26b46b68ffc68ff99b453c1d30413413422f1640b...
```

## 5.3 Signature

- `signature = HMAC_SHA256(sharedSecret, signingString)`
- 결과는 Base64URL(no padding)로 인코딩해 전달

## 6. Verification Procedure

Wallet 검증 순서(v1 고정):

1. 필수 필드 존재 검증
2. `signatureVersion == "v1"` 검증
3. `signedAt` 파싱/유효시간 검증
4. `snapshotPayload` canonicalization
5. `payloadHash` 계산
6. 동일 signing string 재구성
7. 서버측 HMAC 계산
8. 상수 시간 비교로 `signature` 검증
9. 통과 시 Intent 생성 로직 진행

검증 실패 시 DB write 전에 즉시 요청 거절

## 7. Freshness and Replay Controls

v1은 아래 3개로 replay를 억제한다.

1. `signedAt` 유효 시간 제한
2. `Idempotency-Key` 기반 중복 요청 제어
3. 동일 `referenceType + referenceId`의 reference-blocking intent 단일화

## 7.1 Time Window

- 허용 시계 오차: ±60초
- 서명 유효시간: `signedAt` 기준 5분
- 범위 초과 시 거절

## 7.2 Idempotency Interaction

- 동일 `Idempotency-Key` + 동일 요청은 저장된 응답 반환
- 동일 키 + 상이 요청은 `409 Conflict`
- HMAC 검증 실패는 멱등 처리 대상 이전 단계에서 실패 처리

## 8. Error Handling Policy

권장 에러 코드:

- `SIGNATURE_VERSION_UNSUPPORTED`
- `SIGNATURE_TIMESTAMP_INVALID`
- `SIGNATURE_EXPIRED`
- `SNAPSHOT_CANONICALIZATION_FAILED`
- `SNAPSHOT_HASH_MISMATCH`
- `INVALID_SIGNATURE`

응답 원칙:

- 외부 응답에는 키/서명 원문을 노출하지 않음
- 내부 로그에는 진단 가능한 최소 메타정보만 기록
  - `correlationId`
  - `referenceType`, `referenceId`
  - `signedAt`
  - 실패 코드

## 9. Operational Guidelines

- 공유 HMAC 키는 서비스 설정/시크릿 환경변수로 주입
- 키는 코드/저장소에 하드코딩 금지
- 개발/스테이징/운영 환경별 키 분리
- 장애 대응을 위해 검증 실패율 메트릭을 수집

권장 메트릭:

- `hmac_verify_total`
- `hmac_verify_failed_total{reason}`
- `hmac_verify_latency_ms`

## 10. Test Vectors (Required)

최소 테스트 케이스:

1. 정상 서명 검증 성공
2. payload 변조 시 실패
3. signature 변조 시 실패
4. `signedAt` 만료 시 실패
5. 시계 오차 허용 경계값 테스트
6. key/secret 누락 환경에서 실패

## 11. Open Decisions

- 현재 없음
