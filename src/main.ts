import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 보안/공통 미들웨어
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    // Electron 렌더러가 dev에서 file://, prod에서 file:// 또는 custom protocol을 사용한다.
    // 우선 모든 origin을 허용하고, 운영 단계에서 화이트리스트로 좁힌다.
    origin: true,
    credentials: true,
  });

  // 글로벌 ValidationPipe (class-validator/class-transformer 활용)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 모든 라우트에 /api prefix
  app.setGlobalPrefix('api');

  // Swagger (OpenAPI) 문서
  const config = new DocumentBuilder()
    .setTitle('Mallang Core API')
    .setDescription('회사 라이프스타일 도우미 말랑이의 백엔드 API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`[mallang-core-backend] listening on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(`[mallang-core-backend] swagger UI    http://localhost:${port}/docs`);
}

void bootstrap();
