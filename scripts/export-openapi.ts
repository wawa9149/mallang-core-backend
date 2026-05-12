/**
 * `pnpm swagger:export` 로 호출.
 *
 * Nest 앱을 부팅하지 않고 OpenAPI 문서 JSON만 만들어 `openapi.json`에 저장한다.
 * 프론트엔드에서는 이 파일을 입력으로 `openapi-typescript`를 돌려 타입을 생성한다.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Mallang Core API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const outputPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

  await app.close();
  // eslint-disable-next-line no-console
  console.log(`[openapi] wrote ${outputPath}`);
}

void exportOpenApi();
