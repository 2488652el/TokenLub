/**
 * money 工具单元测试:覆盖 toDecimal / fmtMoney / calcCost / convertSpendToCny / normalizeCurrency / fmtCount。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import {
  calcCost,
  convertPriceCurrency,
  convertPriceToCny,
  convertSpendToCny,
  fmtCount,
  fmtMoney,
  normalizeCurrency,
  toDecimal
} from '@shared/utils/money'

// toDecimal:将多种输入安全转换为 Decimal,避免浮点漂移
describe('toDecimal', () => {
  it('returns Decimal(0) for null or undefined', () => {
    expect(toDecimal(null).toString()).toBe('0')
    expect(toDecimal(undefined).toString()).toBe('0')
  })
  it('parses numeric strings without float drift', () => {
    expect(toDecimal('0.1').plus(toDecimal('0.2')).toString()).toBe('0.3')
  })
  it('passes through finite numbers', () => {
    expect(toDecimal(42).toString()).toBe('42')
  })
})

// fmtMoney:按币种符号与精度格式化金额
describe('fmtMoney', () => {
  it('formats CNY with ¥ symbol and 2 decimal places', () => {
    expect(fmtMoney(123.4, 'CNY')).toBe('¥123.40')
  })
  it('formats USD with $ symbol', () => {
    expect(fmtMoney(99.9, 'USD')).toBe('$99.90')
  })
  it('falls back to currency code for unknown symbols', () => {
    expect(fmtMoney(10, 'JPY')).toBe('JPY 10.00')
  })
})

describe('convertPriceToCny', () => {
  it('keeps CNY prices unchanged', () => {
    expect(convertPriceToCny('12.34', 'CNY')).toBe(12.34)
    expect(convertPriceToCny(8, 'rmb')).toBe(8)
  })

  it('converts USD and EUR prices without floating-point drift', () => {
    expect(convertPriceToCny(0.1, 'USD', 7.2)).toBe(0.72)
    expect(convertPriceToCny(2.5, 'EUR', 8.1)).toBe(20.25)
  })

  it('returns null when a non-CNY price has no valid rate', () => {
    expect(convertPriceToCny(1, 'USD')).toBeNull()
    expect(convertPriceToCny(1, 'USD', 0)).toBeNull()
    expect(convertPriceToCny(1, 'USD', Number.NaN)).toBeNull()
  })
})

describe('convertPriceCurrency', () => {
  const rates = { USD: 7.2, EUR: 8.1 }

  it('uses CNY as the default display conversion target', () => {
    expect(convertPriceCurrency(2, 'USD', 'CNY', rates)).toBe(14.4)
    expect(convertPriceCurrency(2, 'CNY', 'CNY', rates)).toBe(2)
  })

  it('converts every source currency to USD display prices', () => {
    expect(convertPriceCurrency(14.4, 'CNY', 'USD', rates)).toBe(2)
    expect(convertPriceCurrency(2, 'USD', 'USD', rates)).toBe(2)
    expect(convertPriceCurrency(8.1, 'EUR', 'USD', rates)).toBe(9.1125)
  })

  it('returns null when either conversion rate is unavailable', () => {
    expect(convertPriceCurrency(1, 'EUR', 'USD', { USD: 7.2 })).toBeNull()
    expect(convertPriceCurrency(1, 'CNY', 'USD', {})).toBeNull()
  })
})

// calcCost:按 token 量 × 每百万价格计算成本,含缓存价格与防御处理
describe('calcCost', () => {
  it('multiplies tokens × per-million price correctly', () => {
    // 1,000,000 prompt tokens at $3/Mtok + 500,000 completion at $15/Mtok = $3 + $7.5 = $10.50
    const cost = calcCost(1_000_000, 500_000, 3, 15)
    expect(cost).toBeCloseTo(10.5, 8)
  })

  it('treats null/undefined tokens and prices as zero', () => {
    expect(calcCost(null, null, null, null)).toBe(0)
    expect(calcCost(undefined, 1000, undefined, '2')).toBe(0.002)
    expect(calcCost(1000, undefined, 2, undefined)).toBe(0.002)
  })

  it('includes cache token prices when provided', () => {
    expect(calcCost(1_000, 2_000, 1, 2, 500, 250, 0.5, 3)).toBe(0.006)
  })

  it('rejects negative token counts as zero (defensive)', () => {
    expect(calcCost(-100, 0, 3, 15)).toBe(0)
  })

  it('avoids float drift over many calls', () => {
    // Repeated 0.1 + 0.2 would drift in IEEE 754; Decimal keeps the truth
    let total = 0
    for (let i = 0; i < 1000; i++) total += calcCost(1, 0, 0.1, 0)
    // 1000 × 0.0000001 = 0.0001
    expect(total).toBeCloseTo(0.0001, 6)
  })
})

// convertSpendToCny:按汇率将多币种花费汇总折算为人民币
describe('convertSpendToCny', () => {
  it('normalizes mixed currencies into CNY', () => {
    const result = convertSpendToCny({
      byCurrency: [
        { currency: 'USD', amount: 10 },
        { currency: 'CNY', amount: 5 }
      ],
      ratesToCny: { USD: 7.2, CNY: 1 },
      rateSource: 'api',
      updatedAt: '2026-07-08 08:00:00'
    })

    expect(result.cnyTotal).toBe(77)
    expect(result.exchangeRateSource).toBe('api')
    expect(result.exchangeRateUpdatedAt).toBe('2026-07-08 08:00:00')
    expect(result.convertedByCurrency).toContainEqual({
      currency: 'USD',
      amount: 10,
      rateToCny: 7.2,
      cnyAmount: 72
    })
  })

  it('reports currencies that cannot be converted', () => {
    const result = convertSpendToCny({
      byCurrency: [
        { currency: 'JPY', amount: 100 },
        { currency: 'CNY', amount: 1 }
      ],
      ratesToCny: { CNY: 1 }
    })

    expect(result.cnyTotal).toBe(1)
    expect(result.unconvertedCurrencies).toEqual(['JPY'])
  })
})

// normalizeCurrency:规范化币种代码(大写、默认值)
describe('normalizeCurrency', () => {
  it('uppercases currency codes and defaults to CNY', () => {
    expect(normalizeCurrency(' usd ')).toBe('USD')
    expect(normalizeCurrency('')).toBe('CNY')
    expect(normalizeCurrency(undefined)).toBe('CNY')
  })
})

// fmtCount:按中文习惯格式化数量(亿/万/千分位)
describe('fmtCount', () => {
  it('formats >=1e8 as 亿', () => {
    expect(fmtCount(123_456_789)).toBe('1.23 亿')
  })
  it('formats >=1e4 as 万', () => {
    expect(fmtCount(9_267_000)).toBe('926.70 万')
  })
  it('passes small numbers through with thousands separators', () => {
    expect(fmtCount(4321)).toBe('4,321')
    expect(fmtCount(0)).toBe('0')
  })
  it('treats null/undefined/NaN as 0', () => {
    expect(fmtCount(null)).toBe('0')
    expect(fmtCount(undefined)).toBe('0')
    expect(fmtCount(Number.NaN)).toBe('0')
  })
})
