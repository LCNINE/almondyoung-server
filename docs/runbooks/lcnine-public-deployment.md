# lcnine-public 배포 사용 안내

`lcnine-public`은 이 저장소의 고정된 AWS 빌드 작업을 호출하는 배포 사용자입니다. 배포할 때는 [배포 스크립트](../../scripts/almondyoung-deploy.py)를 사용합니다. 이 사용자의 키는 로컬에서 `sst deploy`를 직접 실행하기 위한 권한이 아닙니다.

## 배포 대상과 동작

- AWS 계정: LCNINE Dev Team, 리전: `ap-northeast-2` (서울)
- IAM 사용자: `lcnine-public` (콘솔 로그인 없음)
- 소스: `LCNINE/almondyoung-server`의 `develop` 브랜치
- 스크립트가 지원하는 환경: `dev`, `demo`, `live`. 실제 사용 가능 여부는 환경별 `check`로 확인합니다.
- 실행 경로: 스크립트 → `almondyoung-deploy-control` Lambda → 환경별 CodeBuild
- v2 배포 순서: 캐시 복원 → 미적용 Drizzle 마이그레이션 검사·실행 → 필요한 `lcnine-auth` → 필요한 `lcnine-services` → 캐시 저장

CodeBuild가 실행 시점의 `develop` 코드를 가져옵니다. 로컬 작업 파일을 업로드하지 않으며, 임의 브랜치·커밋·명령·환경변수로 빌드를 덮어쓰는 기능은 없습니다. 배포할 변경은 먼저 GitHub 쓰기 권한이 있는 사람이 `develop`에 반영해야 합니다. GitHub Read 권한만 있는 계정은 clone·pull은 가능하지만 push는 할 수 없습니다.

**v2 코드가 develop에 있는 것과 AWS에 연결된 것은 별개입니다.** `check`에서 `pipelineVersion: 2`, `ready: true`가 확인돼야 아래 자동 마이그레이션/선택 배포가 적용됩니다. 기존 v1 작업은 두 스택을 매번 실행하고 Drizzle 마이그레이션은 포함하지 않습니다. 새 스크립트는 v1 또는 준비되지 않은 환경에서 배포를 시작하지 않습니다. 관리자는 [v2 연결 절차](../../deployments/ci/README.md)를 적용합니다.

플랫폼 최초 구성, DB bootstrap/seed, 파괴적 변경을 포함한 유지보수는 자동 배포에 포함되지 않습니다.

## 작업 컴퓨터 구분

- **GitHub 쓰기 권한이 있는 Mac:** 별도 작업 브랜치/폴더에서 코드·배포 스크립트·런북 수정 및 관련 검증 → develop 반영 → push. VS Code에서 다른 작업 중인 브랜치나 변경사항은 건드리지 않습니다.
- **GitHub Read인 원격 Windows VS Code:** develop을 pull하고 고정 배포 스크립트 실행·결과 조회만 합니다. 원격에서 구현·커밋·push를 지시하지 않습니다.
- **AWS 관리자:** CodeBuild/Lambda 실행 설정, 배포 역할의 필요한 권한, DB 내부망 연결을 적용합니다. 공용 사용자에게 관리자 권한을 추가하지 않습니다.

## 최초 설정

AWS CLI v2와 Python 3가 필요합니다. 아래 명령은 모두 **저장소 루트**에서 실행합니다. 예제의 `python`은 Python 3를 가리켜야 하며, 환경에 따라 `python3` 또는 Windows의 `py -3`로 바꿉니다.

이미 `almondyoung` 프로필에 전달받은 키를 등록했다면 다시 설정할 필요가 없습니다. 새 컴퓨터에서는 다음 명령의 질문에 CSV의 키 값을 입력합니다.

```sh
aws configure --profile almondyoung
```

- AWS Access Key ID: 전달받은 CSV의 Access key ID
- AWS Secret Access Key: 전달받은 CSV의 Secret access key
- Default region name: `ap-northeast-2`
- Default output format: `json`

프로필 이름은 컴퓨터 안에서 사용하는 별칭입니다. IAM 사용자 이름과 같을 필요는 없습니다. 아래 예제는 `--profile almondyoung`을 명시하며, 이 옵션을 생략하면 스크립트는 `lcnine-public` 프로필을 사용합니다.

**키 CSV, 실제 키 값, AWS credentials 파일은 저장소나 채팅에 올리지 않습니다.**

## 연결 확인

```sh
python scripts/almondyoung-deploy.py check live --profile almondyoung
```

이 명령은 배포를 시작하지 않습니다. Lambda 연결 및 v2 준비 표시를 확인합니다. `pipelineVersion: 2`, `ready: true`도 실제 DB 접속·마이그레이션 성공·모든 SST 권한을 검증한 결과는 아닙니다. AWS 설정이 아직 v1이면 종료 코드 1과 관리자 적용 안내가 나옵니다.

## 배포 실행

AWS 연결만 검증하고 배포/DB 변경 없이 기다려야 하면 다음을 사용합니다.

```sh
python scripts/almondyoung-deploy.py validate live --profile almondyoung
```

관리자가 v2 buildspec을 연결한 환경에서만 실행됩니다. CodeBuild 비용은 발생하지만 DB는 READ ONLY 트랜잭션으로 연결·이력·미적용 SQL을 검사하며 마이그레이션 SQL, 앱 배포, 성공 기준/캐시 저장은 하지 않습니다. 반환된 buildId를 아래 status로 추적합니다. `SUCCEEDED`여도 실제 배포나 마이그레이션을 완료했다는 뜻은 아닙니다.

테스트한 변경이 원격 `develop`에 반영됐는지 먼저 확인합니다. 원하는 환경 하나를 선택하며, **`live`는 실제 운영 서버를 변경합니다.**

원격 작업 트리가 깨끗하고 현재 브랜치가 develop인지 확인한 뒤 `git pull --ff-only origin develop`로 스크립트/문서도 최신화합니다. 로컬 변경이 있으면 reset/clean으로 지우지 말고 보존한 채 원인을 확인합니다. 환경의 기존 빌드가 실행 중인지 먼저 확인합니다.

```sh
python scripts/almondyoung-deploy.py deploy live --profile almondyoung
```

개발 또는 시연 환경은 `live`를 각각 `dev`, `demo`로 바꿉니다. 출력된 `buildId`를 보관합니다. 명령이 반환됐다는 사실만으로 배포가 끝난 것은 아닙니다.

매번 `deploy`를 실행하면 새로운 배포 요청이 만들어집니다. 응답이 늦거나 연결이 끊겼다면 바로 재실행하지 말고 기존 빌드의 상태를 먼저 확인합니다. `buildId`를 받지 못한 경우에는 아래 목록 조회로 확인합니다.

```sh
aws codebuild list-builds-for-project --project-name almondyoung-deploy-live --sort-order DESCENDING --profile almondyoung --region ap-northeast-2
```

목록의 ID를 `status`로 조회해 진행 중인 작업을 확인합니다. 목록 권한은 지정된 세 배포 프로젝트에만 있으며 상세 로그 조회 권한과는 다릅니다.

## 자동 마이그레이션·변경 감지·캐시

v2 연결 후에는 별도로 “마이그도 해줘”라고 요청하지 않습니다.

- **Drizzle:** 앱 변경과 무관하게 두 스택의 DB를 확인합니다. SST 링크 및 해당 환경 테넌트 목록을 사용하고 Core는 모든 등록 테넌트를 포함합니다. 미적용 SQL만 순서대로 실행하며, DB별 잠금으로 같은 실행기의 중복을 막습니다. 이력 불일치·기존 DB의 이력 누락·위험한 SQL·접속 실패 시 후속 앱 배포를 시작하지 않습니다. 이미 성공한 다른 DB 변경을 자동으로 되돌리지는 않습니다.
- **Medusa:** 기존 Admin 컨테이너 시작 시 마이그레이션을 실행하고 store는 생략합니다. 별도 사전 실행을 추가하지 않습니다. 따라서 Medusa 실패 시 services 일부 리소스는 이미 바뀌었을 수 있습니다.
- **선택 배포:** 각 스택의 마지막 성공 커밋과 비교합니다. auth 변경/공용 코드/의존성/공통 배포 설정은 필요한 양쪽에 반영합니다. 판정 기준이 없으면 전체 배포합니다. services 내부 앱별 빌드 생략은 아직 구현하지 않았습니다.
- **캐시:** npm/Yarn 다운로드 및 각 Next.js `.next/cache`를 전용 S3에 환경·도구 버전·의존성별로 저장·복원합니다. Docker는 기존 ECR 캐시를 유지합니다. 복원 로그만으로 컴파일러의 실제 hit를 단정하지 않습니다.

Git 밖의 Secret·SSM·AWS 설정 변경을 반영하거나 전체 재배포가 필요하면 아래 명령을 사용합니다. 마이그레이션 검사를 건너뛰는 옵션은 없습니다.

```sh
python scripts/almondyoung-deploy.py deploy live --force-full --profile almondyoung
```

마이그레이션이 차단되면 임의로 `db:setup`, `drizzle-kit push`, reset, 과거 SQL 수정, 이력 테이블 수정을 실행하지 않습니다. 환경·buildId·DB/서비스 이름·실패 단계로 관리자에게 확인합니다. 정당한 컬럼 삭제/이름 변경 등은 ADR-0005의 별도 유지보수 순서를 따릅니다.

## 완료 상태 확인

아래 `buildId` 자리에는 배포 명령이 반환한 전체 값을 입력합니다. 환경도 배포할 때와 같아야 합니다.

```sh
python scripts/almondyoung-deploy.py status live "almondyoung-deploy-live:반환된-빌드-UUID" --profile almondyoung
```

- `IN_PROGRESS`: 진행 중. 같은 `buildId`로 상태를 다시 확인합니다.
- `SUCCEEDED`: 요청한 작업 성공. `deploy`였다면 선택된 앱 배포와 Drizzle 사전 단계가 성공한 것입니다. 서비스 응답/변경된 프런트 버전도 확인합니다. `validate`였다면 읽기 검증만 성공했으며 앱 배포나 마이그레이션 SQL은 실행하지 않았습니다.
- `FAILED`, `FAULT`, `TIMED_OUT`, `STOPPED`: 실패 또는 중단. 관리자에게 환경과 `buildId`, 반환된 상태를 전달합니다.

`status` 명령의 종료 코드가 0이어도 배포 성공을 뜻하지는 않습니다. 출력된 빌드 상태를 확인해야 합니다. 상세 CodeBuild 로그는 관리자가 확인합니다.

## 권한 오류가 나면

### 로컬 SST 실행 중 S3·SSM·ECS 접근이 거부됨

`s3:GetObject`로 SST 배포 상태를 읽다가 403이 발생하거나, SST 비밀값·ECS 상세 정보 조회가 거부될 수 있습니다. `lcnine-public`에는 이러한 직접 접근 권한이 없습니다. 이 프로필로 로컬 `sst deploy`를 계속 재시도하지 말고 위 스크립트로 고정 배포 작업을 호출합니다.

사용자에게 허용된 직접 권한은 지정 Lambda 호출, 지정된 세 프로젝트의 `codebuild:ListBuildsForProject`, `/sst/bootstrap`에 대한 `ssm:GetParameter`, 서울 리전의 `ecs:ListClusters`입니다. 일부 조회가 된다고 해서 로컬 SST 직접 배포까지 허용된 것은 아닙니다. IAM·결제 관리나 빌드 역할 직접 사용 권한도 없습니다.

### Lambda 호출이 거부됨

사용 중인 프로필이 맞는지 확인합니다.

```sh
aws sts get-caller-identity --profile almondyoung
```

예상 IAM 사용자는 `lcnine-public`입니다. 다른 사용자라면 프로필 설정을 확인하고, 맞는 사용자라면 관리자에게 `almondyoung-deploy-control`의 `lambda:InvokeFunction` 권한 확인을 요청합니다. 키 값을 전달할 필요는 없습니다.

### CodeBuild는 시작됐지만 배포가 실패함

관리자가 해당 `buildId`의 로그에서 실패한 AWS 작업과 리소스를 확인합니다. 권한이 부족하면 CodeBuild 실행 역할 `AlmondyoungFixedDeployRunner`에서 필요한 범위만 조정합니다. 공용 사용자에게 관리자 권한이나 광범위한 S3·IAM 권한을 추가하는 방식으로 해결하지 않습니다.

기반 시설의 최초 생성이나 IAM·VPC·데이터베이스 구조 변경은 별도 관리자 작업이 필요할 수 있습니다. dev·demo 기반 시설이 아직 없는 경우에도 먼저 확인합니다.

## 운영 참고

- 환경별 CodeBuild 프로젝트: `almondyoung-deploy-dev`, `almondyoung-deploy-demo`, `almondyoung-deploy-live`
- 환경별 동시 빌드: 1개, 빌드 제한 시간: 120분
- 실행 시 CodeBuild 및 관련 AWS 사용료가 발생합니다.
- 2026-11-11 기존 v1 라이브 작업의 배포 성공과 서비스 HTTP 응답을 확인했습니다. 이 사실은 **이번 v2의 AWS 연결·캐시 적중·운영 DB 마이그레이션 검증을 뜻하지 않습니다.** 소스 반영, AWS 적용, 실제 배포 결과를 구분해 보고합니다.
- 2026-11-11 live에 v2 Lambda/buildspec, 전용 캐시 저장소와 운영 사설망 구성을 적용했습니다. 첫 읽기 검증의 ENI 정리 권한 오류를 배포 역할에서 보완한 뒤, 원격 VS Code에서 요청한 `almondyoung-deploy-live:82216a6b-0156-4ccd-92ee-9c3406550841` 읽기 검증이 `SUCCEEDED`로 종료됐습니다. 검증 커밋 `384db9bf23`에서 user-service, Core 테넌트 2개 및 나머지 서비스 등 총 12개 Drizzle 대상의 이력이 일치했고 미적용 항목은 모두 0개였습니다. 실제 앱 배포·마이그레이션 SQL·캐시/성공 기준 저장은 실행하지 않았습니다. 캐시는 최초 `miss`였으므로 저장·후속 복원·실제 빌드 적중은 배포 후 별도로 확인합니다. 실행 전 `check live`로 현재 준비 표시를 확인합니다.
- 현재 dev·demo용 DB와 기반 VPC는 준비되지 않았으므로 v2 설치/준비 목록에 넣지 않았습니다. 해당 환경 요청을 live DB로 연결하지 않습니다.

## 다음에 배포를 요청할 때

이 안내와 스크립트가 원격 저장소에 반영된 뒤, 다음 문구를 사용합니다. 개발·시연 배포라면 `live`를 원하는 환경으로 바꿉니다.

```text
런북 읽고 최신 develop을 pull한 다음 live 배포해줘.
```

원격 에이전트는 작업 트리 확인 → pull → 기존 빌드 확인 → `check` → `deploy` → 같은 buildId의 `status` → 서비스 확인 순서로 진행합니다. v2 미연결이면 기존 배포를 대신 실행하지 말고 관리자 연결 작업을 알립니다. 실패하면 환경·커밋·buildId·비밀값을 뺀 오류·부분 반영 여부를 보고합니다. “배포 성공”과 “마이그레이션 확인 불가”를 섞어 완료로 보고하지 않습니다.
