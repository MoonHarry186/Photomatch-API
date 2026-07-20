const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'token',
  'tokenHash',
  'authorization',
  'adminNote',
  'exactPoint',
  'latitude',
  'longitude',
  'r2SecretAccessKey',
]);

export function sanitize<T>(value: T): T {
  return sanitizeValue(value, new WeakSet()) as T;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key) ? '[Filtered]' : sanitizeValue(item, seen),
    ]),
  );
}
