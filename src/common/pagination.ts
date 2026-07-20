import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CursorPageDto {
  @ApiPropertyOptional({ type: String, description: 'Opaque cursor returned by the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor?: string): T | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid cursor');
    return value as T;
  } catch {
    throw new HttpException(
      { code: 'INVALID_CURSOR', message: 'Cursor is invalid or malformed' },
      HttpStatus.BAD_REQUEST,
    );
  }
}

import { HttpException, HttpStatus } from '@nestjs/common';
