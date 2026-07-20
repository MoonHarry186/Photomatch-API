import { BookingStatus } from '@prisma/client';
import { ApiError } from '../common/api-error';

export interface BookingTransitionContext {
  status: BookingStatus;
  creatorUserId: string;
  scheduledStart: Date;
  customerUserId: string;
  photographerUserId: string;
}

export function assertBookingTransition(
  booking: BookingTransitionContext,
  actorUserId: string,
  target: BookingStatus,
  reason?: string,
): void {
  const isCreator = booking.creatorUserId === actorUserId;
  const isPhotographer = booking.photographerUserId === actorUserId;
  const isParticipant = isPhotographer || booking.customerUserId === actorUserId;
  const requiresReason =
    target === BookingStatus.REJECTED ||
    target === BookingStatus.CANCELLED ||
    target === BookingStatus.DISPUTED;
  if (requiresReason && !reason?.trim()) {
    throw new ApiError('TRANSITION_REASON_REQUIRED', 'Reason is required');
  }
  let allowed = false;
  if (booking.status === BookingStatus.PENDING && target === BookingStatus.ACCEPTED) {
    allowed = !isCreator && isParticipant;
  }
  if (booking.status === BookingStatus.PENDING && target === BookingStatus.REJECTED) {
    allowed = !isCreator && isParticipant;
  }
  if (booking.status === BookingStatus.PENDING && target === BookingStatus.CANCELLED) {
    allowed = isCreator;
  }
  if (booking.status === BookingStatus.ACCEPTED && target === BookingStatus.CANCELLED) {
    allowed = isParticipant && new Date() < booking.scheduledStart;
  }
  if (booking.status === BookingStatus.ACCEPTED && target === BookingStatus.IN_PROGRESS) {
    allowed = isPhotographer;
  }
  if (booking.status === BookingStatus.IN_PROGRESS && target === BookingStatus.COMPLETED) {
    allowed = isPhotographer;
  }
  if (
    (booking.status === BookingStatus.ACCEPTED ||
      booking.status === BookingStatus.IN_PROGRESS ||
      booking.status === BookingStatus.COMPLETED) &&
    target === BookingStatus.DISPUTED
  ) {
    allowed = isParticipant;
  }
  if (!allowed) {
    throw ApiError.conflict(
      'INVALID_BOOKING_TRANSITION',
      'Booking transition is not allowed for actor',
    );
  }
}
