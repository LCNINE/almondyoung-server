# file-service 는 inbound reference 를 추적하지 않는다 — 참조 방향은 호출 도메인 → uploads 단일

`apps/file-service` 의 baseline 스키마에는 한때 두 갈래의 inbound-reference 추적 메커니즘이 공존했다: (1) `uploads.related_type` / `uploads.related_id` 의 nullable 컬럼 쌍, (2) 별도 `file_references` 정션 테이블 (`upload_id` + `service_type` + `entity_type` + `entity_id`). 둘 다 INSERT 경로가 코드에 존재하지 않았고, 어느 caller 도 쿼리하지 않았다. 이 ADR 은 그 두 갈래를 의도적으로 제거하고, 같은 형태의 제안이 미래에 재발하지 않도록 책임 경계를 명시한다.

## Decision

- **file-service 의 책임 경계는 "파일 자체" 까지다.** uploads 테이블은 파일의 물리적 정체성과 (mimeType, size, path, url, status, isPublic, uploadedBy, context) 만 소유한다.
- **"어떤 도메인의 어떤 엔티티가 이 파일을 참조하느냐" 는 호출 도메인이 자기 스키마에서 관리한다.** 참조 방향은 **calling domain → `uploads.id`** 단일이다. 역방향 (`uploads → 참조 도메인`) 의 컬럼/테이블/인덱스를 file-service 에 두지 않는다.
- 현 시점의 실제 참조들이 이미 이 방향이다:
  - catalog: `productMasters.imageId`, `productVariants.imageId` → file-service `uploads.id`
  - library (설계 중): `digitalAssets.fileId`, `digitalAssetFileVersions.fileId` → file-service `uploads.id`
  - invoice/avatar/기타: 각 소유 도메인의 컬럼이 `uploads.id` 를 가리킴

## Why this shape

검토된 대안:

- **(A) `uploads.related_type` + `related_id` 컬럼 유지**: 한 파일이 한 엔티티에만 종속되는 경우만 표현 가능. 같은 파일을 여러 엔티티가 참조하는 자연스러운 케이스 (예: 한 PDF 가 여러 variant 의 부속 문서) 를 표현 불가. enum 도 string 으로 느슨해서 type-safety 도 없음. 폐기.
- **(B) `file_references` 정션 테이블 유지/활성화**: M:M 은 표현되지만, 모든 calling domain 이 자기 도메인 트랜잭션에서 file-service DB 에 cross-schema write 를 해야 함. 서비스 경계를 깨거나, 매번 outbox 이벤트를 끼워야 함. 또한 calling domain 은 자기 엔티티에서 이미 파일을 가리키는 컬럼을 갖고 있으므로 (catalog 의 `imageId`, library 의 `fileId`) 같은 사실이 두 곳에 중복 기록되어 동기화 부담만 생김.
- **(C, 채택) 참조 방향 단일 (calling domain → uploads)**: 각 도메인이 자기 FK 로 파일을 가리킴. file-service 는 자기 안에서 누가 자기를 가리키는지 모름. cross-schema write 불필요. 중복 없음. M:M 이 필요한 도메인은 자기 정션 테이블을 가짐 (예: library 의 `productVariantDigitalAssetLinks` + `digitalAssets.fileId` 의 2-단 매핑).

(B) 가 일견 매력적이었던 이유는 garbage collection ("참조 없는 upload 자동 정리") 을 file-service 단독으로 처리하고 싶을 때 inbound 정보가 필요해 보이기 때문이다. 그러나 GC 의 권위는 정의상 calling domain 쪽에 있다 — 파일을 *놓아주는* 결정은 그 파일을 쓰던 도메인이 한다. 따라서 GC 도 (C) 방향에 맞게 설계되어야 한다 (아래 Consequences 참고).

## Consequences

- 마이그레이션: `file_references` 테이블 DROP, `uploads.related_type` / `uploads.related_id` 컬럼 DROP, `idx_uploads_related` 인덱스 DROP. 운영 데이터 없음 (어디서도 INSERT 되지 않았음).
- file-service 에서 함께 제거: `FileRepository.addReference` / `findReferences`, `FileReference` / `NewFileReference` 타입, 관련 schema export.
- **Garbage collection 이 미래에 필요해질 때 권장 모양**: file-service 가 자체적으로 `uploads.created_at` + `status='active'` + `isPublic=false` 기준 TTL 청소를 돌리는 방식이 아니라, calling domain 이 자기 트랜잭션에서 "더 이상 안 쓰는 fileId 집합" 을 결정 후 file-service 의 delete API 를 호출하는 방식. 즉 file-service 는 명시적 명령에만 반응. 또는 "upload 직후 일정 시간 안에 calling domain 의 commit 호출이 없으면 GC" 같은 *intake* 단의 TTL 만 자체 보유 (현재 미구현).
- **재검토 트리거**: 이 ADR 의 재검토는 다음 조건에서 정당화된다 — (가) 한 파일이 calling domain 의 스키마로 표현하기 어려운 경계 횡단 참조를 갖고, (나) 그 참조가 운영 의사결정 (GC, audit, billing) 의 일차 입력이며, (다) calling domain 에서 file-service 로의 단방향 알림으로는 표현이 부자연스러운 경우. 단순 GC 만으로는 트리거가 아니다 — GC 는 (C) 방향에서 더 잘 표현된다.
