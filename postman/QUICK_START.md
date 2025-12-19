# ⚡ Postman 테스트 빠른 시작 (5분)

## 1단계: 테스트 파일 생성 (30초)

```bash
cd /home/pauseb/workspace/almondyoung-server
./postman/generate-test-files.sh
```

**예상 출력:**
```
✅ All test files generated successfully!

📊 Summary:
  - Total files: 20
  - Total size: 10.5M
```

---

## 2단계: Postman Import (1분)

### 방법 A: Collection + Environment 함께 Import

1. Postman 앱 열기
2. **Import** 버튼 클릭
3. 다음 파일들 드래그 앤 드롭:
   - `postman/File-Service-MIME-Validation.postman_collection.json`
   - `postman/File-Service-Local.postman_environment.json`

### 방법 B: CLI로 빠른 Import

```bash
# Postman CLI 설치 (한 번만)
npm install -g postman

# Collection import
postman collection import postman/File-Service-MIME-Validation.postman_collection.json
```

---

## 3단계: JWT 토큰 발급 (2분)

### 옵션 1: cURL로 토큰 발급

```bash
# 로그인 요청
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }' | jq -r '.accessToken'
```

**출력 예시:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

### 옵션 2: Postman에서 직접 로그인

1. 새 요청 생성: `POST {{authUrl}}/login`
2. Body 입력:
   ```json
   {
     "email": "test@example.com",
     "password": "password123"
   }
   ```
3. Send 클릭
4. Response에서 `accessToken` 복사

### 토큰 설정

**Environment에 저장:**
1. Postman 우측 상단: **"File Service - Local Development"** 선택
2. 눈 아이콘 클릭 → **Edit**
3. `authToken` 값에 토큰 붙여넣기
4. **Save** 클릭

**참고:** JWT 토큰에는 `userId` (UUID 형식)가 포함되어 있습니다. 실제 인증 시 JWT에서 자동으로 추출됩니다.

---

## 4단계: 테스트 실행 (1분)

### 전체 테스트 실행

1. Collection 우클릭: **"File Service - MIME Type Validation Tests"**
2. **Run collection** 선택
3. Environment 선택: **"File Service - Local Development"**
4. **Run File Service...** 클릭

### 개별 테스트 실행 (권장)

**첫 테스트:**
```
1. Security Tests 
   → 1.3 Accept JPEG with wrong Content-Type
```

1. 요청 열기
2. Body → form-data → file 선택
3. 파일 경로: `test-files/valid-image.jpg`
4. **Send** 클릭

**예상 응답 (200 OK):**
```json
{
  "id": "01JFABCDEFG...",
  "url": "https://s3.../uploads/...",
  "fileName": "01JFABCDEFG.jpg",
  "size": 635,
  "status": "active",
  "isPublic": false
}
```

---

## 5단계: 결과 확인

### ✅ 성공 케이스 체크

| Test | Expected | Status |
|------|----------|--------|
| 1.3 Accept JPEG | 200 OK | ✅ |
| 2.2 Accept PNG | 200 OK | ✅ |
| 2.3 Accept SVG | 200 OK | ✅ |

### ❌ 실패 케이스 체크

| Test | Expected | Status |
|------|----------|--------|
| 1.1 Reject EXE | 400 Bad Request | ✅ |
| 1.2 Reject HTML | 400 Bad Request | ✅ |
| 6.1 Reject Large File | 400 Bad Request | ✅ |

### 서버 로그 확인

```bash
# File Service 로그 스트림
docker-compose logs -f file-service

# 또는 로컬 실행 중이면
tail -f logs/file-service.log
```

**확인할 로그:**
```
[WARN] Client MIME type not in whitelist - 
Client: application/octet-stream, Detected: image/jpeg. 
File: valid-image.jpg, User: 01932d3e-5678-7abc-9def-0123456789ab, Context: product-image
```

---

## 🐛 문제 해결

### 문제 1: "Cannot read file"

**증상:** Postman에서 파일을 찾을 수 없음

**해결:**
```
1. Postman > Body > form-data
2. "file" 키 타입을 "File"로 변경
3. "Select Files" 버튼으로 직접 선택
4. 절대 경로 사용: /home/pauseb/.../test-files/xxx.jpg
```

---

### 문제 2: "401 Unauthorized"

**증상:** 모든 요청이 401 반환

**해결:**
```bash
# 1. 토큰 만료 확인
# https://jwt.io/ 에서 토큰 디코딩하여 exp 확인

# 2. 새 토큰 발급
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | jq -r '.accessToken'

# 3. Environment에 업데이트
```

---

### 문제 3: "Context not found"

**증상:** 404 "Context product-image not found"

**해결:**
```sql
-- DB에 file_contexts가 있는지 확인
SELECT id, name, is_active, allowed_mime_types 
FROM file_contexts 
WHERE is_active = true;

-- 없으면 migration 실행
npm run migration:run -- --config drizzle.config.ts
```

---

### 문제 4: Server not running

**증상:** "Error: connect ECONNREFUSED"

**해결:**
```bash
# 서버 상태 확인
docker-compose ps

# 없으면 서버 시작
docker-compose up -d file-service

# 또는 로컬 개발 모드
npm run start:dev file-service

# Health check
curl http://localhost:3000/health
```

---

## 📊 예상 결과 (20개 테스트)

```
┌─────────────────────────┬───────────┬───────────┐
│                         │  Executed │    Failed │
├─────────────────────────┼───────────┼───────────┤
│              Iterations │         1 │         0 │
├─────────────────────────┼───────────┼───────────┤
│                Requests │        20 │         0 │
├─────────────────────────┼───────────┼───────────┤
│            Test Scripts │        20 │         0 │
├─────────────────────────┼───────────┼───────────┤
│      Assertion (Tests)  │        47 │         0 │
├─────────────────────────┴───────────┴───────────┤
│ Total run duration: 3.2s                        │
└─────────────────────────────────────────────────┘
```

---

## 🚀 다음 단계

### CLI로 자동화

```bash
# Newman 설치
npm install -g newman newman-reporter-htmlextra

# 테스트 실행 + HTML 리포트
newman run postman/File-Service-MIME-Validation.postman_collection.json \
  -e postman/File-Service-Local.postman_environment.json \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export test-report.html

# 리포트 열기
open test-report.html  # macOS
xdg-open test-report.html  # Linux
```

### CI/CD 통합

```yaml
# .github/workflows/api-tests.yml
- name: Run Postman Tests
  run: |
    ./postman/generate-test-files.sh
    newman run postman/File-Service-MIME-Validation.postman_collection.json \
      -e postman/File-Service-Local.postman_environment.json \
      --bail
```

---

## 📚 더 알아보기

- **상세 가이드:** `postman/README.md`
- **구현 계획:** `public-file-implementation.plan.md`
- **API 문서:** `http://localhost:3000/api/docs` (Swagger)

---

**소요 시간:** 총 5분  
**테스트 커버리지:** 20개 케이스  
**성공률 목표:** 100%

문제 발생 시: Slack #dev-support 채널 또는 GitHub Issue

