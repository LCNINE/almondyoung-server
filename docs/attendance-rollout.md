# 출결 출시 및 운영 안내

이 문서는 `feat/attendance`의 배포 전 확인과 장애 복구 절차를 정리한다.
로컬 구현은 원격 마이그레이션 적용이나 서비스 배포를 승인한 것으로 취급하지 않는다.
아래 검증 명령은 실행 절차이며 통과 결과를 뜻하지 않는다.
실행 결과와 남은 검사는 실제 검증 기록에 별도로 남긴다.

## 서비스와 설정

`user-service`가 출결 원장, 요청, 승인 이력, 휴가, 개인 설정과 배경 작업을 소유한다.
`file-service`는 비공개 첨부, `ai`는 검토 보조, `notification`은 Web Push를 담당한다.
`admin-web`은 기존 OIDC 세션과 API 프록시를 사용한다.

| 설정 위치 | 변수 | 용도 |
| --- | --- | --- |
| user-service | `AI_SERVICE_URL`, `AI_INTERNAL_KEY` | AI 내부 검토 API 호출 |
| user-service | `NOTIFICATION_SERVICE_URL`, `NOTIFICATION_INTERNAL_KEY` | 알림 내부 전송 API 호출 |
| user-service와 ai | `FILE_SERVICE_URL`, `FILE_SERVICE_INTERNAL_KEY` | 비공개 첨부 소유권·형식·열람 정보 조회 |
| ai | `AI_INTERNAL_KEY` | 내부 검토 API 수신 인증 |
| ai | `ANTHROPIC_API_KEY`, `ATTENDANCE_AI_MODEL` | 출결 검토 제공자 및 모델 |
| notification | `NOTIFICATION_INTERNAL_KEY` | 내부 Web Push 전송 API 수신 인증 |
| notification | `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | VAPID 인증과 연락처 |
| file-service | `FILE_SERVICE_INTERNAL_KEY` | 내부 파일 API 수신 인증 |

호출자와 수신자의 같은 이름 내부 키를 일치시킨다.
내부 호출은 `Authorization: Bearer <키>`를 사용한다.
AI의 `AttendanceModule`과 notification의 `WebPushModule`은 `INTERNAL_KEY_ENV`에 각각 `AI_INTERNAL_KEY`, `NOTIFICATION_INTERNAL_KEY`를 바인딩한다.
`@InternalOnly()`와 `InternalKeyGuard`가 적용되며 수신 키 누락·불일치는 401로 거부한다.
사용자 세션 토큰으로 내부 키를 대체하지 않는다.
키와 제공자 인증값은 비밀 저장소에서 주입하고 예시 파일에 실제 값을 적지 않는다.

`ATTENDANCE_AI_MODEL`에는 운영자가 사용 가능 여부, 구조화 출력 및 이미지 지원을 확인한 승인 모델 ID를 명시한다.
빈 값이면 코드 기본값을 사용하므로 기본값이 해당 계정에서 실행 가능하다고 가정하지 않는다.
이미지가 외부 제공자로 전달되는 처리 조건도 운영자가 확인한다.
AI 설정이나 호출이 실패해도 담당자는 수동으로 요청을 검토할 수 있다.

VAPID 공개 키, 개인 키, subject가 모두 있어야 구독과 발송이 활성화된다.
키 쌍을 유지하고 개인 키는 클라이언트에 전달하지 않는다.
키 교체 시 기존 기기의 구독을 해제하고 새 키로 재구독하는 절차를 확인한다.
Firebase 설정은 이 Web Push 설정을 대신하지 않는다.

SST의 `lcnine-auth`와 `lcnine-services` 앱에는 `AiInternalKey`와 `FileServiceInternalKey`를 같은 값으로 설정한다.
기존 `FileServiceInternalKey`가 있으면 해당 값을 재사용한다.
`lcnine-services`에는 `WebPushPublicKey`와 `WebPushPrivateKey`를 설정한다.
기존 구독이 사용하는 VAPID 키가 있으면 같은 키 쌍을 유지한다.
일반 dev/live 인프라는 `WEB_PUSH_SUBJECT`로 해당 환경의 관리자 웹 HTTPS 주소를 사용한다.
시연 stage는 별도 인프라를 사용하므로 위 일반 환경의 설정만으로 활성화되었다고 판단하지 않는다.

로컬 포트 기준은 [로컬 개발 안내](local-dev.md)를 따른다.
`env-templates/.env.user-service.local.example`의 notification 주소 `:3099`는 SMS 전용 스텁이므로 Web Push 검증에는 실제 notification 주소 `http://localhost:3050`과 일치하는 내부 키가 필요하다.
주소를 변경하기 전에 notification의 SMS 공급자 설정을 확인해 원하지 않는 실발송을 피한다.
실제 `.env`를 예시 파일로 덮어쓰지 않는다.

## 배포 순서

1. 대상 환경과 DB 연결 대상을 확인하고 백업·복원 절차를 준비한다.
   user-service와 notification의 전체 미적용 마이그레이션 목록을 확인한다.
   원격 적용과 배포는 별도 승인된 운영 절차에서 수행한다.
2. 아래 생성된 SQL, snapshot과 각 `meta/_journal.json`의 연결을 검토한다.
   출결 user-service 마이그레이션은 `apps/user-service/database/drizzle/20261016064909_attendance.sql`이다.
   Web Push 마이그레이션은 `apps/notification/database/drizzle/20261016070532_attendance-web-push.sql`이다.
   각각 같은 디렉터리의 `meta/20261016064909_snapshot.json`, `meta/20261016070532_snapshot.json`을 확인한다.
3. 승인된 절차로 두 서비스의 마이그레이션을 먼저 적용한다.
   운영 DB에 `drizzle-kit push`를 사용하거나 기존 이력을 생략해 새 SQL만 임의로 적용하지 않는다.
4. file-service의 `attendance-request-image` 기본 컨텍스트를 기존 참조 데이터 시드 절차에 따라 반영한다.
   비공개 전용, JPG/PNG/WEBP, 장당 10MB 설정과 일반 삭제 API 차단을 확인한다.
   내부 파일 API와 인증을 포함한 file-service를 준비한다.
5. ai와 notification의 내부 키, 외부 제공자 설정 및 VAPID 키를 주입한 뒤 수신 서비스를 준비한다.
   AI 내부 검토와 푸시 내부 전송의 인증 실패·성공을 각각 확인한다.
6. user-service를 배포하고 마스터 계정으로 실제 근무지 좌표·반경·허용 정확도를 등록한다.
   추정 좌표나 임의의 넓은 반경을 운영값으로 넣지 않는다.
   출결 작업 스케줄러는 `APP_STAGE=demo`에서 실행되지 않으므로 운영 환경의 값을 확인한다.
7. admin-web을 배포하고 HTTPS, 로그인 복귀, `/attendance` manifest·service worker 및 API 프록시 연결을 확인한다.
   실제 직원 권한 계정으로 소규모 현장 파일럿을 진행한 뒤 전체 직원에게 안내한다.

근무지 미설정이나 위치 검증 실패 상태에서 성공 기록을 만들지 않는지 확인한다.
운영 설정과 DB 반영 전에 모바일 출결 버튼을 직원에게 사용하도록 안내하지 않는다.
문제 발생 시 배포 이전으로 앱을 복원하더라도 이미 쌓인 원장·요청·감사 이력을 삭제하지 않는다.
스키마 롤백은 데이터 손실과 새 앱의 쓰기 여부를 확인한 별도 복구 계획으로 처리한다.

## 작업 재시도와 장애 복구

`attendance_jobs`는 `pending → running → done` 상태와 `failed` 종료 상태를 갖는다.
30초 주기로 실행하며 한 tick에서 최대 10개 작업을 처리한다.
작업 claim은 행 잠금과 `skipLocked`를 사용하고 120초 lease를 부여한다.
프로세스 종료로 남은 `running` 작업은 lease 만료 후 자동으로 다시 claim한다.
완료는 같은 lease의 실행 결과에만 반영한다.

최대 시도 횟수는 3회다.
실패 시 다음 실행 시각을 `30초 × 누적 시도 횟수` 뒤로 옮긴다.
기한 만료 또는 시도 소진 작업은 이후 claim 정리에서 `failed`로 전환한다.
해당 버전이 아직 검토 대기 중인 AI 요청에는 `ai_status=failed`도 반영한다.
AI와 요청·결정 알림 작업의 기한은 생성 시점에서 24시간이다.
리마인더는 해당 분이 끝나면 만료되며 지난 시각을 소급 발송하지 않는다.

장애 시 작업의 `id`, `kind`, `status`, `attempts`, `run_after`, `lease_until`, `expires_at`과 연결 요청의 버전·상태를 먼저 확인한다.
로그의 작업 ID와 설정·인증·외부 서비스 장애를 대조한다.
원인 수정 후 아직 기한과 시도가 남은 작업의 자동 복구를 관찰한다.
`failed` 작업은 자동으로 다시 실행되지 않으며 현재 구현에는 관리자용 재실행 API가 없다.
필요한 재처리는 운영자가 현재 요청 버전·상태, 작업 기한, 중복 전송 키와 이미 전송된 결과를 검토한 뒤 승인된 유지보수 절차로 수행한다.
과거 요청 버전의 AI 결과를 최신 요청에 복사하거나 완료 원장을 재실행하지 않는다.
AI 실패만으로 직원을 반려하거나 재제출을 강제하지 않고 마스터 수동 검토를 유지한다.

리마인더는 발송 직전 최신 개인 설정·휴가·출퇴근 기록을 다시 확인한다.
알림 지연·미수신 시 페이지의 실제 요청 상태와 출결 원장을 기준으로 안내한다.
`web_push_deliveries`의 동일 작업 키와 구독 ID는 이미 `sent` 또는 `expired`라면 다시 보내지 않는다.
404·410 응답은 구독을 비활성화하며 직원이 다시 구독해야 한다.
그 외 전송 장애는 상위 출결 작업 재시도 대상이다.
외부 푸시 수락 직후 프로세스가 종료되면 DB 완료 기록 전 재시도가 발생할 수 있으므로 잠금화면 수신의 정확히 한 번 전달을 보장하지 않는다.

## 개인정보와 보관 정책

출퇴근 측정 좌표는 검증 입력으로만 사용하며 직원의 원시 좌표를 출결 원장에 보관하지 않는다.
근무지 설정 좌표와 판정 근무지·정책 버전은 별개로 관리한다.
출퇴근 시점 이외의 위치 추적을 수행하지 않는다.
프록시·APM·오류 수집기의 요청 본문에도 좌표, 상세 사유, 내부 키나 서명된 첨부 URL이 남지 않도록 운영 설정을 확인한다.

정정 사유, 첨부, AI 의견과 감사 이력은 업무상 필요한 권한으로 제한한다.
공유 캘린더·현황 응답으로 상세 사유·첨부·AI 의견을 공개하지 않는다.
잠금화면 알림에는 상세 사유·사진·좌표를 넣지 않는다.
AI가 최종 승인·반려, 얼굴 동일인 판정 또는 출석 사실 확정을 수행하지 않음을 직원에게 안내한다.

첨부, 상세 사유, AI 결과·감사 이력, 비활성 푸시 구독·전송 이력 각각의 보관 기간과 파기 책임자를 배포 전에 확정한다.
현재 출결 구현에는 기간을 지정하는 retention 환경변수나 출결 전용 자동 파기 작업이 없다.
임의의 환경변수를 추가하는 것만으로 자동 파기가 동작한다고 안내하지 않는다.
확정 정책에 맞는 정기 정리 작업과 백업 보관 정책을 별도로 준비하고 검증한다.
첨부는 요청 버전·감사 이력의 참조를 먼저 확인한 뒤 도메인이 내부 파일 삭제 절차를 호출한다.
file-service의 물리 파기는 soft delete 후 최소 14일의 기존 유예기간을 검사하며 이는 출결 증빙 전체의 보관 기간을 뜻하지 않는다.
직원과 마스터의 일반 파일 삭제 API로 제출 증빙을 우회 삭제할 수 없어야 한다.

## 검증 명령

저장소 루트에서 Node 22와 Yarn을 사용한다.
각 명령을 순서대로 실행하며 Jest나 Testcontainers를 병렬로 띄우지 않는다.
아래 DB 통합 테스트는 Docker와 `REQUIRE_ATTENDANCE_DB=1`이 필요하며 자체 PostgreSQL 컨테이너를 사용한다.
플래그 없이 실행해 건너뛴 통합 테스트는 통과 증거로 기록하지 않는다.

```sh
corepack yarn jest --runInBand packages/domain-types/attendance.spec.ts apps/user-service/src/api/attendance apps/ai/src/attendance apps/notification/src/web-push apps/admin-web/src/features/attendance
REQUIRE_ATTENDANCE_DB=1 corepack yarn jest --runInBand apps/user-service/src/api/attendance/attendance.integration.spec.ts apps/notification/src/web-push/services/web-push.integration.spec.ts
corepack yarn jest --runInBand apps/file-service/src/access libs/authorization/src/guards/internal-key.guard.spec.ts
corepack yarn --cwd apps/admin-web type-check
corepack yarn eslint apps/admin-web/src/features/attendance apps/admin-web/src/app/attendance apps/admin-web/src/lib/api/domains/attendance
corepack yarn build:user-service
corepack yarn build:file-service
corepack yarn build:ai
corepack yarn build:notification
```

테스트 수, 통과·실패·skip 수와 실행 환경을 실제 결과에서 기록한다.
기존 무관한 빌드·타입 오류는 파일과 오류를 분리해서 남기고 출결 범위 검증 결과와 혼동하지 않는다.
SQL/journal/snapshot 연결 검증은 DB 마이그레이션 적용 승인과 구분한다.

## 현장 및 실기기 잔여 검사

다음 항목은 코드 테스트나 브라우저 화면 확인만으로 완료 처리하지 않는다.

- 실제 사무실 안·입구·경계 밖에서 좌표·정확도·수신 지연을 측정하고 운영 반경과 허용 정확도를 확정한다.
- 위치 권한 거부, 시간 초과, 낮은 정확도, 오래된 측정값, 네트워크 단절 후 재시도와 정정 요청을 확인한다.
- iPhone의 홈 화면 웹앱에서 설치·로그인 복귀·위치·사용자 동작에 따른 푸시 권한·앱 종료 중 수신·알림 클릭 복귀를 확인한다.
- 지원 Android 기기와 브라우저에서도 같은 흐름을 확인한다.
- 로그아웃·계정 전환 뒤 기존 계정 알림 연결이 해제되고 현재 계정만 재구독하는지 확인한다.
- 푸시 거부·VAPID 미설정·AI 지연과 실패에서도 실제 출결 및 마스터 수동 검토가 가능한지 확인한다.
- 본인 상세와 타인 현황의 정보 차이, 일반 직원의 승인 차단, 마스터 자기 승인 감사 이력과 동시 승인 충돌을 확인한다.
- 자정 이후 열린 세션 퇴근, 오전 반차의 평소 퇴근 유지, 종일 휴가 알림 생략과 당일 알림 끄기를 확인한다.
- 선택 첨부 0장·업로드 실패·지원하지 않는 이미지·첨부 비공개 열람·사유 줄바꿈과 촬영 예시 이미지 표시를 확인한다.
- PC·모바일의 고정 모달 헤더/버튼, 본문 스크롤, 배경 스크롤 잠금, 키보드 포커스와 완료음 설정을 확인한다.

## 2026-10-16 로컬 검증 기록

Node 22와 Yarn으로 출결·Web Push·파일 접근·내부 인증의 범위 테스트를 순차 실행했다.
`REQUIRE_ATTENDANCE_DB=1` 상태에서 18개 suite, 141개 테스트가 통과했고 skip은 없었다.
user-service와 notification의 마이그레이션은 각각 독립된 임시 PostgreSQL 컨테이너에 적용했다.
운영 DB에는 적용하지 않았다.

어드민 TypeScript 검사와 user-service, ai, notification, file-service 빌드가 통과했다.
어드민 린트는 루트의 ESLint 바이너리로 Next 설정을 읽으면 플러그인 해석 오류가 나므로 `corepack yarn --cwd apps/admin-web eslint ...`로 해당 앱의 바이너리를 사용했다.
루트 전체 타입 프로그램을 사용하는 혼합 린트는 기본 2GB heap 한도에 도달했다.
백엔드는 저장소의 ESLint 규칙을 그대로 가져오고 검사 파일을 출결·Web Push·AI와 공유 계약으로 제한한 임시 TypeScript 프로젝트로 검사했다.
이 검사는 저장소 전체 린트 통과를 뜻하지 않는다.

브라우저 시안에서 촬영 이미지, 연속 휴가의 주 경계 연결 막대와 접힌 날짜별 조정 화면을 확인했다.
시안 데이터는 실제 출결 및 운영 DB와 연결되지 않는다.
실제 모바일 위치·푸시와 현장 반경 측정은 위 잔여 검사대로 별도 확인한다.

## 2026-10-19 모바일 우선 보완

PWA의 근무지 미등록 상태에서 관리자 등록 화면으로 직접 이동한다.
`/attendance/worksites`는 기존 관리자 권한과 API 검증을 사용하며, 현재 위치 채우기는 사용자가 버튼을 누를 때만 실행한다.
기록·일정·요청·설정·근무지 화면은 공통 모바일 상단 내비게이션을 사용한다.
좁은 화면의 시각 입력과 인증·요청 폼은 세로 배치하고, 다이얼로그는 화면 여백과 내부 스크롤을 유지한다.
오늘의 근무를 불러오는 동안 실제 카드 구조에 맞춘 스켈레톤을 표시한다.

최종 집중 검사에서 8개 suite, 24개 테스트가 통과했다.
어드민과 인증 앱의 타입 검사, 출결 변경 파일 린트를 통과했다.
인증의 생년월일 입력에는 변경 전부터 있던 `react-hooks/set-state-in-effect` 린트 오류가 남아 있으며, 이번 변경은 해당 로직을 수정하지 않았다.

로컬 푸시 설정 조회의 500은 알림 서버 미기동으로 인한 연결 거부였다.
별도 로컬 알림 DB와 VAPID 키를 설정한 뒤, 인증된 HTTPS 프록시 설정 조회가 200으로 응답하고 `configured=true`인 것을 확인했다.
이 확인은 실제 휴대폰 수신 성공을 의미하지 않는다.
휴대폰 구독 등록, 잠금 화면 수신 및 알림 클릭 복귀는 실기기에서 확인해야 한다.

## 월별 통계와 향후 급여 계산 연동

현재 월별 통계의 안내 문구는 “급여 계산이나 지각·결근 판정은 포함하지 않아요.”이다.
추후 급여 계산 기능을 연결할 때는 이 문구를 반드시 실제 지원 범위에 맞게 수정한다.
급여 계산만 추가하고 지각·결근 판정을 지원하지 않는다면, 두 기능을 함께 지원하는 것으로 읽히지 않게 구분해 안내한다.

수정 대상은 `apps/admin-web/src/features/attendance/components/statistics-summary.tsx`의 `StatisticsBasis`이다.
어드민웹과 PWA가 같은 컴포넌트를 사용하므로 두 화면에서 바뀐 문구를 함께 확인한다.
현재 기록시간은 퇴근 완료 기록의 출근~퇴근 간격이며 휴게시간을 차감하지 않는다.
급여 연동 시에는 휴게시간 차감, 퇴근 미완료 기록, 야간 근무의 월 귀속, 정정·승인 반영 시점을 먼저 확정하고 집계 설명과 검증 항목도 함께 갱신한다.
