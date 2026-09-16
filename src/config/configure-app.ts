import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const origins = config
    .get<string>('CORS_ORIGIN')
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : false });
}
