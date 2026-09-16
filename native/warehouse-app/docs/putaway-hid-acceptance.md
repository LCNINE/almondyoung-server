# 적치 HID 스캔과 Enter 보호 검증

2026-09-16 · 브랜치 `codex/putaway-hid-enter` · 기준 `f9f772309`.

## 변경

적치 창이 Enter의 기본 버튼 실행을 차단하면서도 해당 이벤트만 공통 HID 판별기에 전달하도록 했다. `hidScanBoundary`의 WeakSet은 명시적으로 허용한 원본 KeyboardEvent만 보관한다. 입력칸이나 하위 확인창에서 이미 취소한 이벤트는 허용하지 않는다. 다른 확인창, 입력칸, 편집 영역, inert 작업 잠금, 조합 입력의 기존 차단은 유지한다. 간편입고·발주입고·적치 대기가 공통 적치 창을 사용한다.

수량 직접 입력 후 Enter는 포커스를 해제한다. 해당 Enter는 원래 입력칸을 대상으로 하므로 스캔으로 전달되지 않는다. 화면에 입력 종료 후 스캔 안내를 추가했다. 입력칸에 포커스를 둔 채 스캔한 문자열은 여전히 입력값으로 들어간다.

서버 API, DB, 권한, 저장된 작업 및 멱등키 계약은 변경하지 않았다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| 수정 전 적치 회귀 | 새 검사 6개 실패 / 기존 16개 통과. 숫자패드·전량·대상지 변경 후 HID 및 입력 종료 실패 재현 |
| 앱 전체, worker 2개 | 91파일 / 702검사 통과, 실패·skip 0 |
| 앱 build | TypeScript와 Vite 통과, 기존 chunk-size 경고 |
| 앱 lint | 오류 0 / 경고 22개, 변경 제품 코드의 신규 경고 없음 |
| 세 진입 경로 변이 검사 | 메모리상 ScanProvider를 원래 Enter 차단 규칙으로 바꾸면 새 경로 검사 3개 모두 실패. 선택되지 않은 55개는 skip |
| 독립 코드 검토 | 추가 수정 지적 없음 |

```bash
corepack yarn --cwd native/warehouse-app test --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
git diff --check
```

기존 멱등키 회전 검사는 첫 요청의 완료를 기다린 뒤 수량을 수정하도록 보완했다. 완료를 기다리지 않으면 수정 시점에 따라 첫 preflight가 취소되어 두 개의 완료 요청을 비교할 수 없었다.

전체 검사를 worker 제한 없이 build와 함께 실행한 첫 시도는 출고 100스캔 검사의 5초 timeout과 새 발주입고 검사의 준비 단계 대기 실패로 700통과/2실패였다. 이를 성공으로 계산하지 않았다. 저장소의 기존 인수 명령인 `--maxWorkers=2`로 재실행한 결과가 위의 702통과다. 무제한 병렬 실행의 두 실패 원인을 이 변경에서 해결했다고 주장하지 않는다.

## Chrome 입력 검증

제품 컴포넌트·ScanProvider·작업 실행기·IndexedDB를 Vite fixture에 연결하고, 별도 headless Chrome에 CDP 키보드/마우스 입력을 전달했다. 로그인과 API 응답은 fixture이며 실제 서버·DB 인수나 물리 장비 검사는 아니다.

| 입력 경로 | 수정 후 결과 |
| --- | --- |
| body에서 HID | 대상 선택, POST 0 |
| 숫자패드 지우기 → HID | 수량 5 보존, 대상 선택, POST 0 |
| 전량 → HID | 수량 50 보존, 대상 선택, POST 0 |
| 수량 입력칸에서 HID | 입력칸으로 문자열 유입, 대상 미선택, POST 0. 기존 입력 정책 유지 |
| 수량 입력 → Enter → HID | 포커스 해제, 수량 보존, 대상 선택, POST 0 |
| 숫자패드 → HID → 적치 마우스 클릭 | POST 정확히 1 |
| 위치 검색 입력칸에서 HID | 대상 선택, POST 0 |
| 숫자패드 뒤 카메라 ScanBus 이벤트 직접 주입 | 대상 선택, POST 0. 카메라 장비 검사는 아님 |
| 활성 적치 버튼에서 일반 Enter | POST 0 |
| 활성 적치 버튼에서 HID 종료 Enter | POST 0 |

수정 전에는 숫자패드·전량 뒤 위치 조회가 0건이었다. 비교용으로 창의 Enter handler만 제거하면 해당 스캔은 동작하지만 일반 Enter로 POST가 발생했다. 최종 수정은 두 문제를 함께 막는다. NumpadEnter와 취소 버튼의 Enter 억제는 정식 DOM 회귀에도 포함했다.

조사 fixture와 원본 결과: `/tmp/warehouse-hid-investigation/`. 자동 실행 로그: `/tmp/putaway-hid-*.log`. 조사용 Chrome/Vite 프로세스는 종료했다. 실제 Windows/PDA의 HID 장비 검증과 앱 배포는 별도다.
