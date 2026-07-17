/**
 * Provider HTTP 客户端模块:为各 LLM Provider 提供统一的 HTTP GET/POST 封装,
 * 内置 Bearer / x-api-key / 自定义 header 鉴权、超时控制与自动重试(429/网络错误)。
 * (glm-5.2)
 */
import { ProviderError } from '@shared/types/provider'

/** Bearer Token 鉴权配置。 (glm-5.2) */
interface AuthBearer {
  type: 'bearer'
  token: string
}
/** 通过指定 header 携带 API Key 的鉴权配置。 (glm-5.2) */
interface AuthXApiKey {
  type: 'x-api-key'
  header: string
  token: string
}
/** 自定义多 header 鉴权配置。 (glm-5.2) */
interface AuthCustom {
  type: 'custom'
  headers: Record<string, string>
}

/** 三种鉴权方式的联合类型。 (glm-5.2) */
type Auth = AuthBearer | AuthXApiKey | AuthCustom

/** HTTP 客户端配置:基础地址、鉴权方式、Provider 标识、超时与额外 header。 (glm-5.2) */
export interface HttpClientOptions {
  baseUrl: string
  auth: Auth
  providerId: string
  timeoutMs?: number
  extraHeaders?: Record<string, string>
}

/**
 * 各 Provider 共用的 HTTP 客户端,封装 GET/POST、鉴权、超时与重试。
 */
export class ProviderHttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  /** 组装请求头:设置 Content-Type 并按鉴权方式注入对应 header。 (glm-5.2) */
  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.opts.auth.type === 'bearer') h['Authorization'] = `Bearer ${this.opts.auth.token}`
    else if (this.opts.auth.type === 'x-api-key') h[this.opts.auth.header] = this.opts.auth.token
    else Object.assign(h, this.opts.auth.headers)
    if (this.opts.extraHeaders) Object.assign(h, this.opts.extraHeaders)
    return h
  }

  /**
   * GET 请求并解析 JSON 响应。网络错误与 429 自动重试(最多 2 次),
   * 其余非 2xx 抛出 ProviderError。
   */
  async getJSON<T>(path: string, attempt = 0): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15000)

    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: ctrl.signal
      })
    } catch (e) {
      clearTimeout(timer)
      if (attempt < 2) {
        await this.sleep(1000 * Math.pow(3, attempt))
        return this.getJSON<T>(path, attempt + 1)
      }
      throw new ProviderError(
        this.opts.providerId,
        'NETWORK_ERROR',
        undefined,
        String((e as Error).message ?? e)
      )
    }
    clearTimeout(timer)

    if (res.status === 429 && attempt < 2) {
      const ra = Number(res.headers.get('retry-after') ?? 0)
      const retryAfter = Math.min(Math.max(Number.isFinite(ra) ? ra : 0, 0), 60) * 1000
      await this.sleep(Math.max(retryAfter, 1000 * Math.pow(3, attempt)))
      return this.getJSON<T>(path, attempt + 1)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        this.opts.providerId,
        'HTTP_ERROR',
        res.status,
        `${res.statusText}: ${body.slice(0, 200)}`
      )
    }
    return (await res.json()) as T
  }

  /**
   * POST a JSON body and parse the JSON response. No retry - chat-completions
   * probes are user-initiated and a single failure should bubble up so the
   * caller can show the error. Caller is responsible for sending a body that
   * the server won't bill heavily (e.g. `max_tokens: 1`).
   *
   * 发送 JSON body 的 POST 请求并解析响应;不重试,失败直接冒泡给调用方展示。
   * 调用方应发送不会被高额计费的 body(如 max_tokens: 1)。 (glm-5.2)
   */
  async postJSON<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15000)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        signal: ctrl.signal,
        body: JSON.stringify(body)
      })
    } catch (e) {
      clearTimeout(timer)
      throw new ProviderError(
        this.opts.providerId,
        'NETWORK_ERROR',
        undefined,
        String((e as Error).message ?? e)
      )
    }
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new ProviderError(
        this.opts.providerId,
        'HTTP_ERROR',
        res.status,
        `${res.statusText}: ${text.slice(0, 200)}`
      )
    }
    return (await res.json()) as T
  }

  /** 异步休眠指定毫秒数,用于重试退避。 (glm-5.2) */
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
