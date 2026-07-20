import { ApiError } from '../../src/common/api-error';
import { decodeCursor, encodeCursor } from '../../src/common/pagination';

describe('cursor pagination', () => {
  it('round trips stable cursor values', () => {
    const value = { id: 'item-id', createdAt: '2026-07-20T00:00:00.000Z' };
    expect(decodeCursor(encodeCursor(value))).toEqual(value);
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
  });
});

void ApiError;
