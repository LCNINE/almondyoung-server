# 3D 작업실 홈 PC 워커

작업자 휴대전화 → 아몬드영 웹·서버(admin-web·core) ↔ 이 워커(Windows 홈 PC) → Codex CLI + Blender.
워커가 서버에 HTTPS 로 접속해 대기 작업을 가져간다. 휴대전화는 이 PC 에 직접 닿지 않고, 공유기 포트를 열 필요도 없다.
`scripts/home-server`(격리 데모 서버)와는 별개다.

## 파일
| 파일 | 하는 일 |
|---|---|
| `worker.mjs` | 작업 루프: claim → 입력·사진 받기 → Codex 실행(30초 heartbeat, 세션 id 즉시 보고) → 자동 판정 → 웹 뷰어 확인 → 업로드 → complete |
| `api.mjs` | 서버 호출. `Authorization: Bearer <워커 키>` + `x-tenant-id` |
| `codex-run.mjs` | `codex exec` / `codex exec resume <세션 id>` 실행. `shell:false`, `windowsHide:true`, 프롬프트는 stdin |
| `judge.mjs` | GLB 판정: 2,097,152 바이트 이하, 외부 uri 없음, glTF Validator 오류 0, 렌더 6장, review.json 칸 |
| `viewer-check.mjs` | Edge headless 로 model-viewer(배경 #c6c6c6, 극각 75°)에 압축 GLB 를 띄워 보이는지 확인, 화면 캡처 |
| `env.mjs` | 설정 읽기, Codex 에 넘길 환경변수 허용 목록 |
| `prompts/AGENTS.md` | Codex 제작·자체 검토 지시. 작업실 폴더마다 복사된다 |
| `review.schema.json` | Codex 마지막 응답 형식(`--output-schema`) |
| `new-key.mjs` | 워커 키 발급(키는 파일에만, 화면엔 해시 INSERT 한 줄) |
| `worker.env.example` | 비밀값 없는 설정 예제 |

의존성 설치·빌드가 없다. Node 22 내장 기능만 쓴다.

## 세션과 폴더
- 작업실(상품 × 작업자)마다 `SKU3D_WORK_ROOT/<workshopId>/` 폴더 하나, Codex 세션 하나.
- 첫 제작은 `codex exec --json ... -C <폴더>` 로 시작하고, 받은 `thread.started` id 를 바로 서버에 적는다.
- 수정은 서버가 돌려준 그 id 로 `codex exec resume <id>` 를 부른다. `--last`·`--ephemeral` 은 쓰지 않는다.
- 버전마다 `iteration-N/` 에 build.py, model.blend, model.glb, renders/, plan.md, review.json 이 남는다. 이전 버전은 덮어쓰지 않는다.
- 같은 작업실 작업은 서버가 한 번에 하나만 내준다.

## 격리
- Codex 자식 프로세스 환경변수는 허용 목록뿐이다(PATH·사용자 폴더·임시 폴더·CODEX_HOME·BLENDER_PATH·NODE_BIN·GLTF_TRANSFORM_CLI). 워커 키·서버 주소·테넌트는 넘기지 않는다.
- 샌드박스는 `sandbox_mode="workspace-write"`(작업실 폴더만 쓰기). 폴더 이름을 나눈 것만으로 격리가 끝난 게 아니다 — 운영 전에 아래 격리 실측을 한다.
- 워커 키 파일은 설정 파일과 따로 두고, 그 파일은 현재 사용자만 읽는다.
