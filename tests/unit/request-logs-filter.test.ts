/**
 * 请求日志过滤构建器单元测试:覆盖 buildRequestLogFilter,校验分页查询与导出查询的参数组装。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { buildRequestLogFilter } from '../../src/shared/utils/request-log-filter'

// RequestLogs 过滤构建器:组装分页/导出查询所需的时间范围、来源、搜索与分页参数
describe('RequestLogs filter builder', () => {
  it('builds the paged query used by the table', () => {
    const filter = buildRequestLogFilter({
      providerFilter: 'openai-admin',
      sourceFilter: 'vendor-api',
      fromDate: '2026-07-01',
      toDate: '2026-07-02',
      search: 'gpt-4o',
      limit: 100,
      offset: 200
    })

    expect(filter).toEqual({
      providerId: 'openai-admin',
      source: 'vendor-api',
      fromISO: new Date('2026-07-01T00:00:00').toISOString(),
      toISO: new Date('2026-07-02T23:59:59.999').toISOString(),
      modelContains: 'gpt-4o',
      limit: 100,
      offset: 200
    })
  })

  it('builds an unpaged export query with the larger safe IPC limit', () => {
    const filter = buildRequestLogFilter({
      providerFilter: 'all',
      sourceFilter: 'all',
      fromDate: '2026-07-01',
      toDate: '2026-07-02',
      search: '  ',
      limit: 10000
    })

    expect(filter).toEqual({
      fromISO: new Date('2026-07-01T00:00:00').toISOString(),
      toISO: new Date('2026-07-02T23:59:59.999').toISOString(),
      limit: 10000
    })
  })
})
