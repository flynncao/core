/**
 * HttpCache interceptor.
 * @file 缓存拦截器
 * @module interceptor/cache
 * @author Surmon <https://github.com/surmon-china>
 * @author Innei <https://innei.ren>
 */
import { of, tap } from 'rxjs'
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common'
import type { Observable } from 'rxjs'

import { Inject, Injectable, Logger, RequestMethod } from '@nestjs/common'
import { HttpAdapterHost, Reflector } from '@nestjs/core'

import { REDIS } from '~/app.config'
import { API_CACHE_PREFIX } from '~/constants/cache.constant'
import * as META from '~/constants/meta.constant'
import * as SYSTEM from '~/constants/system.constant'
import { CacheService } from '~/processors/redis/cache.service'
import { getNestExecutionContextRequest } from '~/transformers/get-req.transformer'

/**
 * @class HttpCacheInterceptor
 * @classdesc 弥补框架不支持单独定义 ttl 参数以及单请求应用的缺陷
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger: Logger
  constructor(
    private readonly cacheManager: CacheService,
    @Inject(SYSTEM.REFLECTOR) private readonly reflector: Reflector,

    private readonly httpAdapterHost: HttpAdapterHost,
  ) {
    this.logger = new Logger(HttpCacheInterceptor.name)
  }

  // 自定义装饰器，修饰 ttl 参数
  async intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Promise<Observable<any>> {
    // 如果想彻底禁用缓存服务，则直接返回 -> return call$;
    const call$ = next.handle()

    if (REDIS.disableApiCache) {
      return call$
    }

    const request = this.getRequest(context)

    // 只有 GET 请求才会缓存
    if (request.method.toLowerCase() !== 'get') {
      return call$
    }

    const handler = context.getHandler()
    const isDisableCache = this.reflector.get(META.HTTP_CACHE_DISABLE, handler)

    if (isDisableCache) {
      return call$
    }
    const key = this.trackBy(context) || `${API_CACHE_PREFIX}${request.url}`

    const metaTTL = this.reflector.get(META.HTTP_CACHE_TTL_METADATA, handler)
    const ttl = metaTTL || REDIS.httpCacheTTL

    try {
      const value = await this.cacheManager.get(key)

      if (value) {
        this.logger.debug(`hit cache:${key}`)
      }
      return value
        ? of(value)
        : call$.pipe(
            tap(
              (response) =>
                response && this.cacheManager.set(key, response, { ttl }),
            ),
          )
    } catch (error) {
      console.error(error)

      return call$
    }
  }

  trackBy(context: ExecutionContext): string | undefined {
    const request = this.getRequest(context)
    const httpServer = this.httpAdapterHost.httpAdapter
    const isHttpApp = request
    const isGetRequest =
      isHttpApp &&
      httpServer.getRequestMethod(request) === RequestMethod[RequestMethod.GET]
    const cacheKey = this.reflector.get(
      META.HTTP_CACHE_KEY_METADATA,
      context.getHandler(),
    )
    const isMatchedCache = isHttpApp && isGetRequest && cacheKey
    return isMatchedCache ? cacheKey : undefined
  }

  get getRequest() {
    return getNestExecutionContextRequest.bind(this)
  }
}
