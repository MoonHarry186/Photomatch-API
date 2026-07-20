import { Logger } from '@nestjs/common';

export type AppEnv = 'development' | 'test' | 'production';

export interface Environment {
  NODE_ENV: AppEnv;
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_SECONDS: number;
  EMAIL_ADAPTER: 'fake' | 'smtp';
  EMAIL_FROM: string;
  SMTP_URL?: string;
  OAUTH_ADAPTER: 'fake' | 'production';
  GOOGLE_CLIENT_IDS: string[];
  APPLE_CLIENT_IDS: string[];
  R2_ENDPOINT: string;
  R2_REGION: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_FORCE_PATH_STYLE: boolean;
  R2_PUBLIC_BASE_URL?: string;
  PUSH_ADAPTER: 'fake' | 'production';
  EXPO_ACCESS_TOKEN?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
  SENTRY_DSN?: string;
  LOCATION_NOISE_MIN_METERS: number;
  LOCATION_NOISE_MAX_METERS: number;
  LOCATION_DEFAULT_RADIUS_KM: number;
  LOCATION_MAX_RADIUS_KM: number;
  LOCATION_DEFAULT_VISIBILITY_HOURS: number;
}

const logger = new Logger('Environment');

function required(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function integer(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum = 0,
): number {
  const raw = source[key];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${key} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = String(source[key] ?? fallback) as T;
  if (!values.includes(value)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

function csv(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function boolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

export function validateEnvironment(source: Record<string, unknown>): Environment {
  const nodeEnv = oneOf(source, 'NODE_ENV', ['development', 'test', 'production'], 'development');
  const env: Environment = {
    NODE_ENV: nodeEnv,
    PORT: integer(source, 'PORT', 3000, 1),
    CORS_ORIGINS: csv(source.CORS_ORIGINS),
    DATABASE_URL: required(source, 'DATABASE_URL'),
    REDIS_URL: required(source, 'REDIS_URL'),
    JWT_ACCESS_SECRET: required(source, 'JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: required(source, 'JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL_SECONDS: integer(source, 'JWT_ACCESS_TTL_SECONDS', 900, 60),
    JWT_REFRESH_TTL_SECONDS: integer(source, 'JWT_REFRESH_TTL_SECONDS', 2_592_000, 3600),
    EMAIL_ADAPTER: oneOf(source, 'EMAIL_ADAPTER', ['fake', 'smtp'], 'fake'),
    EMAIL_FROM: required(source, 'EMAIL_FROM'),
    SMTP_URL: typeof source.SMTP_URL === 'string' && source.SMTP_URL ? source.SMTP_URL : undefined,
    OAUTH_ADAPTER: oneOf(source, 'OAUTH_ADAPTER', ['fake', 'production'], 'fake'),
    GOOGLE_CLIENT_IDS: csv(source.GOOGLE_CLIENT_IDS),
    APPLE_CLIENT_IDS: csv(source.APPLE_CLIENT_IDS),
    R2_ENDPOINT: required(source, 'R2_ENDPOINT'),
    R2_REGION: String(source.R2_REGION ?? 'auto'),
    R2_BUCKET: required(source, 'R2_BUCKET'),
    R2_ACCESS_KEY_ID: required(source, 'R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: required(source, 'R2_SECRET_ACCESS_KEY'),
    R2_FORCE_PATH_STYLE: boolean(source, 'R2_FORCE_PATH_STYLE', false),
    R2_PUBLIC_BASE_URL:
      typeof source.R2_PUBLIC_BASE_URL === 'string' && source.R2_PUBLIC_BASE_URL
        ? source.R2_PUBLIC_BASE_URL
        : undefined,
    PUSH_ADAPTER: oneOf(source, 'PUSH_ADAPTER', ['fake', 'production'], 'fake'),
    EXPO_ACCESS_TOKEN:
      typeof source.EXPO_ACCESS_TOKEN === 'string' && source.EXPO_ACCESS_TOKEN
        ? source.EXPO_ACCESS_TOKEN
        : undefined,
    FCM_PROJECT_ID:
      typeof source.FCM_PROJECT_ID === 'string' && source.FCM_PROJECT_ID
        ? source.FCM_PROJECT_ID
        : undefined,
    FCM_CLIENT_EMAIL:
      typeof source.FCM_CLIENT_EMAIL === 'string' && source.FCM_CLIENT_EMAIL
        ? source.FCM_CLIENT_EMAIL
        : undefined,
    FCM_PRIVATE_KEY:
      typeof source.FCM_PRIVATE_KEY === 'string' && source.FCM_PRIVATE_KEY
        ? source.FCM_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    SENTRY_DSN:
      typeof source.SENTRY_DSN === 'string' && source.SENTRY_DSN ? source.SENTRY_DSN : undefined,
    LOCATION_NOISE_MIN_METERS: integer(source, 'LOCATION_NOISE_MIN_METERS', 1000, 100),
    LOCATION_NOISE_MAX_METERS: integer(source, 'LOCATION_NOISE_MAX_METERS', 3000, 100),
    LOCATION_DEFAULT_RADIUS_KM: integer(source, 'LOCATION_DEFAULT_RADIUS_KM', 20, 1),
    LOCATION_MAX_RADIUS_KM: integer(source, 'LOCATION_MAX_RADIUS_KM', 100, 1),
    LOCATION_DEFAULT_VISIBILITY_HOURS: integer(source, 'LOCATION_DEFAULT_VISIBILITY_HOURS', 24, 1),
  };

  if (env.LOCATION_NOISE_MIN_METERS > env.LOCATION_NOISE_MAX_METERS) {
    throw new Error('LOCATION_NOISE_MIN_METERS must not exceed LOCATION_NOISE_MAX_METERS');
  }
  if (env.LOCATION_DEFAULT_RADIUS_KM > env.LOCATION_MAX_RADIUS_KM) {
    throw new Error('LOCATION_DEFAULT_RADIUS_KM must not exceed LOCATION_MAX_RADIUS_KM');
  }
  if (env.NODE_ENV === 'production') {
    const unsafe = ['change-me', 'local-access-key', 'local-secret-key'];
    const secrets = [
      env.JWT_ACCESS_SECRET,
      env.JWT_REFRESH_SECRET,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
    ];
    if (secrets.some((value) => unsafe.includes(value))) {
      throw new Error('Unsafe placeholder secret is not allowed in production');
    }
    if (env.EMAIL_ADAPTER === 'smtp' && !env.SMTP_URL) {
      throw new Error('SMTP_URL is required when EMAIL_ADAPTER=smtp');
    }
    if (
      env.OAUTH_ADAPTER === 'production' &&
      (!env.GOOGLE_CLIENT_IDS.length || !env.APPLE_CLIENT_IDS.length)
    ) {
      throw new Error('Google and Apple client IDs are required for production OAuth');
    }
    if (
      env.PUSH_ADAPTER === 'production' &&
      (!env.FCM_PROJECT_ID || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY)
    ) {
      throw new Error('FCM service account configuration is required for production push');
    }
  } else {
    logger.log(
      `Using ${env.EMAIL_ADAPTER}/${env.OAUTH_ADAPTER}/${env.PUSH_ADAPTER} local adapters`,
    );
  }

  return env;
}
