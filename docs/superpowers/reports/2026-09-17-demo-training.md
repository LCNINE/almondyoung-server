# Demo 직원 교육 환경 구현·검증 결과

작성: 2026-09-17, Asia/Seoul. 승인 설계: `../specs/2026-09-17-demo-training-design.md`.

## 제공물

- 직원 가이드: https://admin.almondyoung-next.com/demo/manual/README (로그인 필요).
- 안내자 콘솔: https://admin.almondyoung-next.com/demo.
- 원본: `docs/demo-training/{README,retail,warehouse,workshop,operator}.md`.
- 문서 형식: Markdown 5개와 실제 앱 PNG 스크린샷. HTML 발표 자료와 PDF는 폐기했다.
- Windows NSIS: `LCNINE Logistics Demo_0.1.0_x64-setup.exe`, 별도 전달용 gitignored 산출물.
- 재현 도구: `scripts/demo/README.md`의 카탈로그 export/import, 이미지 복사, 선택 SKU 실습 준비 CLI.

Markdown만 원본으로 유지하며 웹에서는 같은 내용을 기본 문서 형식으로 렌더링한다. 이전 `.html` 링크는 Markdown 뷰어로 이동하고 PDF 경로는 404를 반환한다. 관리자 인증을 거친 demo 전용 라우트에서 제공하며, 로그인되지 않은 요청은 인증으로 이동한다. 실행 파일은 해당 라우트에서 제공하지 않는다.

## 상품과 업무 데이터

최종 원본 추출 시각은 **2026-09-17 07:15:32 KST**이다. live는 `REPEATABLE READ READ ONLY`로 상품 기준정보만 읽었다. 고객·주문·재고·직원 개인정보·외부 연동 비밀은 복제하지 않았다.

| 항목 | 검증 값 |
| --- | ---: |
| 전체 live SKU / demo 반영 | 39,641 / 39,641 |
| source SKU 누락 / 삭제 상태 차이 | 0 / 0 |
| 기존 교육 SKU 포함 demo 전체 | 39,671 |
| source 바코드 | 68,713 |
| 주문 연습용 결정적 상품 연결 보완 | 19,219 SKU |
| demo 공급처 관계 보완 | 39,641 SKU |
| active physical 상품 이미지 파일 복사 | 10,503 |
| 공급처 미연결 / 바코드 없는 비삭제 SKU | 0 / 19 |

live에는 SKU-공급처 관계가 없어서 demo 국내 공급처 관계를 추가했다. 실제 구매처가 복제됐다는 의미는 아니다. 원본의 고아 matching 참조 4개는 nullable 관계로 정규화하고 manifest에 기록했다. 바코드 없는 19개는 원본 상태를 그대로 드러낸다.

카탈로그 snapshot content SHA-256:
`3c1159fbb070724bc194bfb2ed45e84494d751b59ff2f49b6fb06a22c9fe2c73`

source SKU ID 집합 SHA-256:
`e805da1393068f2a9ec0faa4080fe207304b8b50947227aa444402c61b3d754b`

가져오기 도구는 target stage/mock 설정, 실제 DB 식별, 접속 endpoint, demo fixture를 모두 확인한다. 이전 추출보다 오래된 snapshot은 거부한다. 원본 timestamp는 PostgreSQL text로 전달해 시간대 이동과 마이크로초 손실을 방지한다. 공급처·상품 관계의 갱신과 직원이 만든 업무 이력을 분리했다.

이미지는 실제 active physical 상품에서 참조하는 공개 활성 파일만 복사했다. 관련 FileService 행 10,503개를 demo 사용자 소유로 만들었고 6개 context/MIME 조합의 공개 GET은 모두 200 및 MIME·크기·magic bytes 일치를 확인했다. 과거/삭제/비물리 상품 이미지와 비공개 파일은 제외했다.

기본 실습 준비는 실제 SKU 100개 × 40개 재고와 선택 SKU의 합성 365일 수요 이력이다. 추가로 발주 검증용 저재고 SKU를 준비했다. 동일 UUID 재확인에서 재고가 이중 증가하지 않는 것을 확인했다. 이후 자유 실습은 콘솔에서 선택 상품을 보충한다. 초기화하거나 직원 작업을 삭제하지 않는다.

## 실제 demo 업무 인수

검증은 관리자와 `demoworker` 역할의 실제 인증 API로 수행했다. 완료 시각: **2026-09-17 07:14:42 KST**. 이는 실물 Windows 조작 검증과 구분한다.

| 흐름 | 결과와 식별자 |
| --- | --- |
| 발주 10 → 입고 4 + 6 → 각각 적치 | 발주 `6f59ecb3-2178-4670-a78f-352a67728ec8`, 수령 10 / 잔량 0 |
| 첫 부분 입고 | receipt `f3ad9d35-c8dd-493b-8c55-3f06bda69d25` |
| 두 번째 부분 입고 | receipt `55bc5176-480c-470c-b1e5-a6d90c6bcede` |
| 여러 상품 주문 묶음 | run `e481f735-e8d0-457b-a928-887c423ca022`, 5건 × 2종, 동일 요청 재시도 식별자 일치 |
| 정상 피킹·포장·검수·출고 | shipment `6ff41275-cf3d-4f4a-9df7-463fdb9fb052`, 모의 송장 `983197548424` |
| 부족 재고 → 보충 → 같은 주문 출고 | run `207bf917-8313-4ed1-908b-eb2b5db1c39f`, 최초 plan 409, 1개 보충 후 예약 해소 |
| 부족 주문 출고 결과 | shipment `7d1caf4d-3ab0-469a-a5ae-e1c8779b40bc`, 모의 송장 `946914947774` |

두 출고 모두 `shipped`, dispatch `dispatched`, 모의 채널 결과 `succeeded`, 모의 택배 `registered`, 모의 알림 `SENT`였다. 부족 주문은 판매주문·fulfillment·shipment ID를 유지했다. 외부 택배/고객 알림은 보내지 않았다.

## 검증

- Core 실제 PostgreSQL integration 7개: 복합 SKU 재고, 삭제 SKU/버전 제외, 바코드 검색, 안정적 페이지, 준비 재실행·변경입력 거부·실패 rollback, 다중 바코드 집계.
- Channel unit 32개와 migrated PostgreSQL integration 7개: 다품목·공유 SKU 수량, 부족 시나리오, 저장된 snapshot 재시도, legacy 행 호환.
- Demo 도구 unit 46개. 카탈로그 전체 규모 로컬 apply와 repeat apply, 실제 demo apply 검증.
- Admin 입력/중복 활성화 5개, guide 인증 7개, proxy 4개. desktop 1440 / mobile 390 가로 overflow 없음.
- Root 및 admin TypeScript, 범위 ESLint, Core/Channel build 확인.
- HTML/PDF 검색성·한글 글꼴·링크·47페이지 렌더 확인. Windows demo CI 빌드 성공.

배포 migration은 additive: Channel `request_input`, `lines` JSONB와 Core `sku_barcodes(sku_id)` 인덱스. 전체 SKU 반영 뒤 slow query를 발견해 인덱스·통계·집계 JOIN을 보완하고 DB query timeout 15초를 추가했다.

Windows CI: https://github.com/LCNINE/almondyoung-server/actions/runs/35152405139

설치 파일 SHA-256:
`ff59e4b0b4628db78893f138c60d77caa3f93cf70500ffda1e38830014bb6f76`

## 현장 확인이 남은 항목

지정 Windows PC에서 설치·로그인 callback, HID 스캐너의 Enter suffix, 낱개/박스/위치/송장 판독, 프린터 드라이버·용지·방향·출력물 재스캔은 실물 인수가 필요하다. 문서의 WMS fixture 캡처에는 실제 장비 캡처가 아니라는 표시를 유지했다. 이 항목을 빌드/API 성공으로 대체하지 않았다.

## 카탈로그 재반영 대사

최초 반영과 날짜 정밀도 수정 후 재반영 각각에서 업무 테이블 11개의 전체 행 digest·건수를 비교했고 변경은 0개였다. 두 번째 반영은 실제 demo에서 201.12초, 같은 전체 snapshot의 로컬 반영은 57.82초였다. source timestamp 4종 테이블의 20개 값이 demo와 마이크로초까지 일치했다. 직원 API 검증으로 생성한 발주·입고·출고도 재반영 후 유지됐다.

## 배포 문서 대조

2026-09-17 07:23:38 KST 인증된 실제 URL에서 HTML·CSS·PNG·PDF **20개 파일의 SHA-256이 검수 원본과 모두 일치**했다. 비인증 요청은 307 인증 이동, readiness는 true, 실제 SKU 코드 `58005` 검색은 1개 일치, 1440/390px 화면 가로 overflow와 브라우저 page error는 0이었다.

이전 HTML/PDF 오프라인 ZIP(폐기): `Almond-WMS-demo-training-2026-09-17.zip`.
SHA-256: `c33d7a56cedfa45a84073aab0e2589ebc04df09cfbb621541263227965f4eea3`.

최종 독립 리뷰에서 migration 전 부족재고 run의 기존 입력 재확인이 409로 실패할 수 있는 차이를 발견했다. DB hydration의 `maxQuantity`를 기존 요청 정규화와 일치시키고, 원래 입력과 조회 후 반환 입력 두 경로의 재시도를 DB 회귀 테스트에 추가했다.

호환성 수정은 실제 demo의 migration 전 완료 run `91c4e240-9a01-437e-a32c-56051b8a8794`로도 확인했다. 2026-09-17 07:30:10 KST 원래 legacy 입력 재확인이 HTTP 202를 반환했고, run·items·완료 상태가 모두 동일했다.

호환성 배포 후 ECS `Core`, `ServicesBundleA`, `ServicesBundleB`, `FileService`의 `services-stable` 확인을 통과했다. CI와 같은 root type-check 및 consume-validation gate도 통과했다.

전체 CI 단위 테스트 명령 `corepack yarn jest --ci --silent --maxWorkers=2`는 **649 suites / 5,719 tests 통과**, 155 suites / 1,284 tests는 환경별 opt-in 등으로 skip, 종료 코드 0이었다. 별도로 위 Core/Channel 실제 DB 테스트를 실행했다. Jest는 종료 시 worker timer/teardown 경고를 1회 출력했으며 실패 suite는 없었다.

## Markdown 사용 매뉴얼로 교체 (2026-09-17)

사용자 요청으로 발표형 HTML/PDF 5세트를 제거하고, 작업 절차·입력값·결과·오류 처리 중심의 Markdown 5개와 실제 캡처 27개로 교체했다. 기존 warehouse fixture 캡처 4개는 제거했다. 관리자 웹은 demo 실제 화면, 물류앱은 demo 서버에 연결한 Linux Tauri 실제 실행 화면이다. Linux 홈과 Windows 홈의 입고 메뉴명 차이를 명시했으며 Windows 화면·스캐너·프린터 실물 검증을 주장하지 않는다.

실제 Tauri 로그인, 창고 선택, SKU 58005 발주 10→입고4·적치4→입고6·적치6, 두 품목의 위치별 출고를 수행하고 단계별 화면을 캡처했다. 발주 `07358242-e601-4867-bc5a-ff116eaf13e0`, shipment `b6dba2ed-68a6-4a7c-9f13-76227e8ade5d`, 모의 송장 `997156763867`. 작업자 계정으로 처리했다. 관리자 웹의 선명한 부분 입고 캡처용 발주 `244e0fce-7167-429a-8af2-5c86cbefd192`는 발주10·입고4 상태로 남겨 후속 실습에 사용할 수 있다.

기존 HTML/PDF 검증 항목은 당시 결과의 이력이며 현행 배포 형식을 뜻하지 않는다. 현행 검증: Markdown/PNG·인증·레거시 리다이렉트·PDF 차단 단위테스트18개, 관리자 TypeScript 및 변경 파일 ESLint, 링크/이미지 원본 확인.

Markdown 전환 배포 후 인증된 demo에서 문서5개·스크린샷27개(32파일)의 바이트가 로컬 원본과 모두 일치했다. 비인증 Markdown/PNG/뷰어는 로그인으로 이동, 기존 HTML5개는 새 문서로 이동, 이전 PDF·CSS·미허용 문서는 404였다. 5문서 모두 이미지 로드 성공, 1440/390px 가로 overflow 0, browser page error 0.

현재 오프라인 ZIP: `docs/demo-training/output/distribution/Almond-WMS-demo-manuals-markdown-2026-09-17.zip` (Markdown5 + PNG27). SHA-256: `bf0195dddad61b95770009fa9fbc84f68351155d0a02396d14f190507b94ffcd`.

문서 용어 통일: 공개 매뉴얼 5개의 팀 명칭을 발주 담당자·입출고 담당자로 변경하고, 진행 주체는 개발팀으로 통일했다. 시연·실증 용어를 적용했으며 원본 ZIP도 갱신했다.
