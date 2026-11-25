# SKU 3D 작업실 설계

## 목표
작업자 2~3명이 휴대전화 브라우저에서 SKU 별 3D 작업실을 열어, Windows 홈 PC 의 Codex CLI·Blender 가 만든 GLB 를 보고, 채팅으로 수정을 요청하고, 승인해 쇼핑몰에 공개한다.
휴대전화에는 아무것도 설치하지 않는다. 맥북은 개발용이며 최종 서비스는 맥북 없이 돈다.

## 연결 구조
```
작업자 휴대전화 ──쿠키──▶ admin-web(/api/proxy) ──▶ core
                                                    ▲ HTTPS 폴링 (홈 공유기 포트 개방 없음)
                          Windows 홈 PC 워커 ───────┘ ──▶ codex exec ──▶ Blender -b -P
```
- core: 로그인·권한·작업실·대화·작업 대기열·승인·공개.
- 홈 PC 워커: 대기 작업을 가져가 Codex 를 돌리고 결과를 올린다. 휴대전화는 홈 PC 나 Codex 포트에 직접 닿지 않는다.
- 개발 검증 때만 맥 로컬 core + 임시 터널을 쓴다(임시 개발 연결). 워커의 서버 주소는 `SKU3D_SERVER_URL` 하나로 바꾼다. 개발 검증 완료와 운영 연결 완료는 따로 보고한다.

## 조사로 확정된 사실
- `sku-3d-model` 파일 컨텍스트는 공개 전용이고(`allowPrivate: false`), `Sku3dModelsManager.validateFile` 은 공개 파일만 받는다. 그래서 검토용 비공개 컨텍스트 `sku-3d-workshop` 을 새로 두고, 승인 때 공개 컨텍스트로 다시 올린다.
- `register` 는 멱등이 아니다(누를 때마다 버전 +1). 공개 기록과 같은 트랜잭션으로 묶어 재시도에도 버전이 하나만 생기게 한다.
- 저장소에 SSE·WebSocket 이 없고 진행 표시는 React Query 폴링이다. 이벤트를 DB 에 쌓고 `afterSeq` 커서로 2초마다 받는다.
- 머신 자격증명 패턴은 공유 env 키(`@InternalOnly`)뿐이다. 워커 전용 키는 DB 에 sha256 만 두고 따로 검사한다.
- Codex 사용 조건(공식 문서): 자동화에는 API 키가 기본 권장이고, ChatGPT 로그인 자동화는 신뢰할 수 있는 사설 장비에서 auth.json 하나를 한 장비·직렬 작업으로만 쓰는 조건의 고급 경로다. 이용약관은 계정을 다른 사람이 쓰게 하지 말라고 한다. 개인 구독으로 여러 작업자의 요청을 처리해도 되는지는 문서가 답하지 않으므로 운영 전에 사용자가 플랜을 정한다. API 과금으로 임의 전환하지 않는다.

## 데이터 (core, 테넌트 DB 마다)
| 테이블 | 핵심 |
|---|---|
| `sku_3d_workshops` | (sku_id, owner_id) unique. tenant_id, codex_session_id(CLI 가 돌려준 값), dimension_basis(body·package·unknown) + 확인자·시각 |
| `sku_3d_workshop_jobs` | kind(create·revise), request, base_revision_id, status, attempts, lease_token, lease_until, worker_id. 작업실당 queued·running 은 부분 unique 로 하나 |
| `sku_3d_workshop_events` | seq bigserial. type(user_message·assistant_message·progress·status). 채팅과 진행을 한 줄로 |
| `sku_3d_workshop_revisions` | job 당 하나, 작업실 안 number. 비공개 glb_file_id·sha256·bytes, files(렌더·python·blend·plan), review, provenance(사진 id·치수·validator·도구 버전). 승인·공개 단계 칸(approved_*, public_glb_file_id, sku_3d_model_id, published_at) |
| `sku_3d_workers` | key_hash(sha256), max_concurrency(기본 1), last_seen_at, revoked_at |

## 권한
- `inventory.3d_workshop.use`: 내 작업실 열기·치수 확인·채팅·버전 열람. 부여: admin + 현장 작업자(LOGISTICS).
- `inventory.3d_workshop.manage`: 남의 작업실 열람. 부여: admin.
- 승인·공개: `inventory.3d_workshop.use` + `inventory.master.write`(기존 publish 와 같은 문).
- userId·tenantId 는 토큰에서만 읽는다. 작업실 접근 = owner 본인 또는 manage 보유자. 파일 서명 URL 도 이 검사를 거친 core 만 발급한다.
- 워커 키는 자기 테넌트 DB 의 대기열·작업 입력·결과 업로드만 한다. 승인·공개 불가.

## 작업 수명
1. 화면이 `POST /inventory/sku-3d-workshops/skus/:skuId` → 작업실 get-or-create(ON CONFLICT). 작업은 만들지 않는다.
2. 작업자가 치수 기준을 확인하면 create 작업이 queued 로 생긴다. 이미 진행 중이면 그 작업을 돌려준다(부분 unique).
3. 워커 `claim`: `FOR UPDATE SKIP LOCKED` 로 가장 오래된 queued(또는 lease 만료된 running) 하나를 running·lease 2분·새 lease_token·attempts+1. attempts 가 3 을 넘은 만료 작업은 failed.
4. 워커는 30초마다 heartbeat(lease_token 일치 시만 연장). 409 면 Codex 를 끄고 결과를 버린다.
5. Codex 의 `thread.started` 를 받자마자 `session` 으로 저장. 작업실에 이미 다른 세션 id 가 있으면 409.
6. `complete`: lease_token 일치 + running 일 때만. 산출물 업로드 → revision 생성 → assistant_message(review.summary) → succeeded. 늦게 온 결과는 409.
7. 수정 요청 채팅 → user_message + revise 작업(base = 최신 revision). 워커는 저장된 세션 id 로 `codex exec resume <id>`.

## 승인과 공개
`POST /inventory/sku-3d-workshops/:id/revisions/:revisionId/approve { glbSha256 }`
1. 해시가 저장값과 다르면 409(화면이 보던 버전과 다름).
2. public_glb_file_id 가 없으면 비공개 GLB 바이트를 받아 `sku-3d-model` 컨텍스트에 공개 업로드 후 기록.
3. 한 트랜잭션에서: sku_3d_model_id 가 없으면 `Sku3dModelsManager.register(..., tx)` draft → 기록, published_at 이 없으면 `publish(modelId, ..., tx)` → 기록.
4. 공개 전까지 기존 공개 모델은 그대로다(publish 가 그때 다른 approved 를 draft 로 내린다).
공개 업로드 뒤 기록 전에 죽으면 공개 파일 하나가 고아로 남는다(버전·공개는 중복되지 않는다).

## 홈 PC 워커 (`scripts/sku-3d-worker/`)
- 의존성 없는 Node 22 ESM. `scripts/home-server` 와 섞지 않는다.
- 폴더: `SKU3D_WORK_ROOT/<workshopId>/iteration-<n>/`. 작업실마다 세션·폴더 분리.
- 첫 실행 `codex exec --json -s workspace-write -C <workshop 폴더> --skip-git-repo-check --output-schema review.schema.json -i <사진들> -`, 수정 `codex exec resume <sessionId> --json …`. `--last` 금지.
- Codex 자식 프로세스 env 는 허용 목록만(PATH, SystemRoot, USERPROFILE, HOME, APPDATA, LOCALAPPDATA, TEMP, TMP, CODEX_HOME, BLENDER_PATH). 워커 키·서버 주소는 넘기지 않는다.
- 판정은 워커가 한다: GLB 존재, glTF Validator 오류 0, 2 MiB 이하, 외부 uri 없음, review.json 스키마. 통과 못 하면 fail.
- 지시문은 `scripts/sku-3d-worker/prompts/AGENTS.md`(베스트 상품 3D 감독 규칙을 옮긴 것).
- 자동 시작은 작업 스케줄러(로그온 시, 실패 시 재시작). ChatGPT 로그인이 사용자 프로필에 있어서다.
- 운영 전 격리 실측: Codex 가 작업 폴더 밖(워커 .env, 다른 작업실 폴더)을 읽거나 쓰지 못하는지.

## 화면 (admin-web)
- `Sku3dActions` 의 지피티로 가기 → 3D 작업실 링크(`/mobile/sku-3d-workshop/<skuId>`). 사진 다운로드·codex:// 제거. 모바일 실측 상세·작업 기록에도 같은 링크.
- 작업실 화면: 워커 상태(마지막 접속 60초 이내 = 연결됨), 원본 사진·치수, 치수 기준 확인, GLB 뷰어(진행 중에도 최신 완성 버전), 버전 목록(번호·검토 요약·공개 여부), 진행·채팅(커서 폴링), 승인 버튼(보고 있는 revisionId + sha256).
- model-viewer `camera-controls` + `touch-action: pan-y`(가로 드래그 회전, 두 손가락 확대, 세로 스크롤).

## GLB 조건
미터 단위, 텍스처 내장, meshopt + webp 압축, 2 MiB(2,097,152 바이트) 이하, glTF Validator 오류 0. 상한을 바꾸려면 file-service 컨텍스트와 admin-web `GLB_MAX_BYTES` 를 같이 바꾼다(이번엔 안 바꾼다).
