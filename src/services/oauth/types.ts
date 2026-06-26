/**
 * OAuth type definitions.
 *
 * Several modules import these types from `./types.js` but the file was
 * missing from the source tree. The shapes below are reconstructed from
 * usage sites in `client.ts`, `getOauthProfile.ts`, `utils/auth.ts`, and
 * the Codex token flows in `codex-client.ts`.
 *
 * Keep this file in sync with any future type changes from upstream.
 */

export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team'
  | 'team_premium'
  | 'enterprise'
  | 'api'
  | null

export type RateLimitTier = string | null

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType?: SubscriptionType | null
  rateLimitTier?: RateLimitTier
  /** Pre-fetched profile from /oauth/profile (set after token exchange) */
  profile?: OAuthProfileResponse
  /** Account info from token exchange response, used when profile endpoint fails */
  tokenAccount?: {
    uuid?: string
    emailAddress?: string
    organizationUuid?: string
  }
}

/** Codex (OpenAI) OAuth tokens. Stored in GlobalConfig, not the keychain. */
export interface CodexTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
}

/** Profile response fields used by getOauthProfile.ts and handlers/auth.ts */
export interface OAuthProfileResponse {
  account?: {
    uuid?: string
    email?: string
    display_name?: string
    created_at?: string
    has_extra_usage_enabled?: boolean
  }
  organization?: {
    uuid?: string
    name?: string
    billing_type?: string
    subscription_created_at?: string
  }
}

/** Shape of the OAuth token exchange response from Anthropic */
export interface OAuthTokenExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

export type BillingType = 'stripe' | 'invoice' | string

export interface UserRolesResponse {
  roles?: Array<{
    type?: string
    [key: string]: unknown
  }>
}