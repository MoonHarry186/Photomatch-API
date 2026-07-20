import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends HttpException {
  constructor(code: string, message: string, status = HttpStatus.BAD_REQUEST, details?: unknown) {
    super({ code, message, ...(details === undefined ? {} : { details }) }, status);
  }

  static notFound(entity: string): ApiError {
    return new ApiError('NOT_FOUND', `${entity} not found`, HttpStatus.NOT_FOUND);
  }

  static forbidden(
    code = 'FORBIDDEN',
    message = 'You are not allowed to perform this action',
  ): ApiError {
    return new ApiError(code, message, HttpStatus.FORBIDDEN);
  }

  static conflict(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(code, message, HttpStatus.CONFLICT, details);
  }
}
