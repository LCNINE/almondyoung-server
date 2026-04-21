# deployments/ — Claude 작업 규칙

이 디렉토리 아래 SST 앱을 추가·수정할 때는 **반드시 [`CONVENTIONS.md`](./CONVENTIONS.md)를 먼저 읽고** 규칙을 따를 것.

핵심 요약:
- 폴더: `deployments/{company}/{env}/`
- 앱 이름 (SST `name`): `{company}-{env}` (예: `lcnine-auth`)
- SSM 네임스페이스: `/{app-name}/{stage}/{resource}`
- env 후보: `platform` | `auth` | `services`

세부 규칙·예시·레거시 이주 로드맵·주의사항은 모두 `CONVENTIONS.md` 참조.
