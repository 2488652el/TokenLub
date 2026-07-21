# Provider Catalog

The runtime registry in `code/src/main/providers/registry.ts` is authoritative
for built-in implementations. The table below describes the current code paths;
real-account availability still depends on vendor credentials, account tier,
region, and upstream API behavior.

| ID              | Category       | Current implementation                                                               |
| --------------- | -------------- | ------------------------------------------------------------------------------------ |
| deepseek        | third-party    | Balance through `/user/balance`                                                      |
| zhipu           | token-plan     | `/api/biz/account/balance`, with chat-completions connectivity fallback              |
| moonshot        | token-plan     | Tries known balance, credit-grant, and subscription endpoints                        |
| kimi-coding     | token-plan     | Coding Plan usage through `/coding/v1/usages`; `/models` validates connectivity      |
| minimax         | token-plan     | Token Plan quota through `/v1/token_plan/remains`; `/v1/models` validates the key    |
| stepfun         | third-party    | Tries supported account and balance endpoint shapes                                  |
| siliconflow     | third-party    | Tries supported user/account balance endpoint shapes                                 |
| openrouter      | third-party    | Credit limit, remaining credit, and usage through `/auth/key`                        |
| anthropic-admin | admin-org      | Organization cost report and usage APIs; requires an Anthropic Admin key             |
| openai-admin    | admin-org      | Organization costs and completions usage APIs; requires an OpenAI Admin key          |
| longcat         | token-plan     | Key validation through `/openai/v1/models`; token packs require platform-cookie mode |
| newapi-generic  | newapi-generic | Self-hosted account quota through `{baseUrl}/api/user/self`                          |
| qwen-manual     | manual         | No balance API; user enters the balance                                              |
| gemini-manual   | manual         | No balance API; user enters the balance                                              |
| manual          | manual         | Generic user-entered fallback                                                        |

Provider implementations and automated tests are verified locally. This table
does not claim that every credential-gated vendor endpoint was live-verified in
the current workspace.

Auto-detected CLI credentials:

- Claude Code `.credentials.json` if present
- Codex CLI `.codex/auth.json` if present

When a provider implementation or fallback path changes, update this table and
its provider tests together. Do not label an endpoint live-verified without a
current real-account probe.

## Pricing catalog sync

MoonMeter imports provider-specific model pricing from [models.dev](https://models.dev) using its public `https://models.dev/api.json` endpoint. Prices are USD per million tokens.

**How it works:**

- The main process checks hourly and downloads only when the last successful sync is over 24 hours old. The price page also exposes manual sync and an auto-update toggle.
- Conditional requests use the upstream ETag, so an unchanged catalog returns `304` without parsing or writing the database.
- The main process transforms `provider.models[*].cost` and upserts entries with `source='catalog'`. The API values already use USD per million tokens, so no unit multiplication is applied.
- The price page keeps USD as the canonical value and shows an approximate CNY value using the cached exchange-rate service. Derived CNY values are not persisted as duplicate price rows.
- CNY display supports three local policies: live cached rates, the built-in offline reference, or a user-supplied fixed rate. The selected policy is local configuration and does not mutate canonical USD catalog rows.
- Price identities use `providerId + billingScope + model + currency`. `default` is the ordinary channel, while `cn` and `global` separate China and international endpoint prices. Moonshot and MiniMax infer the scope from the configured official Base URL; custom gateways remain `default` so users can provide an explicit override.
- A successful full-catalog sync reconciles all models.dev-managed provider scopes. Missing upstream models are retained with `catalog_active=0` and shown as “上游已移除”, preserving historical billing instead of silently deleting old prices. User rows and MiniMax's built-in `cn` catalog are outside this deactivation pass.
- Before a manual update is applied, the price page can create a preview containing added, changed, and removed models. A price change above the configured 200% ratio is blocked from automatic application; the user must explicitly review and confirm it. Every detected/applied change is retained in `pricing_change_history`.
- **User prices win**: `upsertCatalogBatch` only overwrites rows where `source='catalog'`. Existing `source='user'` rows are preserved (enforced by `WHERE pricing_entries.source = 'catalog'` in the ON CONFLICT clause). `findPricing` also sorts `source='user'` ahead of `catalog`.

**Provider mapping** (models.dev prefix → MoonMeter providerId):

| models.dev prefix | MoonMeter providerId | Note                                                        |
| ----------------- | ------------------- | ----------------------------------------------------------- |
| `anthropic`       | `anthropic-admin`   | Prices are the same for public API and org admin            |
| `openai`          | `openai-admin`      | Same                                                        |
| `deepseek`        | `deepseek`          | Direct match                                                |
| `moonshotai`      | `moonshot`          | International USD catalog uses `global` scope               |
| `alibaba`         | `qwen-manual`       | Qwen has no balance API; pricing still useful for cost calc |
| `stepfun`         | `stepfun`           | Direct match                                                |
| `zhipuai`         | `zhipu`             | Direct vendor pricing                                       |
| `minimax`         | `minimax`           | USD uses `global`; the China CNY catalog remains in `cn`    |
| `longcat`         | `longcat`           | Direct match                                                |
| `siliconflow`     | `siliconflow`       | Uses SiliconFlow's provider-specific prices                 |
| `openrouter`      | `openrouter`        | Uses OpenRouter's provider-specific routed prices           |
| `google`          | `gemini-manual`     | Pricing is useful even though balance is entered manually   |

Providers not in this map are skipped because MoonMeter cannot associate their usage with a supported provider. `newapi-generic` remains manual because each deployment can define its own multipliers and prices. To add a mapping, edit `PROVIDER_MAPPING` in `code/src/main/pricing/catalog.ts`.
