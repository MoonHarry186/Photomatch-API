import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorBody } from './api-error';
import { sanitize } from './sanitize';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    const mapped = this.map(error);
    const body: ApiErrorBody = { ...mapped.body, requestId: request.requestId };

    if (mapped.status >= 500) {
      this.logger.error(
        JSON.stringify({
          requestId: request.requestId,
          method: request.method,
          path: request.url,
          error: sanitize(error),
        }),
      );
    }
    response.status(mapped.status).json(body);
  }

  private map(error: unknown): { status: number; body: ApiErrorBody } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: { code: 'CONFLICT', message: 'A record with the same unique value already exists' },
        };
      }
      if (error.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: 'NOT_FOUND', message: 'Record not found' },
        };
      }
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        return { status, body: response as ApiErrorBody };
      }
      const details = typeof response === 'object' ? response : undefined;
      return {
        status,
        body: {
          code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
          message: error.message,
          ...(details === undefined ? {} : { details }),
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    };
  }
}
