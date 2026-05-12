<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

AlmondYoung 멤버십 구독 관리 시스템 - NestJS 기반의 마이크로서비스 아키텍처

### 주요 기능

- **멤버십 구독 관리**: 사용자 구독 생성, 업그레이드, 다운그레이드, 취소
- **일시정지 시스템**: 구독 일시정지 및 재개 기능
- **정책 관리**: 구독 관련 비즈니스 규칙 및 제약사항 관리
- **권한 관리**: 티어별 사용자 권한 및 혜택 관리
- **이벤트 기반 아키텍처**: 구독 변경 이벤트 발행 및 처리

### 아키텍처

```
apps/
├── membership/          # 멤버십 관리 서비스
│   ├── src/
│   │   ├── admin-operations/    # 관리자 기능
│   │   ├── audit-logs/         # 감사 로그
│   │   ├── pause-resume/       # 일시정지/재개
│   │   ├── plan/              # 플랜 관리
│   │   ├── policy-management/ # 정책 관리 ⭐
│   │   ├── rights/            # 권한 관리
│   │   ├── subscription/      # 구독 관리
│   │   └── shared/           # 공통 모듈
└── core/               # 메인 서버 (catalog+inventory 통합)

libs/
├── db/                 # 데이터베이스 모듈
├── events/            # 이벤트 발행 모듈
└── shared/           # 공통 라이브러리
```

### 정책 관리 시스템

정책 관리 시스템은 구독 관련 비즈니스 규칙을 동적으로 관리할 수 있는 핵심 기능입니다.

#### 지원되는 정책 타입

- **일시정지 관련**: `MAX_PAUSES_PER_YEAR`, `MIN_PAUSE_DURATION_DAYS`, `PAUSE_COOLDOWN_DAYS`
- **플랜 변경 관련**: `PLAN_CHANGE_COOLDOWN_DAYS`, `ALLOWED_PLAN_CHANGES`
- **티어별 제한**: `TIER_SPECIFIC_LIMITS`, `VIP_USER_BENEFITS`
- **특별 기간**: `PROMOTIONAL_PERIODS`, `SEASONAL_RESTRICTIONS`

#### API 엔드포인트

```typescript
// 정책 관리
GET    /policies              # 정책 목록 조회
GET    /policies/:id          # 특정 정책 조회
POST   /policies              # 새 정책 생성
PUT    /policies/:id          # 정책 수정
DELETE /policies/:id          # 정책 비활성화

// 정책 검증
POST   /policies/validate     # 정책 검증
POST   /policies/bulk-validate # 대량 정책 검증
GET    /policies/applicable   # 적용 가능한 정책 조회
```

자세한 정책 관리 가이드는 [POLICY_TYPES.md](apps/membership/POLICY_TYPES.md)를 참조하세요.
이 프로젝트는 [Nest](https://github.com/nestjs/nest) 프레임워크를 기반으로 구축된 **통합 물류 관리 시스템**입니다.

### 🏗️ 프로젝트 구조

```
almondyoung-server/
├── apps/
│   └── core/             # 메인 서버 (catalog+inventory 통합)
├── libs/
│   ├── shared/           # 공통 라이브러리
│   ├── events/           # 이벤트 처리
│   └── db/               # 데이터베이스 연동
└── docs/                 # 📚 프로젝트 문서
    └── warehouse-layout-system.md  # 창고 레이아웃 시스템 설계 문서
```

### 📚 Documentation

주요 설계 문서들이 `docs/` 폴더에 정리되어 있습니다:

- **[창고 레이아웃 시스템 MVP](./docs/warehouse-layout-mvp.md)**: ⭐ **현재 개발 중** - 2D GUI 기반 창고 레이아웃 관리 시스템 (단순 버전)
- **[창고 레이아웃 시스템 Full](./docs/warehouse-layout-system.md)**: 고급 기능이 포함된 완전한 시스템 설계 (향후 확장)

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
