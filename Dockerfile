# syntax=docker/dockerfile:1.7
#
# Mallang Core 백엔드 운영 이미지.
# - 빌드와 런타임을 분리한 multi-stage 빌드.
# - prisma generate는 빌드 stage에서 한 번 수행하고 결과 node_modules를 그대로 들고 간다.
# - 마이그레이션은 컨테이너 기동 시 `prisma migrate deploy`로 적용한다(스키마 드리프트 방지).
#
# 빌드 후 이미지 크기를 줄이려고 dev deps만 prune 하지는 않는다 — Prisma CLI가
# devDependencies에 있는데 마이그레이션을 위해 런타임에서도 필요하기 때문이다.

FROM node:20-bookworm-slim AS base
# corepack: pnpm 사용. openssl/ca-certificates: Prisma engine과 https 요청에 필요.
RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app


FROM base AS deps
# pnpm 의존성 설치는 lockfile만 변경됐을 때만 캐시가 무효화된다.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile


FROM deps AS builder
# 소스 복사 후 Prisma 클라이언트 생성 + Nest 빌드.
# 빌드 산출물은 dist/ 와 (필요시) node_modules의 .prisma/ 디렉토리에 들어간다.
# scripts/ 는 ts-node로만 실행되는 도구라 컨테이너에 포함시키지 않는다.
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm prisma:generate \
    && pnpm build \
    && test -f dist/main.js  # 산출물이 dist/main.js로 떨어졌는지 즉시 검증해 회귀 방지.


FROM base AS runner
# PORT 기본값은 사내 포트 규칙에 맞춘 8101. compose에서 환경변수로 또 override할 수 있다.
ENV NODE_ENV=production \
    PORT=8101
# 운영 이미지에는 빌드 산출물과 의존성 그래프만 옮긴다.
# (소스 ts 파일은 굳이 옮기지 않는다 — 디버깅 필요 시 소스맵으로 충분.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

EXPOSE 8101
# 마이그레이션 적용 후 서버 기동. migrate deploy 는 idempotent 하므로 매 부팅마다 안전하다.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
