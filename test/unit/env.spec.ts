import { validateEnvironment } from '../../src/config/env';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/photomatch',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-with-enough-entropy',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-enough-entropy',
  EMAIL_FROM: 'test@photomatch.local',
  R2_ENDPOINT: 'http://localhost:9000',
  R2_BUCKET: 'photomatch',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
};

describe('validateEnvironment', () => {
  it('applies bounded location defaults', () => {
    const env = validateEnvironment(valid);
    expect(env.LOCATION_NOISE_MIN_METERS).toBe(1000);
    expect(env.LOCATION_NOISE_MAX_METERS).toBe(3000);
    expect(env.LOCATION_DEFAULT_RADIUS_KM).toBe(20);
    expect(env.LOCATION_MAX_RADIUS_KM).toBe(100);
  });

  it('rejects inverted location bounds', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        LOCATION_NOISE_MIN_METERS: '4000',
        LOCATION_NOISE_MAX_METERS: '3000',
      }),
    ).toThrow('must not exceed');
  });

  it('rejects placeholder secrets in production', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me' }),
    ).toThrow('Unsafe placeholder secret');
  });

  it('requires both OAuth audiences for the production adapter', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production', OAUTH_ADAPTER: 'production' }),
    ).toThrow('Google and Apple client IDs');
  });
});
