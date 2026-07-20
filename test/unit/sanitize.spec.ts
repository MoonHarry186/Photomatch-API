import { sanitize } from '../../src/common/sanitize';

describe('sanitize', () => {
  it('redacts secrets, exact coordinates, and admin notes recursively', () => {
    const result = sanitize({
      email: 'visible@example.com',
      passwordHash: 'secret',
      nested: { tokenHash: 'secret', latitude: 10.1, adminNote: 'internal' },
    });
    expect(result).toEqual({
      email: 'visible@example.com',
      passwordHash: '[Filtered]',
      nested: { tokenHash: '[Filtered]', latitude: '[Filtered]', adminNote: '[Filtered]' },
    });
  });
});
