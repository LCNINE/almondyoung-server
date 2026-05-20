# DigitalAsset 의 파일 내용은 master version 격리 밖에 둔다

PIM 의 master 는 버전 격리(draft/active, CoW) 로 "이 시점에 어떤 sale offering 이었나" 를 frozen 시킨다 (ADR-0004 참조). variant ↔ DigitalAsset 매칭(`productVariantDigitalAssetLinks`) 도 이 격리에 들어간다 — variant 가 CoW 로 clone 되면 매칭 정션도 함께 clone 된다. 그러나 asset **파일 자체** 가 master version 에 묶여야 하는가 — 즉 v1.0 에 매칭됐던 asset 의 파일이 immutable 이어야 하는가 — 는 별개 질문이고, 답이 운영 가능성에 크게 영향을 준다. 이 ADR 은 두 layer 의 책임을 분리한다.

## Decision

- **master version 격리의 대상은 sale offering 의 진실** (어떤 variant 가 어떤 옵션/가격으로 팔렸나, 그리고 **어떤 DigitalAsset 들과 매칭되어 있었나**) 이지, **asset 의 파일 내용** 이 아니다.
- **DigitalAsset 의 파일은 mutable.** `digitalAssetFileVersions` 테이블(`assetId`, `fileId`, `version`, `releaseNote`, `releasedAt`, `releasedBy`) 이 immutable 이력을 보존하고, `digitalAssets.currentFileVersionId` 가 latest 포인터.
- **다운로드 = ownership 의 asset 의 `currentFileVersion` 의 파일.** 모든 ownership 보유자가 자동으로 latest 를 받음. 시술동의서의 오타 수정은 옛 구매자에게도 자동 전파.
- **운영자의 "파일 교체" = 새 `digitalAssetFileVersions` row 추가 + 포인터 갱신.** 옛 fileId 는 file-service 에 그대로 살아있어 audit/rollback 가능.
- **메타데이터 변경 (name, description) 은 history 미보존** — `digitalAssets` row 의 mutable 컬럼으로 자유 수정. Audit 가치가 적음.
- **첫 구현엔 사용자가 옛 version 을 다운로드할 수단 없음.** 모델은 history 를 들고 있으므로 미래에 endpoint 만 추가하면 됨 (Steam 의 beta branch 식).

## Why this shape

검토한 대안과 채택 이유:

- **(A) Asset 파일은 immutable. 운영자가 "수정" 하면 새 asset 등록 → master draft 만들어 매칭 갈아끼움**: master version 시스템과 가장 자연 정합하고 도메인 모델이 깔끔하지만, **사실상 사후 수정이 불가능**. 시술동의서 오타 한 글자 수정이 신규 master version + publish 절차를 요구하고, 옛 구매자는 영원히 옛 파일을 가짐. 운영 현실에서 받아들일 수 없는 비용. 기각.
- **(B, 채택) Mutable + file version history**: 두 layer 의 책임 분리를 명시적으로 받아들임. master version 은 "sale offering 의 진실", asset 파일은 "콘텐츠의 진실" — 다른 진실이다. variant CoW 는 매칭 정체성("어떤 asset 인지") 만 격리하고, 그 asset 의 파일이 시간에 따라 진화하는 것은 별도 layer 의 사건. file-service 의 fileId 가 어차피 immutable 이므로, history 보존은 단순히 옛 fileId 를 row 에 남기는 것만으로 가능.
- **(C) Mutable + 단순 audit log (별도 file version 테이블 없음)**: 더 단순하지만 명시성이 떨어진다. "이 자산은 지금까지 몇 번 어떤 의도로 교체되었나" 가 audit log 검색을 요구. 운영 UI 가 자산의 history 를 보여주려면 별도 인덱스가 필요. file version 테이블이 그 자체로 first-class 모델로 있는 게 명확.

(A) 가 깨끗해 보였던 이유는 "master version 시스템이 곧 모든 frozen 진실의 root" 라는 암묵적 가정 때문이었다. 그 가정을 명시화하고 나면 — sale offering ≠ 콘텐츠 자체 — 두 layer 의 분리가 자연스럽다. CONTEXT.md 에 이 분리를 명문화함.

## Consequences

- `digitalAssetFileVersions` 테이블 신설. `(assetId, version)` unique. `digitalAssets.currentFileVersionId` FK.
- 운영자 admin UI 는 "asset 등록" 과 "파일 교체" 두 행위를 가짐. "파일 교체" 시 release note 입력 권장.
- 운영자 admin UI 에서 asset 의 "version history" 화면을 제공 (어느 운영자가 언제 어떤 메모로 교체했는지).
- Storefront 에 "이 자산이 업데이트되었습니다" 같은 UX 기회 — 마지막 다운로드 시점 (`ownerships.lastDownloadedAt` 같은 추가 컬럼) 과 `currentFileVersion.releasedAt` 비교. 첫 구현 범위 외이지만 모델은 그걸 받아낼 모양.
- Rollback: 잘못된 파일 push 시 운영자가 history 에서 옛 version 을 골라 `currentFileVersionId` 를 그쪽으로 되돌릴 수 있음.
- **콘텐츠의 사후 변경이 가능하다는 것 자체가 비즈니스 리스크** — "내가 산 거랑 다른 파일이 왔다" 분쟁 가능. 운영 정책으로 "큰 변경은 새 asset 으로 등록, 사소한 수정만 같은 asset 의 새 version 으로 push" 를 강제할 것. ADR 의 일부가 아니라 운영 가이드.
- 옛 fileId 는 file-service 에서 삭제하지 않음 (rollback / audit / 옛 version 다운로드 미래 확장). file-service 의 retention 정책과 충돌 시 별도 ADR.
