import * as Sentry from '@sentry/node';
import { sanitize } from './common/sanitize';

export function configureMonitoring(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    beforeSend(event) {
      return sanitize(event);
    },
  });
}
