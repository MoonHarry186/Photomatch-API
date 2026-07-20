import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { enrichOpenApiDocument } from '../src/openapi/openapi-contract';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  configureApplication(app);
  await app.init();
  const config = new DocumentBuilder()
    .setTitle('Photomatch MVP API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Idempotency-Key' }, 'idempotency-key')
    .build();
  const document = enrichOpenApiDocument(SwaggerModule.createDocument(app, config));
  await writeFile(resolve(process.cwd(), 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

exportOpenApi().catch((error: unknown) => {
  process.stderr.write(
    `OpenAPI export failed: ${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
