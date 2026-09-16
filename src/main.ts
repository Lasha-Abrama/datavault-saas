import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({
    transform: true
  }))

  const cors = process.env.CORS_ORIGIN?.split('.')?.map(o => o.trim());
  app.enableCors({
    origin: cors
  })

  await app.listen(process.env.PORT ?? 3000);
  
}
bootstrap();
