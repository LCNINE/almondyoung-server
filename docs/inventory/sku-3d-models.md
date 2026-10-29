# SKU 3D 모델 운영

이슈: https://github.com/LCNINE/almondyoung-server/issues/1164

## 배포

core와 file-service의 마이그레이션을 먼저 적용한 뒤 서비스를 배포한다.
기존 상품 썸네일과 목록 화면은 바꾸지 않는다.
file-service 마이그레이션은 기존 환경에도 `sku-3d-model` 컨텍스트 행을 넣는다.
시드만 실행하고 라이브 반영을 완료했다고 판단하지 않는다.

등록 컨텍스트는 공개 전용이며 MIME은 `model/gltf-binary`다.
업로드 상한은 20 MiB이며 목표 용량은 5 MiB 이하다.
상한은 다운로드 크기의 제한이고 GPU 메모리 사용량을 보장하지 않는다.

공개 파일 GET/HEAD 리다이렉트와 최종 스토리지 응답 모두 CORS를 허용해야 한다.
GLB는 이미지 태그와 달리 브라우저의 `fetch`로 받는다.
관리형 데모 공개 버킷은 GET/HEAD만 모든 origin에 허용하며 기존 업로드 규칙을 유지한다.
기존 별도 관리 공개 버킷은 배포 시 버킷 CORS를 직접 확인한다.
비공개 파일 API 전체에 CORS를 열지 않는다.

```sh
# 저장소의 배포 환경에 맞춰 각 서비스의 migrate를 먼저 실행한다.
corepack yarn db:migrate

# 인증 헤더 없이 공개 리다이렉트와 최종 응답을 모두 확인한다.
curl -sSI -L -H 'Origin: https://YOUR_STOREFRONT' \
  'https://YOUR_FILE_SERVICE/files/public/FILE_UUID'
```

각 응답의 `Access-Control-Allow-Origin`을 확인한다.
스토리지 최종 응답의 `Content-Type`은 `model/gltf-binary`여야 한다.

## 등록과 검수

기존 파일 업로드 API에서 `contextId: "sku-3d-model"`, `isPublic: true`로 GLB를 업로드한다.
큰 파일은 기존 presigned 업로드 흐름을 사용한다.
업로드가 완료되고 파일 상태가 `active`가 된 뒤 모델에 연결한다.
모델 API의 읽기 권한은 `inventory.master.read`, 쓰기 권한은 `inventory.master.write`다.

| 요청 | 경로                                    | 용도                           |
| ---- | --------------------------------------- | ------------------------------ |
| GET  | `/inventory/sku-3d-models/skus/:skuId`  | 최신 버전부터 이력 조회        |
| POST | `/inventory/sku-3d-models/skus/:skuId`  | 새 생성 버전 등록              |
| PUT  | `/inventory/sku-3d-models/:id/review`   | 검수 상태 및 메모 변경         |
| PUT  | `/inventory/sku-3d-models/batch-review` | 일괄 검수, 대량 처리 레인 사용 |

등록 예시:

```json
{
  "glbFileId": "019a2ca4-9d00-7000-8000-000000000001",
  "status": "needs_revision",
  "notes": {
    "sourcePhotoIds": [],
    "dimensions": { "unit": "mm", "kind": "body", "width": 100 },
    "estimatedParts": ["사진에 없는 바닥면"],
    "simplifications": ["미세 표면 요철 생략"],
    "requiredPhotoAngles": ["뒤", "위"],
    "generator": "도구와 버전",
    "review": "검수자·검수일·판단 근거"
  }
}
```

`notes`는 JSON 객체이며 위 필드는 작업 기록의 권장 형식이다.
재생성은 새 POST로 새 버전을 만든다.
이전 버전의 파일을 교체하는 API는 두지 않는다.

| 상태                | 의미                      |
| ------------------- | ------------------------- |
| `approved`          | 검수 통과, 고객 노출 후보 |
| `needs_revision`    | 수정 필요                 |
| `needs_more_photos` | 추가 사진 필요            |
| `failed`            | 생성 실패                 |

통과 처리는 `{"status":"approved"}`로 요청한다.
일괄 요청에는 `ids` 배열을 함께 보낸다.
승인에는 완료된 공개 GLB가 필수다.
실패·추가 사진 필요 상태는 파일 없이 기록할 수 있다.

SKU별 최신 **통과 버전**을 쓴다.
최신 생성 버전이 수정 중이어도 이전 통과 버전이 유지된다.
상품은 활성 판매 옵션에 연결된 SKU 중 `displayOrder`가 앞선 옵션의 모델 하나를 쓴다.
같은 옵션에 여러 SKU가 있거나 순서가 같으면 variant ID와 SKU ID로 선택을 고정한다.
통과 취소 시 이전 통과 버전 또는 다른 옵션 모델로 돌아가며 후보가 없으면 버튼이 사라진다.
고객에게 보이는 파일이 바뀔 때만 같은 트랜잭션으로 기존 상품 outbox를 발행한다.
메모 변경이나 비대표 모델 검수로 노출 파일이 같으면 재발행하지 않는다.
SKU 연결 교체·해제, 대기 매칭 해소, 매칭 전략 변경도 같은 트랜잭션에서 대표 모델을 다시 비교한다.
새로 연결할 SKU를 상품보다 먼저 잠가, 아직 커밋되지 않은 연결과 검수가 겹쳐도 승인 이벤트가 빠지지 않게 한다.
뷰어 문구와 접근성 레이블은 한국어·영어·일본어로 제공한다.

## 생성 품질과 용량

GLB는 자체 완결 파일로 만들고 외부 이미지·버퍼 URL에 의존하지 않는다.
단순한 형태, 반사·투명 소재, 가는 돌출부 등 대표 유형부터 검증한다.
본체 치수인지 포장 치수인지 확인되지 않으면 확정 치수처럼 사용하지 말고 `notes`에 불확실성을 적는다.
사진에 없는 면과 AI로 추정한 형상도 기록한다.

메시는 Draco 또는 meshopt로 압축하고 텍스처는 KTX2 또는 WebP를 사용한다.
뷰어는 Draco/KTX2 디코더를 필요할 때 로드하며 meshopt 디코더도 설정했다.
고해상도 원본을 그대로 싣지 말고 필요 수준으로 폴리곤과 텍스처를 줄인다.
완성 파일은 glTF Validator로 검사하고 실제 모바일에서 회전·확대·성능을 검수한다.
목표 5 MiB를 넘으면 원인을 기록하고 20 MiB 이내로 최적화한다.
외부 디코더 CDN을 차단하는 환경은 자체 호스팅을 검토한다.

## 후보와 결과 기록

운영 DB에서 아래 읽기 쿼리로 촬영된 SKU 후보를 확정한다.
이 문서의 작성만으로 촬영 대상이나 검수 결과를 확정하지 않는다.

```sql
SELECT sku_id, count(*) AS photo_count
FROM sku_reference_photos
GROUP BY sku_id
ORDER BY sku_id;

SELECT sku_id, version, status, glb_file_id, notes, created_at
FROM sku_3d_models
ORDER BY sku_id, version DESC;
```

| SKU               | 유형 | 원본 사진 | 본체 치수 확인 | 버전 | 상태 | 추정·단순화 | 추가 촬영 | GLB 크기 | 검수자 |
| ----------------- | ---- | --------- | -------------- | ---- | ---- | ----------- | --------- | -------- | ------ |
| 실제 작업 후 기입 |      |           |                |      |      |             |           |          |        |

대표 유형별 승인 결과를 먼저 확인한 후 나머지를 처리한다.
이번 구현에 실제 촬영 SKU의 GLB 생성 결과를 임의로 넣지 않는다.

## 붙였다 내리기 검증

1. 모델을 승인하고 core outbox와 channel-adapter 처리가 완료될 때까지 기다린다.
2. Medusa 상품 GET 응답에 `metadata.model3dFileId`가 있는지 확인한다.
3. 상세를 열어 GLB 요청이 없는지 확인하고 `3D로 보기` 클릭 후에만 요청되는지 확인한다.
4. 회전·확대, 대표 옵션 안내, 닫기·재열기·실패 메시지를 확인한다.
5. 해당 SKU의 모든 통과 버전을 취소하고 다른 옵션에도 통과 모델이 없는지 확인한다.
6. Medusa 상품 GET 응답에서 키가 **사라졌는지** 확인한다.
7. 상세 버튼이 사라지고 목록 사진이 그대로인지 확인한다.

삭제 이벤트는 `model3dFileId: ""`를 보낸다.
키를 생략하거나 `null`을 보내는 것으로 대체하지 않는다.
상품정보 표의 별도 metadata 삭제 문제는 이 변경의 범위가 아니다.

회귀 테스트:

```sh
# 루트, Jest 직렬 실행
corepack yarn jest --runInBand \
  apps/core/src/modules/inventory/sku-3d-models \
  apps/core/src/modules/catalog/core/products/loaders/product-model3d.loader.spec.ts \
  apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts \
  apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts \
  apps/file-service/src/database/__tests__/sku-3d-model-file-context.spec.ts \
  apps/file-service/src/download/public-file-cors.http.spec.ts

# 별도 실행, 다른 테스트 러너와 겹치지 않도록 한다.
cd web/almondyoung-storefront
corepack yarn test src/domains/products/product-details/components/model3d-viewer/index.test.tsx

# 저장소 루트로 돌아온 뒤 별도 실행, 로컬 PostgreSQL/Redis가 필요하다.
cd ../..
cd apps/medusa
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres \
  REDIS_URL=redis://localhost:6379 \
  TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules \
  corepack yarn jest --runInBand integration-tests/http/product-model3d.spec.ts
```

Medusa 통합 테스트의 로컬 DB 호스트는 `localhost`를 쓴다.
현재 설치된 test-utils는 호스트 문자열에 `localhost`가 없으면 SSL을 강제하므로, SSL 없는 로컬 컨테이너에 `127.0.0.1`을 쓰면 연결에 실패한다.

## 2026-10-29 검증 기록

실행 런타임은 Node 22.23.4다.
테스트 러너는 직렬로 실행했다.

| 범위                                                         | 결과                    |
| ------------------------------------------------------------ | ----------------------- |
| core·channel-adapter·file-service·상품 이벤트 계약 집중 Jest | 16개 스위트, 243개 통과 |
| 스토어프론트 뷰어 Vitest                                     | 2개 파일, 13개 통과     |
| 설치된 Medusa metadata 병합 단위 테스트                      | 1개 통과                |
| Medusa HTTP 추가·조회·삭제·재조회                            | 1개 통과                |
| core·file-service·channel-adapter·뷰어 범위 TypeScript       | 모두 통과               |
| 변경 파일 Prettier·git diff 공백 검사                        | 통과                    |

PostgreSQL 전용 컨테이너에서 실제 외래키를 사용한 19개 통합 사례를 포함한다.
동시 버전 등록, 검수 취소·이전 모델 복귀, outbox 롤백을 검증했다.
발행·판매 중지·버전 삭제·카테고리 변경과 검수가 겹쳐도 오래된 스냅샷이 되살아나지 않는지 검증했다.
SKU 외래키 검사와의 교착 상태를 재현하고 `NO KEY UPDATE`로 수정했다.

파일 정책·Medusa, 스토어프론트, 코어를 별도 서브에이전트가 리뷰했다.
추가 전체 리뷰에서 나온 버전 삭제·카테고리 삭제 경합과 외래키 교착 지적은 수정 후 재리뷰에서 모두 해결 판정을 받았다.

실제 파일 컨트롤러를 사용하는 로컬 fixture에서 브라우저의 공개 302 → 최종 200 다운로드와 GLB MIME을 확인했다.
클릭 전 모델 요청이 없고 닫을 때 뷰어가 제거되는 것도 확인했다.
이 환경은 WebGL 2를 만들 수 없어 실제 모델 렌더링·회전·확대 품질은 확인하지 못했다.
지원하지 않는 환경의 오류 안내는 데스크톱·모바일 화면에서 확인했다.

전체 스토어프론트 타입 검사는 기존의 다른 파일 오류로 통과하지 못했으며, 이번 뷰어 범위 타입 검사는 통과했다.
라이브 DB 마이그레이션, 별도 관리 S3 버킷의 CORS, 실제 촬영 SKU의 모델 생성·검수는 실행하지 않았다.
