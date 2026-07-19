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