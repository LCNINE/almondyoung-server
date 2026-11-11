# 고정 배포 파이프라인 v2 — 관리자 적용

이 디렉터리는 기존 `almondyoung-deploy-{dev,demo,live}` CodeBuild 작업의 설정을 저장소에서 관리하기 위한 구성입니다. **파일을 develop에 머지한 것만으로 AWS 설정이 바뀌지는 않습니다.** AWS 적용과 실제 실행 검증을 마칠 때까지 v2는 준비 상태입니다.

## 실행 경로

원격 PC의 `scripts/almondyoung-deploy.py` → 고정 Lambda → CodeBuild의 이 `buildspec.yml` → develop의 `scripts/deployment/pipeline.py`.

공용 사용자는 GitHub Read와 기존 Lambda 호출 권한을 유지합니다. 소스·문서 수정/커밋/push는 쓰기 권한이 있는 Mac에서 별도 브랜치로 진행해 develop에 반영합니다. 원격에서는 pull과 배포/조회만 합니다.

## v2의 동작과 범위

1. 환경별·스택별 마지막 성공 커밋을 전용 S3 `success/<stage>.json`에서 읽습니다. 각 스택의 성공 직후에만 해당 기준을 갱신합니다. 실패한 스택은 이전 기준을 유지합니다.
2. Git 변경 경로를 계산합니다. auth 변경은 services에도 전파하고 공용 라이브러리·패키지·루트 의존성·공통 배포 구성·미분류 경로는 두 스택을 모두 선택합니다. 기준/커밋을 못 찾으면 전체를 선택합니다. 문서만 바뀌면 앱 배포는 생략합니다. 외부 Secret·SSM·콘솔 설정 변경은 Git으로 감지할 수 없으므로 `--force-full`을 사용합니다.
3. 전용 S3 `cache/<stage>/...`에서 npm/Yarn 다운로드 캐시와 네 Next.js 앱의 `.next/cache`를 복원합니다. 환경·Linux ARM64·Node/npm/Yarn/SST 버전·lockfile/package.json·Next/OpenNext 설정으로 키를 나눕니다. 기존 ECR Docker 캐시는 유지합니다. 전체 `node_modules`, `.env`, AWS credentials, SST 상태/비밀값은 캐시하지 않습니다.
4. 앱 변경 여부와 무관하게 auth/services의 Drizzle 마이그레이션을 검사합니다. 기존 SST DB 링크와 SSM 테넌트 목록을 사용하며 모든 Core 테넌트 DB를 포함합니다. DB별 advisory lock을 가진 동일 연결에서 이력의 시간·해시가 저장소의 연속된 이력과 일치하는지 확인하고 미적용 항목만 실행합니다. 하나라도 실패하면 앱 배포를 시작하지 않습니다.
5. 선택한 스택만 기존 SST 명령으로 auth → services 순서로 배포합니다. services 내부 앱별 빌드 생략/상태 분리는 이번 변경에 포함되지 않습니다. 리소스 선언을 조건부로 제거하지 않습니다.
6. 캐시를 저장하고 단계별 소요 시간과 커밋/선택 단위를 JSON 로그에 남깁니다. `cache: restored`는 캐시 파일 복원 성공이며 Next 컴파일러/Docker의 실제 cache hit를 의미하지 않습니다. Docker hit는 원래 빌드 로그의 `CACHED` 등을 별도로 확인합니다.

**Medusa는 기존 Admin 컨테이너 시작 시 `medusa db:migrate --execute-safe-links` 실행을 유지합니다.** store는 기존처럼 생략합니다. v2가 별도로 Medusa CLI를 실행하지 않으므로 중복 경로를 추가하지 않습니다. Drizzle 사전 단계와 Medusa 시작 단계는 다릅니다. Medusa 마이그레이션 실패 시 다른 services 리소스가 이미 반영됐을 수 있으므로 전체가 원자적으로 롤백됐다고 보고하지 않습니다.

마이그레이션은 bootstrap/seed/push/reset/자동 rollback을 실행하지 않습니다. 이력이 없는 기존 DB나 바뀐 과거 SQL은 자동 기준 맞추기를 하지 않고 중단합니다. DROP/TRUNCATE/RENAME/타입 변경/NOT NULL/데이터 UPDATE·DELETE/동적 SQL 등은 보수적인 패턴 검사로 차단합니다. 이는 SQL 안전성 증명이 아니므로 모든 마이그레이션의 리뷰와 dev 검증은 계속 필요합니다. 정당한 contract 변경은 ADR-0005에 따라 별도 유지보수 절차로 수행합니다.

## AWS 전제 조건

- 현재 프로젝트/서비스 역할/소스/환경/로그/네트워크 설정을 먼저 백업·비교합니다. 이 문서의 예시를 기존 CloudFormation 전체 템플릿 대신 덮어쓰지 않습니다.
- `storage.yml`은 비공개 암호화 S3 버킷과 **AlmondyoungFixedDeployRunner만** 사용할 S3 ListBucket/GetObject/PutObject 정책을 만듭니다. ListBucket은 이 새 전용 버킷에만 적용합니다. 공용 IAM 사용자에게는 붙이지 않습니다. 성공 이력은 만료시키지 않고 캐시는 30일 만료합니다.
- 같은 템플릿의 VpcId/PrivateSubnetId/DatabaseSecurityGroupId에는 확인된 기존 리소스를 전달합니다. 새 빌드 보안 그룹은 인바운드 없이 HTTPS 및 지정 DB 보안 그룹의 PostgreSQL 포트로만 송신합니다. ENI 생성·삭제는 지정 서브넷에 제한하고 연결 권한은 CodeBuild 서비스에 제한합니다. 기존 DB 보안 그룹의 내부망 허용을 확인해야 하며 이 템플릿은 기존 DB/서브넷/라우팅 규칙을 수정하지 않습니다.
- CodeBuild를 해당 stage의 기존 platform VPC/private subnet에 연결합니다. 두 RDS DB에 대한 DB 포트 접근과 GitHub/npm/ECR/S3/AWS API로 나갈 NAT 또는 적절한 엔드포인트가 필요합니다. DB를 인터넷에 공개하지 않습니다.
- CodeBuild VPC ENI에 필요한 EC2 권한은 해당 VPC/subnet 및 CodeBuild 서비스 조건으로 한정해 배포 역할에 추가합니다. 기존 DB security group에는 해당 빌드 security group만 허용합니다. VPC/보안 그룹 ID를 추측해서 적용하지 않습니다.
- 배포 역할이 기존 SST 링크와 `/lcnine-auth/<stage>/tenant-list`를 읽을 수 있어야 합니다. 공유 사용자에게 DB 비밀값을 전달하지 않습니다. 필요 권한은 실제 거부 리소스를 확인해 역할에만 보완합니다.

## 적용 순서

1. develop 반영 후 기존 빌드가 모두 종료됐는지 확인합니다. stage별로 dev에서 먼저 검증합니다.
2. 관리자가 현재 CodeBuild 프로젝트 설정을 안전한 임시 파일로 내보냅니다. 실제 환경변수가 들어갈 수 있으므로 Git/채팅에 올리지 않습니다.
3. `storage.yml`을 검토·적용하고 나온 버킷 이름, 검증한 VPC/private subnet/build security group을 준비합니다.
4. 아래 준비 도구로 **기존 환경 설정을 보존하는** UpdateProject JSON을 생성합니다. 이 도구는 AWS를 호출하지 않습니다.

   ```sh
   python3 deployments/ci/prepare_project_update.py \
     --snapshot /안전한/임시경로/project.json \
     --bucket 전용버킷이름 --vpc 확인한VPC \
     --subnets 확인한PrivateSubnet \
     --security-groups 확인한BuildSecurityGroup \
     --output /안전한/임시경로/update-project.json
   ```

5. 관리자가 생성된 변경을 검토해 CodeBuild에 적용합니다. bootstrap buildspec은 고정 develop을 clone한 후 저장소의 runner를 실행합니다. public 사용자가 소스/역할/명령을 바꾸는 기능은 없습니다. `--force-full`은 서버에서 고정한 boolean 환경변수 하나로만 전달합니다.
6. 기존 Lambda 코드를 백업하고 `deploy_control.py`를 `index.py`로 패키징해 배포합니다. 기존 handler `index.handler`, role, timeout, concurrency는 유지합니다. v2 buildspec/네트워크/스토리지를 설치한 환경만 `PIPELINE_V2_INSTALLED_STAGES`에 등록합니다. 이후 원격의 `validate <stage>`로 앱 배포나 마이그레이션 SQL 실행 없이 READ ONLY 트랜잭션에서 DB 연결·이력을 검사할 수 있습니다. **검증되지 않은 stage는 `PIPELINE_V2_READY_STAGES`에 넣지 않습니다.** 두 값은 각각 환경 이름의 쉼표 구분 목록입니다. 미설치 v1 프로젝트에는 validate를 허용하지 않아 기존 배포가 실행되는 사고를 막습니다.
7. 승인된 dev 실행으로 마이그레이션/선택 배포/캐시 로그를 검증합니다. 같은 입력의 후속 실행에서 앱 배포가 생략되는지, 마이그레이션 확인은 실행되는지 확인합니다. 캐시 miss 후 다음 실행의 복원도 확인합니다. 실제 DB 변경을 포함하므로 단순 설정 검증으로 운영 실행을 시작하지 않습니다.
8. 검증된 환경부터 준비 목록에 등록하고, 원격에서 `check` 결과의 `pipelineVersion: 2`, `ready: true`를 확인합니다. live 설정도 해당 환경의 네트워크·권한을 별도로 확인합니다.

새 클라이언트는 기존 v1 gateway를 발견하면 **배포를 시작하지 않고 관리자 연결 작업을 요구**합니다. 로컬 문서만 바뀌었는데 마이그레이션이 자동 실행된 것으로 오해하는 일을 막기 위한 동작입니다. `status`는 기존 빌드 ID도 계속 조회할 수 있습니다.

## 실패 및 복구

- DB 연결/이력/SQL 검사 실패: 후속 SST 배포 없음. 담당 DB와 실패 단계만 공유하고 비밀값·전체 SQL·연결 문자열은 공개하지 않습니다.
- 앞 DB의 마이그레이션 성공 후 다른 DB 실패: 앞 DB 변경은 남습니다. 자동 rollback하지 않으며 수정 후 이력에 따라 재실행합니다.
- auth 성공 후 services 실패: auth 기준만 갱신됩니다. 재시도는 각 단위의 마지막 성공 커밋부터 계산합니다.
- 캐시 저장만 실패: 배포 성공과 구분해 경고를 기록합니다. 필요하면 해당 환경 캐시를 관리자가 비우고 cold build합니다. 성공 이력은 캐시와 함께 삭제하지 않습니다.
- 초기 롤아웃 실패: 준비 stage 표시를 해제해 새 요청을 차단한 뒤 백업한 CodeBuild/Lambda 구성을 복원합니다. DB 변경은 자동으로 되돌아가지 않습니다.
