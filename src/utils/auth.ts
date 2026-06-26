import chalk from 'chalk'
import { exec } from 'child_process'
import { execa } from 'execa'
import { mkdir, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { CLAUDE_AI_PROFILE_SCOPE } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getIsNonInteractiveSession,
  preferThirdPartyAuthentication,
} from '../bootstrap/state.js'
import {
  getMockSubscriptionType,
  shouldUseMockSubscription,
} from '../services/mockRateLimits.js'
import {
  isOAuthTokenExpired,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
} from '../services/oauth/client.js'
import type { CodexTokens } from '../services/oauth/codex-client.js'
import { getOauthProfileFromOauthToken } from '../services/oauth/getOauthProfile.js'
import type { OAuthTokens, SubscriptionType } from '../services/oauth/types.js'
import {
  getApiKeyFromFileDescriptor,
  getOAuthTokenFromFileDescriptor,
} from './authFileDescriptor.js'
import {
  maybeRemoveApiKeyFromMacOSKeychainThrows,
  normalizeApiKeyForConfig,
} from './authPortable.js'
import { AwsAuthStatusManager } from './awsAuthStatusManager.js'
import { clearBetasCaches } from './betas.js'
import {
  type AccountInfo,
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from './config.js'
import { logAntError, logForDebugging } from './debug.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
  isRunningOnHomespace,
} from './envUtils.js'
import { errorMessage } from './errors.js'
import { execSyncWithDefaults_DEPRECATED } from './execFileNoThrow.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { memoizeWithTTLAsync } from './memoize.js'
import { getSecureStorage } from './secureStorage/index.js'
import {
  clearLegacyApiKeyPrefetch,
  getLegacyApiKeyPrefetchResult,
} from './secureStorage/keychainPrefetch.js'
import {
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  getUsername,
} from './secureStorage/macOsKeychainHelpers.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'
import { clearToolSchemaCache } from './toolSchemaCache.js'

/** Default TTL for API key helper cache in milliseconds (5 minutes) */
const DEFAULT_API_KEY_HELPER_TTL = 5 * 60 * 1000

/**
 * Re-export the public OAuth helpers at the top of the file so the
 * subscription / account helpers below can reference them. Use a single
 * `export *` to avoid TypeScript treating the symbols as duplicates when
 * they are referenced both as imports and as re-exports.
 */
import {
  saveOAuthTokensIfNeeded as _saveOAuthTokensIfNeeded,
  getClaudeAIOAuthTokens as _getClaudeAIOAuthTokens,
  clearOAuthTokenCache as _clearOAuthTokenCache,
  saveCodexOAuthTokens as _saveCodexOAuthTokens,
  getCodexOAuthTokens as _getCodexOAuthTokens,
  clearCodexOAuthTokens as _clearCodexOAuthTokens,
  handleOAuth401Error as _handleOAuth401Error,
  getClaudeAIOAuthTokensAsync as _getClaudeAIOAuthTokensAsync,
  checkAndRefreshOAuthTokenIfNeeded as _checkAndRefreshOAuthTokenIfNeeded,
} from './authClaudeAiOAuth.js'
import {
  isAnthropicAuthEnabled as _isAnthropicAuthEnabled,
  getAuthTokenSource as _getAuthTokenSource,
  getAnthropicApiKey as _getAnthropicApiKey,
  hasAnthropicApiKeyAuth as _hasAnthropicApiKeyAuth,
  getAnthropicApiKeyWithSource as _getAnthropicApiKeyWithSource,
  getConfiguredApiKeyHelper as _getConfiguredApiKeyHelper,
  calculateApiKeyHelperTTL as _calculateApiKeyHelperTTL,
  getApiKeyHelperElapsedMs as _getApiKeyHelperElapsedMs,
  getApiKeyFromApiKeyHelper as _getApiKeyFromApiKeyHelper,
  getApiKeyFromApiKeyHelperCached as _getApiKeyFromApiKeyHelperCached,
  clearApiKeyHelperCache as _clearApiKeyHelperCache,
  prefetchApiKeyFromApiKeyHelperIfSafe as _prefetchApiKeyFromApiKeyHelperIfSafe,
  type ApiKeySource as ApiKeySourceType,
} from './authTokenSource.js'
import { getApiKeyFromConfigOrMacOSKeychain as _getApiKeyFromConfigOrMacOSKeychain } from './authApiKey.js'

// Internal aliases (used by subscription / account helpers below).
const getClaudeAIOAuthTokens = _getClaudeAIOAuthTokens
const getClaudeAIOAuthTokensAsync = _getClaudeAIOAuthTokensAsync
const getCodexOAuthTokens = _getCodexOAuthTokens
const checkAndRefreshOAuthTokenIfNeeded = _checkAndRefreshOAuthTokenIfNeeded
const isAnthropicAuthEnabled = _isAnthropicAuthEnabled
const getAuthTokenSource = _getAuthTokenSource
const getAnthropicApiKey = _getAnthropicApiKey
const hasAnthropicApiKeyAuth = _hasAnthropicApiKeyAuth
const getAnthropicApiKeyWithSource = _getAnthropicApiKeyWithSource
const getConfiguredApiKeyHelper = _getConfiguredApiKeyHelper
const calculateApiKeyHelperTTL = _calculateApiKeyHelperTTL
const getApiKeyHelperElapsedMs = _getApiKeyHelperElapsedMs
const getApiKeyFromApiKeyHelper = _getApiKeyFromApiKeyHelper
const getApiKeyFromApiKeyHelperCached = _getApiKeyFromApiKeyHelperCached
const clearApiKeyHelperCache = _clearApiKeyHelperCache
const prefetchApiKeyFromApiKeyHelperIfSafe = _prefetchApiKeyFromApiKeyHelperIfSafe
const getApiKeyFromConfigOrMacOSKeychain = _getApiKeyFromConfigOrMacOSKeychain
type ApiKeySource = ApiKeySourceType


/**
 * AWS-specific helpers (awsAuthRefresh, awsCredentialExport, STS, refresh cache)
 * are extracted to `./authAws.ts` to reduce this file's size.
 * Re-exported below for backward compatibility.
 */
export {
  isAwsAuthRefreshFromProjectSettings,
  isAwsCredentialExportFromProjectSettings,
  refreshAwsAuth,
  refreshAndGetAwsCredentials,
  clearAwsCredentialsCache,
} from './authAws.js'

/**
 * GCP-specific helpers (gcpAuthRefresh, credentials probe, refresh cache,
 * prefetch) are extracted to `./authGcp.ts` to reduce this file's size.
 * Re-exported below for backward compatibility.
 */
export {
  isGcpAuthRefreshFromProjectSettings,
  checkGcpCredentialsValid,
  refreshGcpAuth,
  refreshGcpCredentialsIfNeeded,
  clearGcpCredentialsCache,
  prefetchGcpCredentialsIfSafe,
  GcpCredentialsTimeoutError,
} from './authGcp.js'

/**
 * Prefetches AWS credentials only if workspace trust has already been established.
 * Moved to `./authAws.ts`.
 */
export { prefetchAwsCredentialsAndBedRockInfoIfSafe } from './authAws.js'



// Re-export helpers from extracted modules (originally imported with underscore
// prefix at the top). Done at the bottom because TypeScript loses the
// re-export when the same name is used both as a re-export target and as
// an internal alias in the same file.

// OAuth token storage / refresh
export {
  _saveOAuthTokensIfNeeded as saveOAuthTokensIfNeeded,
  _getClaudeAIOAuthTokens as getClaudeAIOAuthTokens,
  _clearOAuthTokenCache as clearOAuthTokenCache,
  _saveCodexOAuthTokens as saveCodexOAuthTokens,
  _getCodexOAuthTokens as getCodexOAuthTokens,
  _clearCodexOAuthTokens as clearCodexOAuthTokens,
  _handleOAuth401Error as handleOAuth401Error,
  _getClaudeAIOAuthTokensAsync as getClaudeAIOAuthTokensAsync,
  _checkAndRefreshOAuthTokenIfNeeded as checkAndRefreshOAuthTokenIfNeeded,
}

// Auth token source detection
export {
  _isAnthropicAuthEnabled as isAnthropicAuthEnabled,
  _getAuthTokenSource as getAuthTokenSource,
  _getAnthropicApiKey as getAnthropicApiKey,
  _hasAnthropicApiKeyAuth as hasAnthropicApiKeyAuth,
  _getAnthropicApiKeyWithSource as getAnthropicApiKeyWithSource,
  _getConfiguredApiKeyHelper as getConfiguredApiKeyHelper,
  _calculateApiKeyHelperTTL as calculateApiKeyHelperTTL,
  _getApiKeyHelperElapsedMs as getApiKeyHelperElapsedMs,
  _getApiKeyFromApiKeyHelper as getApiKeyFromApiKeyHelper,
  _getApiKeyFromApiKeyHelperCached as getApiKeyFromApiKeyHelperCached,
  _clearApiKeyHelperCache as clearApiKeyHelperCache,
  _prefetchApiKeyFromApiKeyHelperIfSafe as prefetchApiKeyFromApiKeyHelperIfSafe,
  _getApiKeyFromConfigOrMacOSKeychain as getApiKeyFromConfigOrMacOSKeychain,
}

// API key storage
export {
  saveApiKey,
  removeApiKey,
  isCustomApiKeyApproved,
} from './authApiKey.js'

// Subscription / account / org-validation helpers
export {
  isClaudeAISubscriber,
  isCodexSubscriber,
  isOpenRouterUser,
  isAnthropicCompatUser,
  hasProfileScope,
  is1PApiCustomer,
  getOauthAccountInfo,
  isOverageProvisioningAllowed,
  hasOpusAccess,
  getSubscriptionType,
  isMaxSubscriber,
  isTeamSubscriber,
  isTeamPremiumSubscriber,
  isEnterpriseSubscriber,
  isProSubscriber,
  getRateLimitTier,
  getSubscriptionName,
  isUsing3PServices,
  isOtelHeadersHelperFromProjectOrLocalSettings,
  getOtelHeadersFromHelper,
  isConsumerSubscriber,
  getAccountInformation,
  validateForceLoginOrg,
} from './authSubscription.js'
export type { UserAccountInfo, OrgValidationResult } from './authSubscription.js'
