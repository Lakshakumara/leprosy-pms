export const DISTRICT = 'Ratnapura'

/**
 * Every localStorage key used anywhere in the app, in one place.
 * Prevents silent collisions/typos when different services each
 * independently invent their own key name constants.
 */
export const STORAGE_KEYS = {
  AUTH_MODE: 'lpms_auth_mode',
  API_TOKEN: 'lpms_api_token',
  BASIC_CREDS: 'lpms_basic_creds',
  USER_DATA: 'lpms_user',
  ORG_SCOPE: 'lpms_org_scope'
} as const;
/**
 * { label: string; value: string; }
 * A simple interface for select options used in dropdowns, etc.
 */
export interface SelectOption { label: string; value: string; }
/**
 * label Grade
 * Values 1,2,3
 */
export const DISABILITY_CONVERSION = [
  { label: 'Grade 2', value: '3' },
  { label: 'Grade 1', value: '2' },
  { label: 'Grade 0', value: '1' },
];
export const DISABILITY_MAP = new Map(
  DISABILITY_CONVERSION.map(i => [String(i.value), i.label])
);