import { BookingStatus } from '@prisma/client';
import { ApiError } from '../../src/common/api-error';
import { assertBookingTransition } from '../../src/bookings/booking-state-machine';

const base = {
  creatorUserId: 'customer',
  customerUserId: 'customer',
  photographerUserId: 'photographer',
  scheduledStart: new Date(Date.now() + 60_000),
};

describe('booking state machine', () => {
  it('allows only the non-creator to accept a pending booking', () => {
    expect(() =>
      assertBookingTransition(
        { ...base, status: BookingStatus.PENDING },
        'photographer',
        BookingStatus.ACCEPTED,
      ),
    ).not.toThrow();
    expect(() =>
      assertBookingTransition(
        { ...base, status: BookingStatus.PENDING },
        'customer',
        BookingStatus.ACCEPTED,
      ),
    ).toThrow(ApiError);
  });

  it('requires reasons for rejection, cancellation, and disputes', () => {
    expect(() =>
      assertBookingTransition(
        { ...base, status: BookingStatus.PENDING },
        'photographer',
        BookingStatus.REJECTED,
      ),
    ).toThrow('Reason is required');
  });

  it('allows only the photographer to start and complete work', () => {
    expect(() =>
      assertBookingTransition(
        { ...base, status: BookingStatus.ACCEPTED },
        'photographer',
        BookingStatus.IN_PROGRESS,
      ),
    ).not.toThrow();
    expect(() =>
      assertBookingTransition(
        { ...base, status: BookingStatus.IN_PROGRESS },
        'customer',
        BookingStatus.COMPLETED,
      ),
    ).toThrow(ApiError);
  });
});
