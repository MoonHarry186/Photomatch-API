import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';

describe('API boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('exposes liveness under the versioned prefix', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
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
