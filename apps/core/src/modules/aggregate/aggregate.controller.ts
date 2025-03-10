import { omit } from 'lodash'

import { CacheKey, CacheTTL } from '@nestjs/cache-manager'
import { Get, Query } from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { IsMaster } from '~/common/decorators/role.decorator'
import { CacheKeys } from '~/constants/cache.constant'

import { AnalyzeService } from '../analyze/analyze.service'
import { ConfigsService } from '../configs/configs.service'
import { NoteService } from '../note/note.service'
import { SnippetService } from '../snippet/snippet.service'
import {
  AggregateQueryDto,
  TimelineQueryDto,
  TopQueryDto,
} from './aggregate.dto'
import { AggregateService } from './aggregate.service'

@ApiController('aggregate')
export class AggregateController {
  constructor(
    private readonly aggregateService: AggregateService,
    private readonly configsService: ConfigsService,
    private readonly analyzeService: AnalyzeService,
    private readonly noteService: NoteService,
    private readonly snippetService: SnippetService,
  ) {}

  @Get('/')
  @CacheTTL(10 * 60)
  async aggregate(@Query() query: AggregateQueryDto) {
    const { theme } = query

    const tasks = await Promise.allSettled([
      this.configsService.getMaster(),
      this.aggregateService.getAllCategory(),
      this.aggregateService.getAllPages(),
      this.configsService.get('url'),
      this.configsService.get('seo'),
      this.noteService.getLatestNoteId(),
      !theme
        ? Promise.resolve()
        : this.snippetService
            .getCachedSnippet('theme', theme, 'public')
            .then((cached) => {
              if (cached) {
                return JSON.safeParse(cached) || cached
              }
              return this.snippetService.getPublicSnippetByName(theme, 'theme')
            }),
    ])
    const [user, categories, pageMeta, url, seo, latestNodeId, themeConfig] =
      tasks.map((t) => {
        if (t.status === 'fulfilled') {
          return t.value
        } else {
          return null
        }
      })
    return {
      user,
      seo,
      url: omit(url, ['adminUrl']),
      categories,
      pageMeta,
      latestNodeId,
      theme: themeConfig,
    }
  }

  @Get('/top')
  async top(@Query() query: TopQueryDto, @IsMaster() isMaster: boolean) {
    const { size } = query
    return await this.aggregateService.topActivity(size, isMaster)
  }

  @Get('/timeline')
  async getTimeline(@Query() query: TimelineQueryDto) {
    const { sort = 1, type, year } = query
    return { data: await this.aggregateService.getTimeline(year, type, sort) }
  }

  @Get('/sitemap')
  @CacheKey(CacheKeys.SiteMapCatch)
  @CacheTTL(3600)
  async getSiteMapContent() {
    return { data: await this.aggregateService.getSiteMapContent() }
  }

  @Get('/feed')
  @CacheKey(CacheKeys.RSS)
  @CacheTTL(3600)
  async getRSSFeed() {
    return await this.aggregateService.buildRssStructure()
  }

  @Get('/stat')
  @Auth()
  async stat() {
    const [count, callTime, todayIpAccess] = await Promise.all([
      this.aggregateService.getCounts(),
      this.analyzeService.getCallTime(),
      this.analyzeService.getTodayAccessIp(),
    ])
    return {
      ...count,
      ...callTime,
      todayIpAccessCount: todayIpAccess.length,
    }
  }
}
