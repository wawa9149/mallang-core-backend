# mallang-core-backend

Mallang Core의 백엔드. **NestJS 10 + Prisma + PostgreSQL + JWT** 구조.

## Stack

- **NestJS 10** + TypeScript
- **Prisma** (PostgreSQL)
- **@nestjs/jwt** + Passport JWT (access + refresh rotation)
- **class-validator / class-transformer**
- **@nestjs/swagger** (OpenAPI / Swagger UI)
- **bcrypt** (비밀번호 해시)
- **helmet**, **cookie-parser** (보안/세션 유틸)

## Requirements

- Node.js 20+
- pnpm 9+
- Docker (Postgres 컨테이너 띄우기 용)

## 초기 셋업 (한 번만)

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경 변수
cp .env.example .env

# 3. Postgres 컨테이너 띄우기
docker compose up -d

# 4. Prisma client 생성 + 첫 마이그레이션
pnpm prisma:generate
pnpm prisma:migrate   # 마이그레이션 이름은 "init" 정도로
```

## 개발 실행

```bash
pnpm start:dev        # hot reload
# → http://localhost:3000/api          REST API
# → http://localhost:3000/docs         Swagger UI
```

## 자주 쓰는 스크립트

| 스크립트 | 설명 |
| --- | --- |
| `pnpm start:dev` | 개발 모드 hot reload |
| `pnpm build` | dist로 빌드 |
| `pnpm start:prod` | 빌드된 결과물 실행 |
| `pnpm typecheck` | 타입만 검사 |
| `pnpm lint` | ESLint + auto fix |
| `pnpm format` | Prettier |
| `pnpm prisma:generate` | Prisma client 생성 |
| `pnpm prisma:migrate` | 마이그레이션 생성 + 적용 (dev) |
| `pnpm prisma:studio` | 시각화 GUI |
| `pnpm swagger:export` | `openapi.json` 파일로 OpenAPI 스펙 추출 |
| `pnpm test` | 단위 테스트 |

## 디렉토리 구조

```
.
├── prisma/
│   └── schema.prisma           Prisma 스키마 (Company / Team / User / LunchVote / EmotionLog ...)
├── scripts/
│   └── export-openapi.ts       openapi.json 추출 (프론트 타입 동기화용)
├── src/
│   ├── main.ts                 부트스트랩 (helmet, CORS, ValidationPipe, Swagger)
│   ├── app.module.ts           루트 모듈
│   ├── app.controller.ts       /health
│   ├── config/
│   │   └── env.validation.ts   필수 ENV 검증
│   ├── prisma/
│   │   ├── prisma.module.ts    Global 모듈
│   │   └── prisma.service.ts   PrismaClient lifecycle
│   ├── users/
│   │   ├── users.module.ts
│   │   └── users.service.ts    이메일/ID 조회, 생성
│   └── auth/
│       ├── auth.module.ts
│       ├── auth.controller.ts  /auth/signup, /login, /refresh, /logout, /me
│       ├── auth.service.ts     bcrypt + JWT + refresh rotation
│       ├── dto/                SignupDto, LoginDto, RefreshDto
│       ├── strategies/
│       │   └── jwt.strategy.ts Passport JWT
│       ├── guards/
│       │   └── jwt-auth.guard.ts
│       └── decorators/
│           └── current-user.decorator.ts
├── docker-compose.yml          Postgres 16
├── .env.example
└── package.json
```

## 인증 흐름

1. `POST /api/auth/signup` 또는 `POST /api/auth/login` → `{ accessToken, refreshToken, user }`
2. 클라이언트는 `Authorization: Bearer <accessToken>`로 보호 라우트 호출
3. access가 만료되면 `POST /api/auth/refresh` 로 새 access+refresh 페어 발급 (rotation)
4. 로그아웃은 `POST /api/auth/logout`로 현재 refresh token을 폐기

> refresh token은 **DB에 sha256 해시만 저장**한다. 평문 토큰은 클라이언트가 보관.

## 프론트와 타입 동기화 (옵션 C)

API 시그니처 변경 시 다음 순서로 프론트의 타입을 갱신한다.

```bash
# 백엔드 쪽
pnpm swagger:export
# → openapi.json 생성

# 프론트 쪽 (mallang-core-frontend)
pnpm add -D openapi-typescript
npx openapi-typescript ../mallang-core-backend/openapi.json -o src/shared/api/schema.d.ts
```

이후 프론트에서 axios 호출에 `paths['/api/auth/login']['post']['requestBody']['content']['application/json']` 같은 식으로 타입을 가져다 쓰면 된다.

## 다음 작업 (백엔드 백로그)

- [ ] `me` 프로필 PATCH (`/api/users/me`)
- [ ] Teams 모듈: 팀명 자동 매칭 / 같은 팀 멤버 조회
- [ ] LunchVote 모듈: 그룹 단위 점심 투표
- [ ] EmotionLog 모듈: 주간 감정 리포트 데이터 적재
- [ ] WebSocket (그룹 실시간 동기화)
- [ ] e2e 테스트
- [ ] Dockerfile + CI
