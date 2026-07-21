export const FEATURE_RESTRICTION_CODES = [
  'LOCATION',
  'DISCOVERY',
  'SWIPE',
  'CHAT',
  'BOOKING',
  'REVIEW',
  'UPLOAD',
] as const;

export type FeatureRestrictionCode = (typeof FEATURE_RESTRICTION_CODES)[number];
