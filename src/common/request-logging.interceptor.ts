import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const startedAt = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(request, context.switchToHttp().getResponse().statusCode, startedAt),
        error: (error: unknown) =>
          this.log(request, error instanceof HttpException ? error.getStatus() : 500, startedAt),
      }),
    );
  }

  private log(
    request: Request & { requestId?: string },
    statusCode: number,
    startedAt: number,
  ): void {
    const status = Number(statusCode);
    const durationMs = Date.now() - startedAt;
    this.metrics.observe(request.method, request.route?.path ?? request.path, status, durationMs);
    this.logger.log(
      JSON.stringify({
        requestId: request.requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: status,
        latencyMs: durationMs,
      }),
    );
  }
}
