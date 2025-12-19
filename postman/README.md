# File Service Postman Test Guide

## 📋 Overview

이 컬렉션은 **File Service의 MIME Type Validation** 기능을 포괄적으로 테스트합니다.

**테스트 범위:**
- ✅ Security Tests (악성 파일 차단)
- ✅ Practical Compatibility (MIME 타입 호환성)
- ✅ Fallback Cases (텍스트 기반 파일)
- ✅ Wildcard Pattern Matching (image/*, */*)
- ✅ Public/Private Access Control
- ✅ Edge Cases & Validation

---

## 🚀 Quick Start

### 1. Postman에 Collection Import

```bash
# Postman 앱 열기 > Import > 파일 선택
File-Service-MIME-Validation.postman_collection.json
```

### 2. 환경 변수 설정

Collection Variables에서 다음 값을 수정:

| Variable | Value | Description |
|----------|-------|-------------|
| `baseUrl` | `http://localhost:3000/api/files` | File Service API 베이스 URL |
| `authToken` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | JWT 인증 토큰 |
| `userId` | `01932d3e-5678-7abc-9def-0123456789ab` | 테스트용 사용자 UUID (JWT에서 추출됨) |

**JWT 토큰 발급 방법:**

```bash
# 로그인 API 호출하여 토큰 받기
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 응답에서 accessToken 복사하여 authToken 변수에 입력
```

### 3. 테스트 파일 준비

프로젝트 루트에 `test-files/` 폴더를 만들고 아래 스크립트로 테스트 파일 생성:

```bash
cd /home/pauseb/workspace/almondyoung-server
./postman/generate-test-files.sh
```

---

## 📁 테스트 파일 구조

다음 파일들이 `test-files/` 디렉토리에 필요합니다:

```
test-files/
├── malicious.exe.jpg          # EXE 파일 (.jpg로 위장)
├── malicious.html             # HTML 파일 (image로 전송됨)
├── valid-image.jpg            # 정상 JPEG
├── image-with-wrong-mime.jpg  # JPEG (잘못된 Content-Type)
├── valid-image.png            # 정상 PNG
├── image.svg                  # SVG 이미지
├── image.webp                 # WebP 이미지
├── photo.jpg                  # 다른 JPEG 샘플
├── document.txt               # 텍스트 파일
├── data.csv                   # CSV 파일
├── config.json                # JSON 파일
├── document.pdf               # PDF 문서
├── receipt-scan.png           # 영수증 PNG
├── public-image.jpg           # Public 테스트용 이미지
├── private-document.pdf       # Private 테스트용 PDF
└── large-file.bin             # 크기 제한 테스트용 큰 파일
```

---

## 🛠️ 테스트 파일 생성 스크립트

### 자동 생성 스크립트 (Linux/Mac)

`postman/generate-test-files.sh` 파일을 실행하세요:

```bash
chmod +x postman/generate-test-files.sh
./postman/generate-test-files.sh
```

### 수동 생성 (Windows/기타)

```bash
mkdir -p test-files

# 1. 정상 이미지 파일들 (실제 이미지 파일 복사 또는 생성)
# JPG, PNG, SVG, WebP 파일들을 test-files/에 복사

# 2. 악성 파일 시뮬레이션
# EXE 시그니처를 가진 파일 생성
echo -ne '\x4D\x5A\x90\x00' > test-files/malicious.exe.jpg

# HTML 파일 생성 (image로 위장될 예정)
cat > test-files/malicious.html << 'EOF'
<!DOCTYPE html>
<html><body><script>alert('XSS')</script></body></html>
EOF

# 3. 텍스트 기반 파일들
echo "Hello, this is a test file." > test-files/document.txt

cat > test-files/data.csv << 'EOF'
id,name,price
1,Product A,1000
2,Product B,2000
EOF

cat > test-files/config.json << 'EOF'
{
  "setting": "value",
  "enabled": true
}
EOF

# 4. 큰 파일 (10MB, 크기 제한 테스트용)
dd if=/dev/zero of=test-files/large-file.bin bs=1M count=10

# 5. PDF 파일 (실제 PDF 파일 복사 필요)
# 또는 간단한 PDF 생성:
# echo "%PDF-1.4" > test-files/document.pdf
# echo "%EOF" >> test-files/document.pdf
```

---

## 📊 테스트 실행

### 전체 테스트 실행

1. Postman에서 Collection 우클릭
2. "Run collection" 선택
3. "Run File Service - MIME Type Validation Tests" 클릭

### 개별 폴더 실행

특정 테스트 그룹만 실행:
- `1. Security Tests` - 보안 검증
- `2. Practical Compatibility Tests` - MIME 타입 호환성
- `3. Fallback Cases` - 텍스트 파일 검증
- `4. Wildcard Pattern Tests` - 패턴 매칭
- `5. Public/Private Access Tests` - 접근 제어
- `6. Edge Cases & Validation` - 엣지 케이스

### CLI 실행 (Newman)

```bash
# Newman 설치
npm install -g newman

# 전체 테스트 실행
newman run File-Service-MIME-Validation.postman_collection.json \
  --env-var "baseUrl=http://localhost:3000/api/files" \
  --env-var "authToken=YOUR_JWT_TOKEN"

# HTML 리포트 생성
newman run File-Service-MIME-Validation.postman_collection.json \
  --reporters cli,html \
  --reporter-html-export test-results.html
```

---

## ✅ 예상 테스트 결과

### Security Tests (3개)
- ✅ 1.1: EXE 파일 차단 (400 Bad Request)
- ✅ 1.2: HTML 파일 차단 (400 Bad Request)
- ✅ 1.3: JPEG 허용 + 경고 (200 OK, 서버 로그에 경고)

### Practical Compatibility Tests (3개)
- ✅ 2.1: 비표준 MIME (image/jpg) 허용 (200 OK)
- ✅ 2.2: 정상 PNG 허용 (200 OK)
- ✅ 2.3: SVG 허용 (image/* 와일드카드 매칭, 200 OK)

### Fallback Cases (3개)
- ✅ 3.1: TXT 파일 허용 (200 OK)
- ✅ 3.2: CSV 파일 허용 (200 OK)
- ✅ 3.3: JSON 파일 허용 (200 OK)

### Wildcard Pattern Tests (4개)
- ✅ 4.1: image/* → JPEG 허용
- ✅ 4.2: image/* → WebP 허용
- ✅ 4.3: application/pdf + image/* → PDF 허용
- ✅ 4.4: application/pdf + image/* → PNG 허용

### Public/Private Access Tests (4개)
- ✅ 5.1: Public 파일 업로드 (200 OK)
- ✅ 5.2: Public 파일 비인증 접근 (200 OK)
- ✅ 5.3: Private 파일 업로드 (200 OK)
- ✅ 5.4: Private 파일 비인증 접근 차단 (404 Not Found)

### Edge Cases (3개)
- ✅ 6.1: 파일 크기 초과 (400 Bad Request)
- ✅ 6.2: 잘못된 contextId (404 Not Found)
- ✅ 6.3: 파일 누락 (400 Bad Request)

**총 테스트:** 20개

---

## 🔍 디버깅 가이드

### 테스트 실패 시 체크리스트

#### 1. JWT 토큰 문제
```bash
# 토큰이 만료되었는지 확인
# JWT Debugger: https://jwt.io/

# 새 토큰 발급
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}'
```

#### 2. 서버 로그 확인
```bash
# File Service 로그 확인
docker-compose logs -f file-service

# 또는 로컬 실행 시
npm run start:dev file-service
```

#### 3. 데이터베이스 확인
```sql
-- file_contexts가 제대로 설정되었는지 확인
SELECT id, name, allowed_mime_types, max_size 
FROM file_contexts 
WHERE is_active = true;

-- 업로드된 파일 확인
SELECT id, file_name, mime_type, status, is_public 
FROM uploads 
ORDER BY created_at DESC 
LIMIT 10;
```

#### 4. S3/Storage 확인
```bash
# AWS S3 버킷 확인 (환경변수)
echo $AWS_S3_BUCKET_PUBLIC
echo $AWS_S3_BUCKET_PRIVATE

# MinIO 사용 시 (로컬 개발)
# http://localhost:9001 접속하여 버킷 확인
```

---

## 📝 테스트 케이스별 상세 설명

### 1.1 Reject EXE disguised as JPG
**목적:** 확장자만 바꾼 악성 파일 차단  
**검증:** Magic number (MZ90) 기반으로 실제 타입 감지  
**예상 응답:** 400 "Invalid file type for product-image"

### 1.3 Accept JPEG with wrong Content-Type
**목적:** 실제 내용이 올바르면 Content-Type이 틀려도 허용  
**검증:** 
- Detected MIME (image/jpeg) → ✅ Pass
- Client MIME (application/octet-stream) → ⚠️ Warning (서버 로그)

**서버 로그 예시:**
```
[WARN] Client MIME type not in whitelist - 
Client: application/octet-stream, Detected: image/jpeg. 
File: test.jpg, User: 01932d3e-5678-7abc-9def-0123456789ab, Context: product-image
```

### 2.3 Accept SVG (wildcard)
**목적:** `image/*` 와일드카드가 `image/svg+xml` 매칭  
**검증:** 
- Pattern: `image/*`
- Actual: `image/svg+xml`
- Split on `/` → `image` === `image` ✅

### 3.1-3.3 Fallback Cases
**목적:** Magic number가 없는 텍스트 파일은 Content-Type으로 검증  
**검증:**
- `file-type` 라이브러리가 `null` 반환
- Client Content-Type으로 fallback 검증

---

## 🐛 알려진 이슈 & 해결방법

### Issue 1: "File is required" 에러
**원인:** Postman에서 파일 경로 문제  
**해결:**
```
1. Postman에서 Body > form-data 탭
2. "file" 키의 타입을 "File"로 설정
3. "Select Files" 클릭하여 파일 직접 선택
```

### Issue 2: 401 Unauthorized
**원인:** JWT 토큰 만료 또는 누락  
**해결:**
```javascript
// Pre-request Script에 추가 (Collection 레벨)
const token = pm.collectionVariables.get('authToken');
if (!token || token === 'YOUR_JWT_TOKEN_HERE') {
    throw new Error('Please set valid authToken in Collection Variables');
}
```

### Issue 3: 테스트 파일 경로 에러
**원인:** 상대 경로 문제  
**해결:** Postman에서 절대 경로 사용
```
/home/pauseb/workspace/almondyoung-server/test-files/valid-image.jpg
```

---

## 📊 CI/CD 통합

### GitHub Actions 예시

```yaml
name: File Service API Tests

on: [push, pull_request]

jobs:
  postman-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup test files
        run: ./postman/generate-test-files.sh
      
      - name: Install Newman
        run: npm install -g newman
      
      - name: Run API Tests
        run: |
          newman run postman/File-Service-MIME-Validation.postman_collection.json \
            --env-var "baseUrl=${{ secrets.TEST_API_URL }}" \
            --env-var "authToken=${{ secrets.TEST_JWT_TOKEN }}" \
            --reporters cli,json \
            --reporter-json-export test-results.json
      
      - name: Upload Test Results
        uses: actions/upload-artifact@v3
        with:
          name: newman-results
          path: test-results.json
```

---

## 🎯 추가 테스트 아이디어

현재 컬렉션을 확장하려면:

### 1. 동시성 테스트
```javascript
// 같은 파일을 여러 번 동시 업로드
pm.sendRequest({
    url: pm.variables.get('baseUrl') + '/upload',
    method: 'POST',
    // ...
});
```

### 2. 대용량 파일 테스트
```bash
# 100MB 파일 생성
dd if=/dev/zero of=test-files/large-100mb.bin bs=1M count=100

# context별 max_size 한계 테스트
```

### 3. 파일 메타데이터 테스트
```json
{
    "contextId": "product-image",
    "metadata": {
        "productId": "prod-123",
        "category": "electronics"
    }
}
```

### 4. Rate Limiting 테스트
```javascript
// 짧은 시간에 여러 요청 전송
for (let i = 0; i < 100; i++) {
    pm.sendRequest(/* ... */);
}
```

---

## 📚 참고 자료

- **계획 문서:** `public-file-implementation.plan.md`
- **File-type 라이브러리:** https://github.com/sindresorhus/file-type
- **Postman 문서:** https://learning.postman.com/docs/
- **Newman (CLI):** https://learning.postman.com/docs/running-collections/using-newman-cli/

---

## 🤝 기여하기

새로운 테스트 케이스 추가 시:

1. Collection JSON에 테스트 추가
2. `generate-test-files.sh`에 필요한 파일 생성 로직 추가
3. 이 README에 테스트 케이스 문서화
4. PR 생성 with 스크린샷

---

**작성일:** 2025-12-18  
**버전:** 1.0  
**담당자:** CTO Team

