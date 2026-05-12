/**
 * 환경 변수 검증. 누락되거나 잘못된 값이 들어오면 부팅 단계에서 즉시 실패한다.
 * 외부 라이브러리를 더 들이지 않기 위해 간단한 수동 검증을 사용한다.
 */
export function envValidationSchema(config: Record<string, unknown>): Record<string, unknown> {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

  const missing = required.filter((key) => !config[key] || `${config[key]}`.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `[env] missing required environment variables: ${missing.join(', ')}\n` +
        `백엔드 루트에 .env 파일을 만들고 .env.example 값을 채워 줘.`,
    );
  }

  return config;
}
