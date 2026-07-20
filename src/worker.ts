import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';
import { configureMonitoring } from './monitoring';

configureMonitoring();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('Photomatch worker started');
}

void bootstrap();
