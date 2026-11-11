# lcnine-public 배포 사용 안내

`lcnine-public`은 이 저장소의 고정된 AWS 빌드 작업을 호출하는 배포 사용자입니다. 배포할 때는 [배포 스크립트](../../scripts/almondyoung-deploy.py)를 사용합니다. 이 사용자의 키는 로컬에서 `sst deploy`를 직접 실행하기 위한 권한이 아닙니다.

## 배포 대상과 동작

- AWS 계정: LCNINE Dev Team, 리전: `ap-northeast-2` (서울)
- IAM 사용자: `lcnine-public` (콘솔 로그인 없음)
- 소스: `LCNINE/almondyoung-server`의 `develop` 브랜치
- 환경: `dev`, `demo`, `live`
- 실행 경로: 스크립트 → `almondyoung-deploy-control` Lambda → 환경별 CodeBuild
- 배포 순서: `lcnine-auth` → `lcnine-services`

CodeBuild가 실행 시점의 `develop` 코드를 가져옵니다. 로컬 작업 파일을 업로드하지 않으며, 임의 브랜치·커밋·명령·환경변수로 빌드를 덮어쓰는 기능은 없습니다. 배포할 변경은 먼저 GitHub 쓰기 권한이 있는 사람이 `develop`에 반영해야 합니다. GitHub Read 권한만 있는 계정은 clone·pull은 가능하지만 push는 할 수 없습니다.

이 고정 작업에는 플랫폼 배포나 별도 유지보수·마이그레이션 실행이 포함되지 않습니다.

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

이 명령은 배포를 시작하지 않습니다. Lambda 호출과 지정된 환경 연결만 확인하며, 실제 SST 배포에 필요한 모든 권한이나 배포 성공을 검증하지는 않습니다.

## 배포 실행

테스트한 변경이 원격 `develop`에 반영됐는지 먼저 확인합니다. 원하는 환경 하나를 선택하며, **`live`는 실제 운영 서버를 변경합니다.**

```sh
python scripts/almondyoung-deploy.py deploy live --profile almondyoung
```

개발 또는 시연 환경은 `live`를 각각 `dev`, `demo`로 바꿉니다. 출력된 `buildId`를 보관합니다. 명령이 반환됐다는 사실만으로 배포가 끝난 것은 아닙니다.

매번 `deploy`를 실행하면 새로운 배포 요청이 만들어집니다. 응답이 늦거나 연결이 끊겼다면 바로 재실행하지 말고 기존 빌드의 상태를 먼저 확인합니다. `buildId`를 받지 못한 경우에는 관리자에게 진행 중인 빌드 확인을 요청합니다.

## 완료 상태 확인

아래 `buildId` 자리에는 배포 명령이 반환한 전체 값을 입력합니다. 환경도 배포할 때와 같아야 합니다.

```sh
python scripts/almondyoung-deploy.py status live "almondyoung-deploy-live:반환된-빌드-UUID" --profile almondyoung
```

- `IN_PROGRESS`: 진행 중. 같은 `buildId`로 상태를 다시 확인합니다.
- `SUCCEEDED`: 빌드·배포 작업 성공.
- `FAILED`, `FAULT`, `TIMED_OUT`, `STOPPED`: 실패 또는 중단. 관리자에게 환경과 `buildId`, 반환된 상태를 전달합니다.

`status` 명령의 종료 코드가 0이어도 배포 성공을 뜻하지는 않습니다. 출력된 빌드 상태를 확인해야 합니다. 상세 CodeBuild 로그는 관리자가 확인합니다.

## 권한 오류가 나면

### 로컬 SST 실행 중 S3·SSM·ECS 접근이 거부됨

`s3:GetObject`로 SST 배포 상태를 읽다가 403이 발생하거나, SST 비밀값·ECS 상세 정보 조회가 거부될 수 있습니다. `lcnine-public`에는 이러한 직접 접근 권한이 없습니다. 이 프로필로 로컬 `sst deploy`를 계속 재시도하지 말고 위 스크립트로 고정 배포 작업을 호출합니다.

사용자에게 허용된 직접 권한은 지정 Lambda 호출, `/sst/bootstrap`에 대한 `ssm:GetParameter`, 서울 리전의 `ecs:ListClusters`입니다. 일부 조회가 된다고 해서 로컬 SST 직접 배포까지 허용된 것은 아닙니다. IAM·결제 관리나 빌드 역할 직접 사용 권한도 없습니다.

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
- 2026-11-11 기준 연결 확인과 일부 조회 권한은 검증했지만, 이 구성으로 실제 서버 배포를 완료한 것은 아닙니다. 테스트 통과와 연결 확인만으로 배포 성공을 보고하지 않습니다.

## 다음에 배포를 요청할 때

이 안내와 스크립트가 원격 저장소에 반영된 뒤, 다음 문구를 사용합니다. 개발·시연 배포라면 `live`를 원하는 환경으로 바꿉니다.

```text
docs/runbooks/lcnine-public-deployment.md를 먼저 읽어 줘.
테스트한 변경이 origin/develop에 반영됐는지 확인한 뒤,
AWS 프로필 almondyoung과 scripts/almondyoung-deploy.py로 live에 배포해 줘.
check → deploy → status 순서로 진행하고 최종 성공 또는 실패까지 확인해 줘.
lcnine-public으로 직접 sst deploy하거나 권한을 임의로 늘리지 말고,
실패하면 환경·buildId·오류를 알려 줘.
```
