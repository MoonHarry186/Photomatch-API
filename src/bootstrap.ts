import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.get<string[]>('CORS_ORIGINS') ?? [],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}

export function configureOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Photomatch MVP API')
    .setDescription('Versioned contract for Photomatch mobile and admin clients')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Idempotency-Key' }, 'idempotency-key')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
