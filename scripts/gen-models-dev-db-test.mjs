#!/usr/bin/env node
/**
 * One-shot generator for the models.dev database-test dataset.
 *
 * Source API:  https://models.dev/api.json   (provider-keyed, cost in USD per million tokens)
 * Output dir:  artifacts/db-test/
 *
 * Reads the already-fetched raw payload from .cache/models-dev/api.json,
 * then writes:
 *   1. api.json              — verbatim raw payload (the canonical source of truth)
 *   2. providers/<id>.json   — one file per provider (meta + all its models)
 *   3. models-flat.jsonl     — one JSON object per model, flattened for DB seeding
 *   4. summary.json          — counts, price stats, cost-field distribution, and a
 *                              TokenLub provider-mapping checklist derived from
 *                              src/main/pricing/catalog.ts PROVIDER_MAPPING.
 *
 * Run:  node scripts/gen-models-dev-db-test.mjs
 *
 * 中文说明:models.dev 测试数据集一次性生成器。 (glm-5.2)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, '.cache', 'models-dev', 'api.json')
const OUT = join(ROOT, 'artifacts', 'db-test')
const PROVIDERS_OUT = join(OUT, 'providers')

// --- TokenLub provider mapping (mirror of src/main/pricing/catalog.ts PROVIDER_MAPPING) ---
// models.dev provider key  ->  TokenLub providerId
// TokenLub 的 provider 映射表(与 src/main/pricing/catalog.ts 中的 PROVIDER_MAPPING 保持一致),
// key 为 models.dev 的 provider key,value 为 TokenLub 侧的 providerId。
const PROVIDER_MAPPING = {
  anthropic: 'anthropic-admin',
  openai: 'openai-admin',
  deepseek: 'deepseek',
  moonshotai: 'moonshot',
  qwen: 'qwen-manual',
  stepfun: 'stepfun',
}

// Providers present in TokenLub's provider registry that have NO official
// models.dev counterpart (so they are intentionally absent from the fetch).
// TokenLub provider 注册表中存在、但 models.dev 官方并无对应条目的 provider 列表,
// 因此在抓取时被有意排除。
const TOKENLUB_ONLY_PROVIDERS = [
  'gemini-manual',
  'manual',
  'minimax',
  'longcat',
  'siliconflow',
  'newapi-generic',
  'zhipu',
]

// --- load ---
const rawText = readFileSync(SRC, 'utf8')
const data = JSON.parse(rawText)
const providerKeys = Object.keys(data)

mkdirSync(PROVIDERS_OUT, { recursive: true })
// clear stale per-provider files so deleted providers don't linger
// 清理过期的 per-provider 文件,避免已删除的 provider 残留
for (const f of readdirSync(PROVIDERS_OUT)) {
  if (f.endsWith('.json')) rmSync(join(PROVIDERS_OUT, f))
}

// --- 1. verbatim api.json ---
writeFileSync(join(OUT, 'api.json'), rawText)

// --- helpers ---
/**
 * 安全数值规范化:仅当传入值为有限数字时返回该值,否则返回 null。
 * @param {*} v - 待校验的任意值
 * @returns {number|null} 合法数字则原样返回,否则返回 null
 */
function safeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Flatten a single model into a DB-seed-friendly row.
/**
 * 将单个 model 对象拍平为适合数据库 seed 的单行记录。
 * @param {string} providerKey - models.dev 侧的 provider key
 * @param {string} modelId - 模型 ID
 * @param {object} m - 原始 model 对象(含 cost/limit/modalities 等字段)
 * @returns {object} 扁平化后的 model 行对象,可直接写入 JSONL 供 DB seed 使用
 */
function flattenModel(providerKey, modelId, m) {
  const cost = m.cost || {}
  const limit = m.limit || {}
  const mod = m.modalities || {}
  const row = {
    provider: providerKey,
    tokenlub_provider_id: PROVIDER_MAPPING[providerKey] ?? null,
    model: modelId,
    name: m.name ?? modelId,
    family: m.family ?? null,
    description: m.description ?? null,
    // prices = USD per million tokens (models.dev convention == TokenLub convention)
    // 价格单位为"每百万 token 美元"(models.dev 与 TokenLub 的约定一致)
    price_input_per_mtok: safeNumber(cost.input),
    price_output_per_mtok: safeNumber(cost.output),
    price_cache_read_per_mtok: safeNumber(cost.cache_read),
    price_cache_write_per_mtok: safeNumber(cost.cache_write),
    price_context_over_200k_per_mtok: safeNumber(cost.context_over_200k),
    price_input_audio_per_mtok: safeNumber(cost.input_audio),
    price_output_audio_per_mtok: safeNumber(cost.output_audio),
    price_reasoning_per_mtok: safeNumber(cost.reasoning),
    has_tiered_pricing: Array.isArray(cost.tiers) && cost.tiers.length > 0,
    limit_context: safeNumber(limit.context),
    limit_output: safeNumber(limit.output),
    modalities_input: Array.isArray(mod.input) ? mod.input : [],
    modalities_output: Array.isArray(mod.output) ? mod.output : [],
    reasoning: !!m.reasoning,
    tool_call: !!m.tool_call,
    attachment: !!m.attachment,
    temperature: !!m.temperature,
    open_weights: !!m.open_weights,
    knowledge: m.knowledge ?? null,
    release_date: m.release_date ?? null,
    last_updated: m.last_updated ?? null,
  }
  return row
}

// --- 2. per-provider files + 3. flat jsonl ---
const flatRows = []
const perProviderStats = {}
const costFieldDist = {}

for (const pk of providerKeys) {
  const p = data[pk]
  const models = p.models || {}
  const modelIds = Object.keys(models)
  const providerDoc = {
    id: p.id ?? pk,
    key: pk,
    name: p.name ?? pk,
    api: p.api ?? null,
    npm: p.npm ?? null,
    env: p.env ?? null,
    doc: p.doc ?? null,
    model_count: modelIds.length,
    tokenlub_provider_id: PROVIDER_MAPPING[pk] ?? null,
    models,
  }
  writeFileSync(join(PROVIDERS_OUT, `${pk}.json`), JSON.stringify(providerDoc, null, 2) + '\n')

  for (const mid of modelIds) {
    const m = models[mid]
    const row = flattenModel(pk, mid, m)
    flatRows.push(row)
    // cost field distribution
    // 统计各 cost 字段出现次数,用于 cost_field_distribution
    const cost = m.cost || {}
    for (const ck of Object.keys(cost)) {
      costFieldDist[ck] = (costFieldDist[ck] || 0) + 1
    }
  }

  perProviderStats[pk] = {
    name: p.name ?? pk,
    model_count: modelIds.length,
    tokenlub_provider_id: PROVIDER_MAPPING[pk] ?? null,
  }
}

// write flat jsonl (sorted by provider then model for stable, diff-friendly output)
// 写入扁平化 jsonl:按 provider 再按 model 排序,保证输出稳定、便于 diff
flatRows.sort((a, b) => (a.provider + '/' + a.model).localeCompare(b.provider + '/' + b.model))
writeFileSync(
  join(OUT, 'models-flat.jsonl'),
  flatRows.map((r) => JSON.stringify(r)).join('\n') + '\n',
)

// --- price-range stats (over rows that actually have input+output prices) ---
// 价格区间统计:仅针对实际声明了 input/output 价格的行进行计算
let minInput = Infinity
let maxInput = 0
let minOutput = Infinity
let maxOutput = 0
let noInputPrice = 0
let noOutputPrice = 0
let noCostAtAll = 0
for (const r of flatRows) {
  const inP = r.price_input_per_mtok
  const outP = r.price_output_per_mtok
  if (inP === null && outP === null) {
    noCostAtAll++
    continue
  }
  if (inP === null) noInputPrice++
  else {
    if (inP < minInput) minInput = inP
    if (inP > maxInput) maxInput = inP
  }
  if (outP === null) noOutputPrice++
  else {
    if (outP < minOutput) minOutput = outP
    if (outP > maxOutput) maxOutput = outP
  }
}

// --- mapping checklist (TokenLub side) ---
const mappingChecklist = []
for (const [mdKey, tsId] of Object.entries(PROVIDER_MAPPING)) {
  const present = providerKeys.includes(mdKey)
  const stats = perProviderStats[mdKey] || null
  mappingChecklist.push({
    models_dev_provider: mdKey,
    tokenlub_provider_id: tsId,
    present_in_api_json: present,
    model_count: stats?.model_count ?? 0,
  })
}

// providers in api.json with a known substring overlap to TokenLub registry names
const knownCandidates = [
  'anthropic',
  'openai',
  'deepseek',
  'moonshotai',
  'qwen',
  'alibaba',
  'stepfun',
  'stepfun-ai',
  'zhipu',
  'zhipuai',
  'minimax',
  'siliconflow',
  'google',
  'mistral',
  'xai',
]
const candidateProviders = providerKeys.filter((pk) =>
  knownCandidates.some((c) => pk === c || pk.includes(c)),
)

// --- 4. summary.json ---
const summary = {
  source: {
    api: 'https://models.dev/api.json',
    fetched_path: SRC.replace(/\\/g, '/'),
    note:
      'api.json is provider-keyed (151 providers). cost fields are USD per million tokens — same unit TokenLub stores (USD/MTok). This differs from src/main/pricing/catalog.ts which reads a different models.dev endpoint (raw.githubusercontent.com/.../models.json, provider/model ids, USD per token strings).',
  },
  generated_by: 'scripts/gen-models-dev-db-test.mjs',
  counts: {
    providers: providerKeys.length,
    models_total: flatRows.length,
    models_with_cost: flatRows.length - noCostAtAll,
    models_without_any_cost: noCostAtAll,
    providers_mapped_to_tokenlub: Object.values(PROVIDER_MAPPING).filter((id) =>
      providerKeys.some((pk) => PROVIDER_MAPPING[pk] === id),
    ).length,
  },
  price_range_usd_per_mtok: {
    note: 'Across rows that declare the price',
    input: { min: minInput, max: maxInput, missing_count: noInputPrice },
    output: { min: minOutput, max: maxOutput, missing_count: noOutputPrice },
  },
  cost_field_distribution: costFieldDist,
  tokenlub_mapping: {
    source: 'src/main/pricing/catalog.ts PROVIDER_MAPPING',
    checklist: mappingChecklist,
    tokenlub_only_providers_not_in_api_json: TOKENLUB_ONLY_PROVIDERS,
    candidate_providers_in_api_json: candidateProviders,
  },
  files: {
    'api.json': 'verbatim raw payload (canonical source of truth)',
    'providers/<id>.json': `${providerKeys.length} files — provider meta + all its models`,
    'models-flat.jsonl': `${flatRows.length} lines — one flattened model row per line`,
    'summary.json': 'this file',
  },
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')

console.log(`✓ wrote ${OUT.replace(/\\/g, '/')}/`)
console.log(`  api.json            (${providerKeys.length} providers — verbatim)`)
console.log(`  providers/*.json    (${providerKeys.length} files)`)
console.log(`  models-flat.jsonl   (${flatRows.length} rows)`)
console.log(
  `  summary.json        (mapped providers: ${summary.counts.providers_mapped_to_tokenlub}/${Object.keys(PROVIDER_MAPPING).length})`,
)
