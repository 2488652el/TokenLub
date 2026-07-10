/**
 * IPC 通道名常量:集中定义渲染进程与主进程之间所有 invoke/handle 通道字符串。
 * 使用 `as const` 以获得字面量类型,避免通道名拼写不一致。
 * (glm-5.2)
 */
export const IPC = {
  keysList: 'keys:list',
  keysAdd: 'keys:add',
  keysUpdate: 'keys:update',
  keysDelete: 'keys:delete',
  keysTest: 'keys:test',
  keysSetUsageQuery: 'keys:set-usage-query',
  keysImportFromCLI: 'keys:import-from-cli',
  usageRefreshAll: 'usage:refresh-all',
  usageGetDashboard: 'usage:get-dashboard',
  usageGetProviderSummary: 'usage:get-provider-summary',
  usageGetLogs: 'usage:get-logs',
  usageGetLogsPage: 'usage:get-logs-page',
  usageGetTotalSpend: 'usage:get-total-spend',
  usageGetModelSpend: 'usage:get-model-spend',
  usageGetKeySpend: 'usage:get-key-spend',
  balanceListLatest: 'balance:list-latest',
  providersList: 'providers:list',
  providersCatalog: 'providers:catalog',
  logDiscover: 'log:discover',
  logSync: 'log:sync',
  logSyncProgress: 'subscribe:log-sync-progress',
  logSyncDone: 'subscribe:log-sync-done',
  logDetectCodexKey: 'log:detect-codex-key',
  logDetectClaudeKey: 'log:detect-claude-key',
  logOpenFolder: 'log:open-folder',
  pricingList: 'pricing:list',
  pricingSet: 'pricing:set',
  pricingRestore: 'pricing:restore',
  pricingCatalog: 'pricing:catalog',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  alertsList: 'alerts:list',
  alertsAdd: 'alerts:add',
  alertsToggle: 'alerts:toggle',
  alertsDelete: 'alerts:delete'
} as const
