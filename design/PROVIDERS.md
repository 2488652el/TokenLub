# Provider Catalog

| ID              | Display                | Category       | Auth         | Status              | Live endpoint                             |
| --------------- | ---------------------- | -------------- | ------------ | ------------------- | ----------------------------------------- |
| deepseek        | DeepSeek               | third-party    | Bearer       | ✅ verified         | GET /user/balance, /user/usage            |
| zhipu           | 智谱 GLM               | token-plan     | Bearer       | ✅ verified         | /api/biz/account/{balance,limit,cash}     |
| moonshot        | 月之暗面 Kimi          | token-plan     | Bearer       | ⚠️ undocumented     | TBD probe in Phase D                      |
| minimax         | MiniMax                | third-party    | Bearer       | ⚠️ undocumented     | probe                                     |
| stepfun         | StepFun 阶跃           | third-party    | Bearer       | ⚠️ undocumented     | probe                                     |
| siliconflow     | SiliconFlow 硅基流动   | third-party    | Bearer       | ⚠️ undocumented     | probe                                     |
| openrouter      | OpenRouter             | third-party    | Bearer       | ⚠️ undocumented     | probe                                     |
| anthropic-admin | Anthropic Admin        | admin-org      | sk-ant-admin | ⚠️ gated            | GET /v1/organizations/{usage,cost_report} |
| openai-admin    | OpenAI Admin           | admin-org      | sk-admin     | ⚠️ gated            | GET /v1/organization/usage/*              |
| longcat         | 美团 LongCat           | token-plan     | Bearer       | ⚠️ undocumented     | probe                                     |
| qwen-manual     | 通义千问 (manual)      | manual         | n/a          | ❌ no API           | user enters balance                       |
| gemini-manual   | Gemini 免费层 (manual) | manual         | n/a          | ❌ no API           | user enters balance                       |
| newapi-generic  | NewAPI / OneAPI 通用   | newapi-generic | Bearer       | ✅ verified pattern | {baseUrl}/api/user/self                   |
| manual          | Manual fallback        | manual         | n/a          | always              | user enters                               |

Auto-detected CLI keys (Phase D2):

- Claude Code `.credentials.json` if present
- Codex CLI `.codex/auth.json` if present

Each Phase D sub-task updates this document when a provider goes live.

## Pricing catalog sync

TokenLub imports provider-specific model pricing from [models.dev](https://models.dev) using its public `https://models.dev/api.json` endpoint. Prices are USD per million tokens.

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

**Provider mapping** (models.dev prefix → TokenLub providerId):

| models.dev prefix | TokenLub providerId | Note                                                        |
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

Providers not in this map are skipped because TokenLub cannot associate their usage with a supported provider. `newapi-generic` remains manual because each deployment can define its own multipliers and prices. To add a mapping, edit `PROVIDER_MAPPING` in `code/src/main/pricing/catalog.ts`.
