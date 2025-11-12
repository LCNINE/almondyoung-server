# Auth Core Module

MSA(Microservice Architecture) 환경에서 JWT Access Token 검증을 제공하는 공통 인증 모듈입니다.

## 설치

이 모듈은 `libs/auth-core`에 위치하며, NestJS 모노레포 내에서 직접 import하여 사용할 수 있습니다.

## 모듈 설정

### 1. AppModule에 AuthCoreModule 등록

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthCoreModule } from '@app/auth-core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/your-app/.env',
    }),
    AuthCoreModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('AUTH_SECRET'),
      }),
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. 환경 변수 설정

`.env` 파일에 다음 환경 변수를 추가하세요:

```env
AUTH_SECRET=your-jwt-secret-key
JWT_ISSUER=almondyoung-auth  # 선택사항, 기본값: 'almondyoung-auth'
```

## 사용법

### Guard 사용

#### 컨트롤러 레벨에서 Guard 적용

```typescript
import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/auth-core';

@Controller('api')
@UseGuards(JwtAuthGuard) // 모든 엔드포인트에 인증 적용
export class MyController {
  // ...
}
```

#### 메서드 레벨에서 Guard 적용

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/auth-core';

@Controller('api')
export class MyController {
  @Get('protected')
  @UseGuards(JwtAuthGuard) // 특정 엔드포인트만 인증 적용
  async protectedRoute() {
    // ...
  }
}
```

### Public 데코레이터 사용 (인증 우회)

인증이 필요 없는 공개 엔드포인트는 `@Public()` 데코레이터를 사용하세요:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/auth-core';

@Controller('api')
export class MyController {
  @Get('public')
  @Public() // JWT 인증을 우회합니다
  async publicRoute() {
    return { message: 'This is a public endpoint' };
  }
}
```

### 사용자 정보 가져오기

인증된 사용자 정보는 `@User()` 데코레이터를 사용하여 가져올 수 있습니다:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, User } from '@app/auth-core';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class MyController {
  @Get('profile')
  async getProfile(@User() user: any) {
    // 전체 사용자 객체 반환
    return user;
  }

  @Get('user-id')
  async getUserId(@User('userId') userId: string) {
    // 특정 필드만 추출
    return { userId };
  }
}
```

#### 사용자 객체 구조

JWT 토큰이 검증되면 `req.user`에 다음 구조의 객체가 설정됩니다:

```typescript
{
  userId: string;      // payload.sub
  roles: string[];     // payload.roles
  scopes: string[];    // payload.scopes
  email: string;       // payload.email
  ...payload           // 기타 JWT payload 필드
}
```

## JWT 토큰 전달 방법

이 모듈은 **쿠키에서만** JWT 토큰을 읽습니다:

- 쿠키 이름: `accessToken`
- 헤더의 `Authorization`은 사용하지 않습니다

### 클라이언트 예시

```typescript
// 쿠키에 accessToken 설정
document.cookie = `accessToken=${jwtToken}; path=/; secure; samesite=strict`;
```

## 전체 사용 예시

```typescript
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Public, User } from '@app/auth-core';

@Controller('api/users')
export class UsersController {
  // 공개 엔드포인트
  @Get('public')
  @Public()
  async getPublicInfo() {
    return { message: 'Public information' };
  }

  // 인증 필요 엔드포인트
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@User() user: any) {
    return {
      userId: user.userId,
      email: user.email,
      roles: user.roles,
    };
  }

  // 사용자 ID만 필요한 경우
  @Post('action')
  @UseGuards(JwtAuthGuard)
  async performAction(@User('userId') userId: string, @Body() data: any) {
    // userId를 사용한 로직
    return { success: true, userId };
  }
}
```

## 에러 처리

인증 실패 시 다음 에러가 발생합니다:

- **401 Unauthorized**: 토큰이 없거나 유효하지 않은 경우
- **401 Unauthorized**: 토큰이 만료된 경우
- **401 Unauthorized**: 토큰 payload에 `sub` 필드가 없는 경우

## 주의사항

1. **ConfigModule 필수**: `AuthCoreModule`을 사용하기 전에 `ConfigModule.forRoot({ isGlobal: true })`를 먼저 등록해야 합니다.

2. **환경 변수 검증**: `AUTH_SECRET`이 설정되지 않으면 모듈 초기화 시 에러가 발생합니다.

3. **쿠키 기반 인증**: 이 모듈은 쿠키에서만 토큰을 읽습니다. Authorization 헤더는 사용하지 않습니다.

4. **Global 모듈**: `AuthCoreModule`은 `@Global()` 데코레이터로 선언되어 있어, 한 번 등록하면 모든 모듈에서 `JwtAuthGuard`를 사용할 수 있습니다.

## 모듈 구조

```
libs/auth-core/
├── src/
│   ├── auth-core.module.ts    # 모듈 정의
│   ├── guards/
│   │   └── jwt-auth.guard.ts  # JWT 인증 가드
│   ├── strategies/
│   │   └── jwt-access.strategy.ts  # Passport JWT 전략
│   ├── decorators/
│   │   ├── public.decorator.ts     # @Public() 데코레이터
│   │   └── user.decorator.ts       # @User() 데코레이터
│   └── index.ts                    # Export
└── README.md
```
