import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';

describe('API boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const previousCorsOrigins = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'http://localhost:3001';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    delete process.env.CORS_ORIGINS;
    configureApplication(app);
    if (previousCorsOrigins !== undefined) {
      process.env.CORS_ORIGINS = previousCorsOrigins;
    }
    await app.init();
  });

  afterAll(async () => app.close());

  it('exposes liveness under the versioned prefix', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
  });

  it('allows the browser origins loaded by the validated configuration', async () => {
    await request(app.getHttpServer())
      .options('/api/v1/health/live')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3001')
      .expect(204);
  });

  it('returns the common security error shape', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .expect(401)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'AUTH_REQUIRED',
            message: expect.any(String),
            requestId: expect.any(String),
          }),
        );
      });
  });

  it('does not expose routes explicitly outside MVP', async () => {
    await request(app.getHttpServer()).get('/api/v1/shoot-requests').expect(404);
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(404);
    await request(app.getHttpServer()).get('/api/v1/referrals').expect(404);
  });
});
