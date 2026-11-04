# 실측 사진 → ChatGPT → GLB 등록 설계

## 목적

실측 작업 현황(`/inventory/sku-field-capture`)의 찍은 사진 카드에서 바로 3D 모델 작업을 끝낸다.
관리자가 PC에서 버튼 하나로 ChatGPT 앱에 사진 전부와 프롬프트를 넘기고, 앱 안에서
모델을 돌려 보며 고친 뒤 받은 GLB 를 같은 카드에 올려 고객에게 공개한다.

성공 기준

- 카드의 `지피티로 가기` 한 번으로 그 SKU 사진 전부가 내려받기 폴더에 저장되고, ChatGPT 앱이 그 폴더를 작업 폴더로 잡은 새 채팅에 프롬프트를 채운 채 열린다. 전송은 사람이 누른다.
- `GLB 업로드` 로 파일을 고르고 확인하면 승인된 새 버전이 생기고, 판매 중인 상품에 연결된 SKU 면 스토어프론트 상품 상세에 `3D로 보기` 가 생긴다.
- `상세` 는 SKU 마스터 관리에서 그 SKU 를 걸러 연다.

## 사용자가 정한 것

| 항목 | 결정 |
|---|---|
| 사진 전달 | 사진 전부를 원본 파일로 첨부. 합친 이미지·링크 아님 |
| 사진 수 | 6장이 넘어도 전부 넣는다. 작업 계정은 유료 |
| 미리보기 | ChatGPT 앱 안에서 드래그로 확인하고 고친다. 어드민 뷰어는 만들지 않는다 |
| 연결 대상 | ChatGPT 앱(macOS). 웹은 확장 프로그램 설치가 필요해 PC마다 설치 부담이 커서 접었다(2026-11-04) |
| 업로드 후 상태 | 확인창을 거쳐 바로 `approved` |
| 상세 이동 | `/inventory/skus?code=<SKU 코드>` |
| 고객 화면 | 스토어프론트의 기존 `model3d-viewer` 그대로. 변경 없음 |

## 실측으로 확인한 제약 (2026-11-02)

| 시도 | 결과 |
|---|---|
| 클립보드에 이미지 여러 개 | Chrome 이 막는다 (`Support for multiple ClipboardItems is not implemented`) |
| 이미지 + 글자 한 번에 붙여넣기 | 글자만 들어가고 이미지는 버려진다 |
| `chatgpt.com/?q=` | 입력창에 채우지 않고 바로 전송한다 (비로그인에서 확인) |
| ChatGPT 페이지 안에서 파일 입력에 여러 장 넣기 + 프롬프트 입력 | 된다. 전송은 되지 않는다 |
| ChatGPT 페이지에서 사진 URL fetch | 실패. 페이지 보안 정책으로 보인다 |
| 첨부 수 | Free 계정에서 8장 중 6장만 붙었다. 유료 한도는 미확인 |

그래서 웹(chatgpt.com)은 Chrome 확장 프로그램 없이는 사진을 넣을 수 없다. 확장은 PC마다 개발자 모드로 설치해야 해서 접고,
ChatGPT 앱의 딥링크 `codex://threads/new?path=<폴더>&prompt=<프롬프트>` 를 쓴다. 이 링크는 그 폴더를 작업 폴더로 잡은 새 채팅을 열고 프롬프트를 채우기만 한다(전송 안 함, 2026-11-04 실측).

## 구성

### 1. 어드민 카드 (admin-web)

`features/inventory/sku-field-capture/photo-gallery.tsx` 의 상품 카드 머리줄 오른쪽에 버튼 셋과 3D 상태 표시를 더한다.

- 3D 상태: 기존 `GET /inventory/sku-3d-models/skus/:skuId` 의 최신 `approved` 버전. `3D 공개 중 · vN` / `3D 없음`.
  카드마다 한 번 부른다. 페이지당 카드 수가 늘어 느려지면 사진 목록 응답에 요약을 싣는 것으로 바꾼다.
- `지피티로 가기`
  - 사진과 치수는 기간 필터와 무관하게 `getDetail(skuId)` 로 다시 받는다(사진 전부, 포장 치수·무게).
  - 가로·세로·높이·무게 중 하나라도 없으면 버튼을 막고 이유를 툴팁으로 보인다.
  - 처음 누를 때 내려받기 폴더 경로를 묻는다(§3).
- `GLB 업로드` / 이미 공개면 `GLB 다시 올리기`
  1. 파일 고르기. `.glb` 가 아니거나 20 MiB 초과면 바로 안내하고 끝.
  2. 확인창: 상품명, 파일 이름·용량, 버전 변화(`v2 → v3`), 공개 안내.
  3. `공개하기` → file-service 업로드(`contextId: 'sku-3d-model'`, `isPublic: true`) → `POST /inventory/sku-3d-models/skus/:skuId` `{ glbFileId, status: 'approved' }`.
  - Mac Chrome 은 `.glb` 의 `file.type` 을 비워 보내 `application/octet-stream` 으로 올라가고, 승인 검증(`mimeType === 'model/gltf-binary'`)에서 거부된다. 업로드 전에 `new File([f], f.name, { type: 'model/gltf-binary' })` 로 감싼다.
  - 업로드 클라이언트는 기존 `uploadFileToFileService` 를 쓴다. 새 컨텍스트 상수 `SKU_3D_MODEL_CONTEXT_ID` 만 더한다.
- `상세`: `/inventory/skus?code=<code>` 새 탭.
- 권한: 페이지는 `inventory.master.read`. 업로드 뮤테이션 훅은 `permission: 'inventory.master.write'` 를 선언하고 버튼은 `run={useX}` 로 판정한다(`mutation-guard.gate.spec.ts`).
- 클라이언트: `lib/api/domains/inventory/sku-3d-models.client.ts` (`list`, `register`).

### 2. 프롬프트 틀

admin-web 에 순수 함수 하나(`buildModelPrompt(detail)`)로 둔다. 값은 상품명, SKU 코드, 사진 수, 가로·세로·높이(mm), 무게(g).
본문은 사용자가 준 프롬프트에서 2·3·4·7번을 고친 판이다(대화 기록 기준).

```text
이 폴더의 {SKU 코드}-1 ~ {SKU 코드}-{사진 수} 상품 사진 {사진 수}장과 실측 정보를 참고해
실제 외형을 재현한 3D 모델을 GLB 파일로 직접 만들어 줘.

상품명: {상품명}
SKU: {SKU 코드}
가로: {가로}mm
세로: {세로}mm
높이: {높이}mm
무게: {무게}g

조건:
1. 이미지 생성이나 외부 3D 생성 서비스를 쓰지 말고
   Python 코드로 메시를 직접 만들어.
2. 먼저 사진을 보고 상품의 실제 형태를 판단해.
   단순한 상자로 대체하지 말고, 사진에 보이는 몸체 형태,
   뚜껑·입구, 홈, 돌출부, 윗면·밑면 등 구조를 재현해.
   상자나 납작한 판처럼 실제로 단순한 상품은 그 형태 그대로 만들어.
3. 전체 외곽 치수는 {가로}×{세로}×{높이}mm로 맞추고,
   GLB에는 미터 단위로 적용해. 무게는 메타데이터로 기록해.
4. 사진 방향은 실제 사진을 보고 판단해.
   라벨과 표면은 원본 사진을 상품 표면에 맞게 입히고,
   글자·로고·바코드를 다시 그리거나 수정하지 마.
5. 텍스처를 GLB 안에 포함하고 파일은 5MB 이하로 만들어.
6. 치수, 글자 방향, 표면 겹침과 파일 오류를 확인해.
   사진만으로 추정한 세부 형상은 간단히 밝혀.
7. 결과는 이 폴더에 {SKU 코드}.glb 와 Python 원본으로 저장하고,
   드래그로 돌려 볼 수 있는 3D 미리보기를 열어 보여 줘.
   공개 사이트로 게시하지 말고, 내가 수정을 요청하면 고쳐서 다시 저장해 줘.
```

치수는 실측 화면의 포장 치수다. 본체 치수와 다를 수 있다는 점은 프롬프트가 아니라 운영 문서(`docs/inventory/sku-3d-models.md`)의 기존 원칙을 따른다.

### 3. ChatGPT 앱 연결

- 처음 누를 때 내려받기 폴더 경로를 한 번 묻고 브라우저에 기억한다(`sku-field-capture:downloads-folder`). 웹페이지는 내 컴퓨터 경로를 알 수 없어서다.
- `getDetail` 로 최신 사진·치수를 받고, `codex://threads/new?path=<폴더>&prompt=<프롬프트>` 를 연 뒤 사진을 `{SKU 코드}-{순번}.{확장자}` 로 내려받는다.
- 프롬프트는 첨부 대신 "이 폴더의 {코드}-1 ~ {코드}-N 사진" 을 가리키고, 결과를 같은 폴더에 `{코드}.glb` 와 Python 원본으로 저장하게 한다.
- 공개 사진 경로(`/api/proxy/file/files/public/`)는 다른 오리진으로 리다이렉트되므로, 브라우저 추적 헤더(`traceparent`)를 붙이지 않는다. 붙이면 CORS 사전 확인에서 막힌다.

### 4. 고객 화면

스토어프론트 변경 없음. 승인 → core outbox → channel-adapter → Medusa `metadata.model3dFileId` → 상품 상세 사진 아래 `3D로 보기`. 대표 옵션 하나의 모델만 보인다.

## 하지 않는 것

- 어드민 3D 뷰어, 검수 대기 상태, 버전 이력 화면
- ChatGPT 웹 연동(확장 프로그램), 자동 전송
- 3D 내리기 버튼. 필요하면 기존 `PUT /inventory/sku-3d-models/:id/review` 로 따로 붙인다

## 테스트

- `buildModelPrompt`: 값 치환, 치수 누락 판정 단위 테스트.
- 업로드 흐름: `.glb` MIME 보정, 20 MiB 초과 거부, 확인 취소 시 업로드 안 함.
- 권한 게이트: `mutation-guard.gate.spec.ts` 가 새 훅을 통과.
- 앱 연결: 앱 링크의 폴더·프롬프트, 폴더 경로를 한 번만 묻는지, 사진 내려받기 순서와 실패 안내.

## 남은 위험

- ChatGPT 앱의 `codex://` 딥링크는 공개 문서가 없는 앱 내부 경로라 앱 업데이트로 바뀔 수 있다.
- 내려받기 폴더에 같은 이름 파일이 있으면 크롬이 `(1)` 을 붙여 저장한다. 프롬프트의 파일 이름과 어긋날 수 있다.
- 앱이 3D 미리보기를 안정적으로 보여 주는지 미확인.
