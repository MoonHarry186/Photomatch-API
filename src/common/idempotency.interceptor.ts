import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { catchError, from, map, Observable, of, switchMap, throwError } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ApiError } from './api-error';
import { AuthenticatedRequest, IDEMPOTENT_ROUTE } from './auth-context';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const key = request.header('idempotency-key');
    if (!key || key.length > 255) {
      throw new ApiError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const actorKey = request.user?.userId ?? `anonymous:${request.ip}`;
    const payloadHash = createHash('sha256')
      .update(stableStringify(request.body ?? null))
      .digest('hex');
    const identity = {
      actorKey_idempotencyKey_method_path: {
        actorKey,
        idempotencyKey: key,
        method: request.method,
        path: request.route?.path ?? request.path,
      },
    };

    return from(this.claim(identity, payloadHash)).pipe(
      switchMap((claim) => {
        if (claim.replay) return of(claim.body);
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.prisma.idempotencyRecord.update({
                where: identity,
                data: {
                  status: IdempotencyStatus.COMPLETED,
                  responseCode: response.statusCode,
                  responseBody: toJson(body),
                  lockedUntil: null,
                },
              }),
            ).pipe(map(() => body)),
          ),
          catchError((error: unknown) =>
            from(
              this.prisma.idempotencyRecord.update({
                where: identity,
                data: { status: IdempotencyStatus.FAILED, lockedUntil: null },
              }),
            ).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private async claim(
    where: Prisma.IdempotencyRecordWhereUniqueInput,
    payloadHash: string,
  ): Promise<{ replay: boolean; body?: Prisma.JsonValue }> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          ...(where.actorKey_idempotencyKey_method_path as {
            actorKey: string;
            idempotencyKey: string;
            method: string;
            path: string;
          }),
          payloadHash,
          lockedUntil: new Date(Date.now() + 30_000),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return { replay: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
    }
    const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({ where });
    if (existing.payloadHash !== payloadHash) {
      throw ApiError.conflict(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'The idempotency key was already used with a different payload',
      );
    }
    if (existing.status === IdempotencyStatus.COMPLETED) {
      return { replay: true, body: existing.responseBody ?? undefined };
    }
    if (
      existing.status === IdempotencyStatus.PROCESSING &&
      existing.lockedUntil &&
      existing.lockedUntil > new Date()
    ) {
      throw ApiError.conflict(
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this key is still processing',
      );
    }
    await this.prisma.idempotencyRecord.update({
      where,
      data: { status: IdempotencyStatus.PROCESSING, lockedUntil: new Date(Date.now() + 30_000) },
    });
    return { replay: false };
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
