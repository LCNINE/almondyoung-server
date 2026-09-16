# Demo 운영 메모

## 접속과 범위

- 관리자 콘솔: https://admin.almondyoung-next.com/demo
- 로그인: https://auth.almondyoung-next.com
- 업무 API: https://core.almondyoung-next.com
- 계정: `demoadmin`(관리자), `demoworker`(창고 작업자).
- 로컬 비밀 파일 `.env.demo-access`에 초기 비밀번호를 보관한다. Git·이미지·문서에 비밀번호를 넣지 않는다.
- 로그인 DTO는 소문자·숫자 ID, 8–20자 비밀번호를 받는다. demo 생성 비밀번호는 무작위 20자다.
- `demoworker`는 `logistics_worker` 역할만 갖는다. demo 콘솔 및 관리자 API는 접근할 수 없다.
- apex/www와 기존 CloudFront 배포는 그대로 유지한다. demo 서비스는 하위 도메인을 사용한다.

## 재배포

순서: `deployments/lcnine/platform` → `auth` → `services`에서 `sst deploy --stage demo`.

최초 생성에서만 auth/services에 `DEMO_INFRA_ONLY=true`로 DB와 네트워크를 먼저 만든다. 런타임 배포를 완료한 stage에 이 옵션으로 deploy하면 애플리케이션 리소스가 제거되므로 사용하지 않는다. DB 명령을 위한 `sst shell` 평가에만 사용하는 것은 리소스를 변경하지 않는다.

DB 순서는 배포별 `db:bootstrap` → `db:migrate` → `db:seed:ref` → `db:seed:demo --group demo-logistics`다. 공통 인자는 `--stage demo --deployment lcnine-auth` 또는 `lcnine-services` 및 `--yes`다. 최초 infra-only 상태에서는 DB 명령에 `--infra-only`도 전달한다.

인증 seed 실행 시 `.env.demo-access`의 `DEMO_ADMIN_PASSWORD`, `DEMO_WORKER_PASSWORD`, `ADMIN_INITIAL_PASSWORD`, `ADMIN_WEB_OIDC_CLIENT_SECRET`를 환경변수로 공급한다. 마지막 값은 services SST secret `AdminWebOidcClientSecret`과 같아야 한다. auth 스택 자체에는 이 secret이 자동 주입되지 않는다. seed는 기존 비밀번호·RP secret을 임의로 덮어쓰지 않는다. 변경 시 인증 관리 API의 비밀번호 재설정·클라이언트 secret 회전과 SST secret 갱신을 함께 수행한다.

실행 환경의 SST 터널에 프로세스 없이 남은 `sst` 인터페이스가 있어 최초 설치는 demo bastion을 통한 localhost 전용 SSH port forwarding으로 수행했다. live 터널이나 시스템 인터페이스를 변경하지 않았다. 관련 임시 도구·키는 gitignored `.superpowers/sdd/2026-09-16-demo-stage/`에 있다.

## 시연 순서

1. 콘솔에서 준비 상태와 상품·수요·납기 이력을 확인한다.
2. 발주 추천에서 국내·해상·항공 공급사 조건을 확인하고 발주서를 만든다.
3. 부분 입고 → 잔량 입고 → 적치·이동을 수행한다.
4. 콘솔에서 정상 출고 또는 재고 부족 주문을 생성한다. 정상 기본 상품은 30번, 부족 기본 상품은 1번이다.
5. 생성 이력의 주문번호를 눌러 주문 검색으로 이동한다. 이벤트 접수 완료는 주문/출고 준비 완료와 다르며, 비동기 반영 시간을 고려한다.
6. 기존 송장·출고 배치 화면과 물류 앱에서 피킹·검수·출고를 진행한다.
7. 콘솔의 모의 택배, 판매채널 반영, 알림 결과를 확인한다. 실제 외부 업무 시스템에는 전송하지 않는다.

생성 요청은 브라우저에 requestId를 먼저 보관한다. 네트워크 오류 후 재확인은 같은 requestId로 처리한다. 일부 실패 재시도는 미완료 항목만 처리한다. 초기화/삭제 기능은 콘솔에 제공하지 않는다.

## 물류 앱

`yarn --cwd native/warehouse-app tauri:build:demo`로 demo 전용 앱을 만든다. 별도 앱 식별자 `kr.lcnine.almondwms.demo`, callback `almondwms-demo://oauth/callback`, demo API·issuer·authorize URL을 사용한다. 운영 앱의 로컬 저장소와 분리된다.

호스트 OS용 설치 파일과 웹 번들 검증, 실제 Windows/PDA의 스캐너·프린터·딥링크 검증은 구분한다. 다른 OS의 서명된 설치 파일은 해당 OS/SDK에서 빌드해야 한다.

## 검증 상태

진행 중인 실제 배포 및 시나리오 결과는 완료 후 아래에 기록한다. 단위 테스트 통과만으로 실제 출고 완료를 주장하지 않는다.
