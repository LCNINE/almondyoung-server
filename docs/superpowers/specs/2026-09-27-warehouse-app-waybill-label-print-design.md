# warehouse-app 한진 운송장 인쇄 배선 설계

작성일: 2026-09-27. 이슈: #913 (부모 #910, 컷오버 #923). 브랜치: `feat/913-warehouse-app-label-print`.
선행: core 렌더러 PR #974 (develop `c0e29fadf`, 설계 `2026-09-27-hanjin-ns-label-rendering-design.md`).

## 1. 목표

창고 스테이션 PC 의 warehouse-app 이 core 가 만든 한진 운송장 ZPL 을 **이 PC 에 설정된 라벨 프린터로**
찍는다. 세 가지다.

1. 프린터 설정을 PC 별로 저장한다 (`spooler://<Windows 프린터 이름>`)
2. **배치 일괄 인쇄** — 출고작업 화면의 배치 행에서 그 배치의 라벨을 한 번에
3. **건별 재출력** — 박스 작업 화면에서 그 박스의 라벨 한 장

core·Rust 변경은 없다. 창고 PC 에 새 빌드를 까는 것은 이 한 번이고(#913 「렌더링 위치 = core」), 이후
템플릿 수정은 core 배포만으로 나간다.

## 2. 전제와 이미 내린 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 출력 시점 | **배치 일괄 + 건별 재출력** (2026-09-27 사용자 결정) | 출고작업 진입점이 운송장 스캔이라(`OutboundQueueScreen` → `GET /shipments/by-waybill`) 박스를 열기 **전에** 라벨이 붙어 있어야 한다. 「포장 시 건별」은 라벨을 스캔해야 열리는 박스 안에서 라벨을 뽑는 순환이 된다. #923 컷오버 순서도 「발급 → 배치 편입 → 라벨 인쇄 → 출고작업」 |
| 인쇄 대상 목록 | 기존 `GET outbound-batches/:batchId/work-items` | shipmentId 를 준다. 배치 출력 API 는 core 스펙 §11 에서 범위 밖으로 뺐다 |
| 라벨 API | 기존 `GET shipments/:shipmentId/waybill/label` → `{ waybillId, trackingNo, format, data }` | 부작용 없음. 재출력은 같은 호출을 다시 부른다 |
| 409 사유 판별 | **메시지 접두어 파싱** (2026-09-27 사용자 결정) | 응답 `code` 는 전부 `CONFLICT` 이고, 사유는 메시지 앞머리(`WAYBILL_STALE: …`)에만 있다 — `@app/shared` 의 `ConflictError` 는 코드를 싣지 않는다. core 를 고치면 공용 예외 lib 을 건드리고 앱 출시가 core 배포에 묶인다 |
| `format` | **검사하지 않는다** — 바이트를 그대로 넘긴다 | core 가 ZPL 에서 TSPL 로 옮겨도(#913 「프린터」) 앱을 다시 배포하지 않게. 렌더링을 core 에 둔 이유와 같다 |
| 프린터 대상 | `spooler://` 만 설정 UI 로 받는다 | 창고 XP-DT108B 는 USB 로 PC 에 물려 있다(#913). `tcp://` 는 `print_raw` 가 계속 지원하지만 설정 UI 는 만들지 않는다 |
| 프로필 | **스테이션(Windows)에서만** 설정·인쇄 UI 를 보인다 | 핸드헬드(Android)엔 스풀러가 없다(`send_spooler` 가 비 Windows 에서 에러) |
| 프린터 목록 드롭다운 | 만들지 않는다 | Rust 에 `EnumPrintersW` 를 더해야 하는데 이 환경(Linux)에선 검증할 수 없다. 이름 오타는 설정 화면의 테스트 인쇄로 즉시 드러난다 |

## 3. 데이터 흐름

```
설정 화면 ── 이름 입력 → prefs['labelPrinter.target'] = 'spooler://<이름>'
            └ 테스트 인쇄 → renderTestLabel → printRaw

출고작업 화면 · 배치 행 「라벨 인쇄」
  → GET outbound-batches/:batchId/work-items
  → 대상 = status ∉ {completed, excluded}  (서버 순서 유지: createdAt, id)
  → 확인 대화상자 (장 수 · 이 기기의 직전 인쇄 시각)
  → runBatchLabelPrint(shipmentIds, fetchLabel, print)
       건마다 순차: GET …/waybill/label → printRaw(target, data)
         API 거절(4xx·5xx) → 그 건 skipped + 사유, 계속
         프린터 실패       → 즉시 중단, 나머지는 notAttempted
  → 결과 요약 + 「실패·미인쇄만 다시」
  → prefs['labelPrinter.batch.<batchId>'] = 마지막 인쇄 시각(ISO)

박스 작업 화면(단순출고·위치출고) 헤더 「라벨 재출력」
  → GET …/waybill/label → printRaw
```

## 4. 구성 요소

경로는 `native/warehouse-app/src/` 기준.

### 4.1 `core/hardware/print/labelPrinter.ts`

- `LABEL_PRINTER_KEY = 'labelPrinter.target'`
- `readLabelPrinter(prefs): string | null` — 저장된 target. 없으면 `null`
- `writeLabelPrinter(prefs, name)` — 이름을 `trim` 해서 `spooler://${name}` 로 저장. 빈 문자열이면 `remove`
- `printerNameOf(target): string` — 설정 화면이 입력칸에 되돌려 보여줄 이름(`spooler://` 제거)
- `printRaw(target, text): Promise<void>` — `invoke('print_raw', { target, data: Array.from(new TextEncoder().encode(text)) })`.
  실패하면 `PrinterError`(원문 메시지 보존)로 감싸 던진다 — 오케스트레이터가 API 거절과 구별해야 하기 때문이다
- 진단 화면의 테스트 인쇄도 이 `printRaw` 를 쓰도록 바꾼다(배관 한 벌)

### 4.2 `domains/outbound/waybillLabel.ts`

- 타입 `WaybillLabel = { waybillId; trackingNo; format: string; data: string }`
- `useFetchWaybillLabel()` — `api.request<WaybillLabel>({ path: '/shipments/${id}/waybill/label' })` 를 부르는 함수를 돌려준다.
  캐시하지 않는다(재출력은 항상 새로 받는다) — `useQuery` 가 아니다
- `waybillConflictCode(error): string | undefined` — `ConflictError` 의 메시지에서 `^(WAYBILL_[A-Z_]+):` 를 뽑는다
- `labelErrorMessage(error): string` — 아래 표
- `runBatchLabelPrint({ shipmentIds, fetchLabel, print, onProgress }): Promise<BatchPrintResult>` — 순수 오케스트레이터
  - `BatchPrintResult = { printed: string[]; skipped: { shipmentId; message }[]; notAttempted: string[]; printerError?: string }`
  - 순차 실행. `print` 가 `PrinterError` 를 던지면 그 건과 나머지를 `notAttempted` 로 두고 멈춘다
  - `fetchLabel` 이 던지면 그 건을 `skipped` 에 넣고 계속한다
  - `onProgress(done, total)` 는 건마다 한 번

현장 문구 (`labelErrorMessage`):

| 조건 | 문구 |
| --- | --- |
| 409 `WAYBILL_NOT_DISPATCHABLE` | 한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요. |
| 409 `WAYBILL_STALE` | 주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요. |
| 409 `WAYBILL_LABEL_UNAVAILABLE` | 이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사). |
| 409 그 밖 | 송장 상태가 바뀌었어요. 관리자에게 문의해 주세요. |
| 404 | 출고 정보를 찾을 수 없어요. |
| 5xx | 라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요. |
| `PrinterError` | 프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요. |
| 그 밖 | 기존 `errorMessage(error)` 로 넘긴다 (401/403·네트워크 등) |

프린터 원문 메시지(`OpenPrinterW failed …` 등)는 버리지 않고 결과 화면에 작은 글씨로 함께 보인다 — 설정
오타와 전원 꺼짐을 현장에서 구별하는 유일한 단서다.

접두어는 core 의 `WAYBILL.ERROR.*` 상수와 `${code}: …` 메시지 형식이 계약이다. 앱 테스트는 core 가
실제로 내는 메시지 모양(예: `WAYBILL_STALE: waybill w1 manifest/recipient changed between guard and assembly`)을
픽스처로 고정한다. core 쪽에서 형식이 바뀌면 문구가 「그 밖」으로 떨어질 뿐 인쇄 흐름은 깨지지 않는다.

### 4.3 컴포넌트

- `domains/outbound/LabelPrinterSettings.tsx` — 설정 화면의 「라벨 프린터」 절. 이름 입력 + 저장 + 테스트 인쇄. 결과 한 줄
- `domains/outbound/BatchLabelPrintButton.tsx` — 배치 행의 버튼. 프린터 미설정이면 누를 때 안내만 한다.
  진행 중엔 「12/40 인쇄 중」, 끝나면 요약(`인쇄 38 · 실패 2 · 미인쇄 0`)과 실패 사유 목록, 실패·미인쇄가
  있으면 「실패·미인쇄만 다시」. 진행 중에는 `useUnsavedWork(true)` 로 화면 이탈을 막는다
- `domains/outbound/ReprintLabelButton.tsx` — 박스 화면 헤더 카드 안. 한 장 찍고 결과 한 줄

확인 대화상자는 기존 `ConfirmDialog` 를 쓴다. 문구: 「라벨 40장을 인쇄할까요?」 + 이 기기에서 인쇄한 적이
있으면 「이 기기에서 09:12 에 이미 인쇄했어요」. 같은 배치를 두 번 찍으면 같은 번호의 라벨이 두 장
생긴다 — 막지는 않되(분실·훼손 재출력이 정당한 사용이다) 알린다.

대상이 0건이면(전부 `completed`/`excluded`) 대화상자 없이 「인쇄할 박스가 없어요」.

### 4.4 배선

- `SettingsRoute` — 스테이션이면 `LabelPrinterSettings` 절 추가
- `OutboundQueueScreen` — 스테이션이면 배치 행마다 `BatchLabelPrintButton`
- `SimpleOutboundScreen`·`LocationOutboundScreen` — 스테이션이면 송장 카드에 `ReprintLabelButton`
- 스테이션 판정은 기존대로 `resolveProfile(platform()) === 'station'`. 컴포넌트가 직접 `platform()` 을
  부르면 테스트에서 모킹이 퍼지므로, 화면은 `isStation` 을 한 곳에서 계산해 props 로 내린다
- `prefs` 는 기존 화면들처럼 `prefs?: DevicePrefs = localStoragePrefs` 로 주입받는다

## 5. 에러 처리 원칙

- **API 거절은 건 단위, 프린터 실패는 실행 단위.** 한 박스의 송장이 낡았다고 배치 전체를 멈추지 않는다.
  반대로 프린터가 죽었는데 남은 39건의 라벨을 서버에서 계속 렌더링하지 않는다
- 재시도는 사람이 누른다. 자동 재시도는 없다 — 프린터 오류는 대개 사람이 고쳐야 풀린다
- 부분 결과를 잃지 않는다: 「실패·미인쇄만 다시」는 `skipped + notAttempted` 의 shipmentId 로 다시 돈다
- 네트워크 불확실(`ApiError.outcome === 'uncertain'`)도 `skipped` 로 취급한다 — GET 이라 재시도가 안전하다

## 6. 테스트

| 대상 | 종류 | 핵심 |
| --- | --- | --- |
| `labelPrinter.ts` | 단위 | 저장·읽기·빈 이름 제거·`printerNameOf`, `printRaw` 가 invoke 실패를 `PrinterError` 로 감싼다 |
| `waybillConflictCode`·`labelErrorMessage` | 단위 | core 실제 메시지 픽스처 3종 → 문구, 모르는 코드·접두어 없음 → 「그 밖」, 404·5xx·PrinterError |
| `runBatchLabelPrint` | 단위 | 전부 성공 / 중간 409 는 건너뛰고 계속 / 프린터 실패 시 즉시 중단·나머지 notAttempted / 진행 콜백 횟수 / 순차성(동시 호출 0) |
| `LabelPrinterSettings` | 컴포넌트 | 저장하면 prefs 에 `spooler://`, 테스트 인쇄가 그 target 으로 invoke |
| `BatchLabelPrintButton` | 컴포넌트 | completed·excluded 제외, 확인 대화상자 장 수, 직전 인쇄 시각 표시, 결과 요약, 「실패·미인쇄만 다시」가 그 건만 다시 부른다, 미설정 안내 |
| `ReprintLabelButton` | 컴포넌트 | 성공 한 줄, 409 문구 |
| 화면 배선 | 컴포넌트 | 핸드헬드에선 버튼·설정 절이 없다 |

`invoke` 는 기존 테스트처럼 `@tauri-apps/api/core` 를 모킹한다. 판정 기준: `npm test`(vitest) 전부 통과 ·
`npx tsc -b` 0 · `npm run lint` 0 (`native/warehouse-app` 에서). 루트 게이트는 이 앱을 보지 않는다.

## 7. 합격 기준

1. §6 판정 기준 통과
2. **사람 작업 — 머지를 막지 않는다.** 창고 PC 에서(선행: 한진 라벨지 수령, 운영 배포 경로 ③-12):
   설정에 프린터 이름 저장 → 테스트 인쇄 → 배치 일괄 인쇄 → 한 장 재출력. 라벨 자체의 판정(바코드·한글·
   칸 정렬)은 core 스펙 §10-3 이 맡는다

## 8. 범위 밖

창고 실물 출력 판정(core 스펙 §10-3) · warehouse-app 운영 빌드·서명·updater(개통 지도 ③-12) · Windows
프린터 목록 드롭다운 · `tcp://` 설정 UI · 인쇄 감사 로그 · 인쇄 이력의 서버 저장(이 기기 prefs 에만 둔다) ·
배치 출력 API · admin-web 인쇄 · 발급 직후 자동 인쇄(발급은 admin-web 에서 일어난다).
