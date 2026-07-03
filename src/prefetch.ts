/**
 * Deferred background prefetches and housekeeping.
 *
 * Extracted from `main.tsx` to break the import cycle:
 *   main.tsx → dialogLaunchers.tsx → interactiveHelpers.tsx → main.tsx
 *
 * After this extraction:
 *   main.tsx → prefetch.ts
 *   interactiveHelpers.tsx → prefetch.ts
 *   No cycle.
 */

// eslint-disable-next-line custom-rules/no-top-level-side-effects
import { getSystemContext, getUserContext } from './context.js';
import { prefetchAwsCredentialsAndBedRockInfoIfSafe, prefetchGcpCredentialsIfSafe } from './utils/auth.js';
import { settingsChangeDetector } from './utils/settings/changeDetector.js';
import { checkHasTrustDialogAccepted } from './utils/config.js';
import { getIsNonInteractiveSession } from './bootstrap/state.js';
import { isBareMode, isEnvTruthy } from './utils/envUtils.js';
import { logForDiagnosticsNoPII } from './utils/diagLogs.js';
import { countFilesRoundedRg } from './utils/ripgrep.js';
import { initializeAnalyticsGates } from 'src/services/analytics/sink.js';
import { prefetchOfficialMcpUrls } from './services/mcp/officialRegistry.js';
import { getRelevantTips } from 'src/services/tips/tipRegistry.js';
import { getCwd } from 'src/utils/cwd.js';
import { refreshModelCapabilities } from 'src/utils/model/modelCapabilities.js';
import { initUser } from './utils/user.js';
import { skillChangeDetector } from './utils/skills/skillChangeDetector.js';

/**
 * Prefetch the system context (cwd, files, env) ahead of the first user turn.
 *
 * In non-interactive mode (`--print`), prefetch unconditionally — the trust
 * dialog is skipped and execution is trusted. In interactive mode, only
 * prefetch if the trust dialog has already been accepted; otherwise wait.
 */
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession()

  // In non-interactive mode (--print), trust dialog is skipped and
  // execution is considered trusted (as documented in help text)
  if (isNonInteractiveSession) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_non_interactive')
    void getSystemContext()
    return
  }

  // In interactive mode, only prefetch if trust has already been established
  const hasTrust = checkHasTrustDialogAccepted()
  if (hasTrust) {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_has_trust')
    void getSystemContext()
  } else {
    logForDiagnosticsNoPII('info', 'prefetch_system_context_skipped_no_trust')
  }
  // Otherwise, don't prefetch - wait for trust to be established first
}

/**
 * Start background prefetches and housekeeping that are NOT needed before first render.
 * These are deferred from setup() to reduce event loop contention and child process
 * spawning during the critical startup path.
 * Call this after the REPL has been rendered.
 */
export function startDeferredPrefetches(): void {
  // This function runs after first render, so it doesn't block the initial paint.
  // However, the spawned processes and async work still contend for CPU and event
  // loop time, which skews startup benchmarks (CPU profiles, time-to-first-render
  // measurements). Skip all of it when we're only measuring startup performance.
  if (isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER) ||
  // --bare: skip ALL prefetches. These are cache-warms for the REPL's
  // first-turn responsiveness (initUser, getUserContext, tips, countFiles,
  // modelCapabilities, change detectors). Scripted -p calls don't have a
  // "user is typing" window to hide this work in — it's pure overhead on the
  // critical path.
  isBareMode()) {
    return
  }

  // Process-spawning prefetches (consumed at first API call, user is still typing)
  void initUser()
  void getUserContext()
  prefetchSystemContextIfSafe()
  void getRelevantTips()
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
    void prefetchAwsCredentialsAndBedRockInfoIfSafe()
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
    void prefetchGcpCredentialsIfSafe()
  }
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), [])

  // Analytics and feature flag initialization
  void initializeAnalyticsGates()
  void prefetchOfficialMcpUrls()
  void refreshModelCapabilities()

  // File change detectors deferred from init() to unblock first render
  void settingsChangeDetector.initialize()
  if (!isBareMode()) {
    void skillChangeDetector.initialize()
  }

  // Event loop stall detector — logs when the main thread is blocked >500ms
  if ("external" === 'ant') {
    void import('./utils/eventLoopStallDetector.js').then(m => m.startEventLoopStallDetector())
  }
}
