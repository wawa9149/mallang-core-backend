/**
 * 환경 변수 검증. 누락되거나 잘못된 값이 들어오면 부팅 단계에서 즉시 실패한다.
 * 외부 라이브러리를 더 들이지 않기 위해 간단한 수동 검증을 사용한다.
 */
export function envValidationSchema(config: Record<string, unknown>): Record<string, unknown> {
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    // 사용자별 OpenAI API 키를 AES-256-GCM으로 암호화할 때 쓰는 마스터 키 (64자 hex = 32 bytes).
    'ENCRYPTION_KEY',
  ] as const;

  const missing = required.filter((key) => !config[key] || `${config[key]}`.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `[env] missing required environment variables: ${missing.join(', ')}\n` +
        `백엔드 루트에 .env 파일을 만들고 .env.example 값을 채워 줘.`,
    );
  }

  const encKey = `${config.ENCRYPTION_KEY}`.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error(
      '[env] ENCRYPTION_KEY는 64자 hex(32 bytes) 문자열이어야 해. ' +
        '`openssl rand -hex 32`로 생성한 값을 .env에 넣어 줘.',
    );
  }

  return config;
}
