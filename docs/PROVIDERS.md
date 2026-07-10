# Provider Catalog

| ID | Display | Category | Auth | Status | Live endpoint |
|----|---------|----------|------|--------|---------------|
| deepseek | DeepSeek | third-party | Bearer | ✅ verified | GET /user/balance, /user/usage |
| zhipu | 智谱 GLM | token-plan | Bearer | ✅ verified | /api/biz/account/{balance,limit,cash} |
| moonshot | 月之暗面 Kimi | token-plan | Bearer | ⚠️ undocumented | TBD probe in Phase D |
| minimax | MiniMax | third-party | Bearer | ⚠️ undocumented | probe |
| stepfun | StepFun 阶跃 | third-party | Bearer | ⚠️ undocumented | probe |
| siliconflow | SiliconFlow 硅基流动 | third-party | Bearer | ⚠️ undocumented | probe |
| openrouter | OpenRouter | third-party | Bearer | ⚠️ undocumented | probe |
| anthropic-admin | Anthropic Admin | admin-org | sk-ant-admin | ⚠️ gated | GET /v1/organizations/{usage,cost_report} |
| openai-admin | OpenAI Admin | admin-org | sk-admin | ⚠️ gated | GET /v1/organization/usage/* |
| longcat | 美团 LongCat | token-plan | Bearer | ⚠️ undocumented | probe |
| qwen-manual | 通义千问 (manual) | manual | n/a | ❌ no API | user enters balance |
| gemini-manual | Gemini 免费层 (manual) | manual | n/a | ❌ no API | user enters balance |
| newapi-generic | NewAPI / OneAPI 通用 | newapi-generic | Bearer | ✅ verified pattern | {baseUrl}/api/user/self |
| manual | Manual fallback | manual | n/a | always | user enters |

Auto-detected CLI keys (Phase D2):
- Claude Code `.credentials.json` if present
- Codex CLI `.codex/auth.json` if present

Each Phase D sub-task updates this document when a provider goes live.

## Pricing catalog sync

TokenLub can import model pricing from [models.dev](https://github.com/anomalyco/models.dev) (364+ models, USD per-token prices updated upstream).

**How it works:**
- User triggers sync manually via `window.api.pricing.syncCatalog()` (no auto-refresh — prices don't change daily and each fetch is ~500KB).
- Main process fetches `models.json` from GitHub raw, transforms entries, upserts into `pricing_entries` with `source='catalog'`.
- **Unit conversion**: models.dev prices are USD-per-token; TokenLub stores USD-per-million-tokens (×1,000,000).
- **User prices win**: `upsertCatalogBatch` only overwrites rows where `source='catalog'`. Existing `source='user'` rows are preserved (enforced by `WHERE pricing_entries.source = 'catalog'` in the ON CONFLICT clause). `findPricing` also sorts `source='user'` ahead of `catalog`.

**Provider mapping** (models.dev prefix → TokenLub providerId):

| models.dev prefix | TokenLub providerId | Note |
|---|---|---|
| `anthropic` | `anthropic-admin` | Prices are the same for public API and org admin |
| `openai` | `openai-admin` | Same |
| `deepseek` | `deepseek` | Direct match |
| `moonshotai` | `moonshot` | Name variant |
| `qwen` | `qwen-manual` | Qwen has no balance API; pricing still useful for cost calc |
| `stepfun` | `stepfun` | Direct match |

Providers not in this map (e.g. `google`, `siliconflow`, `meta-llama`) are skipped — they have no TokenLub equivalent or are aggregators whose prices differ from upstream. To add a mapping, edit `PROVIDER_MAPPING` in `src/main/pricing/catalog.ts`.