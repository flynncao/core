import { FastifyReply, FastifyRequest } from 'fastify'

import { CacheTTL } from '@nestjs/cache-manager'
import {
  All,
  BadRequestException,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Request,
  Response,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { HTTPDecorators } from '~/common/decorators/http.decorator'
import { IsMaster } from '~/common/decorators/role.decorator'
import { AssetService } from '~/processors/helper/helper.asset.service'

import { SnippetType } from '../snippet/snippet.model'
import { createMockedContextResponse } from './mock-response.util'
import { ServerlessReferenceDto } from './serverless.dto'
import { ServerlessService } from './serverless.service'

@ApiController(['serverless', 'fn'])
export class ServerlessController {
  constructor(
    private readonly serverlessService: ServerlessService,
    private readonly assetService: AssetService,
  ) {}

  @Get('/types')
  @Auth()
  @HTTPDecorators.Bypass
  @CacheTTL(60 * 60 * 24)
  async getCodeDefined() {
    try {
      const text = await this.assetService.getAsset('/types/type.declare.ts', {
        encoding: 'utf-8',
      })

      return text
    } catch (e) {
      throw new InternalServerErrorException('code defined file not found')
    }
  }
  @All('/:reference/:name/*')
  @Throttle(100, 5)
  @HTTPDecorators.Bypass
  async runServerlessFunctionWildcard(
    @Param() param: ServerlessReferenceDto,
    @IsMaster() isMaster: boolean,

    @Request() req: FastifyRequest,
    @Response() reply: FastifyReply,
  ) {
    return this.runServerlessFunction(param, isMaster, req, reply)
  }

  @All('/:reference/:name')
  @Throttle(100, 5)
  @HTTPDecorators.Bypass
  async runServerlessFunction(
    @Param() param: ServerlessReferenceDto,
    @IsMaster() isMaster: boolean,

    @Request() req: FastifyRequest,
    @Response() reply: FastifyReply,
  ) {
    const requestMethod = req.method.toUpperCase()
    const { name, reference } = param
    const snippet = await this.serverlessService.model
      .findOne({
        name,
        reference,
        type: SnippetType.Function,
        method: requestMethod,
      })
      .select('+secret')
      .lean({
        getters: true,
      })

    const notExistMessage = 'serverless function is not exist or not enabled'

    if (!snippet) {
      throw new NotFoundException(notExistMessage)
    }

    if (snippet.method !== requestMethod || !snippet.enable) {
      throw new NotFoundException(notExistMessage)
    }

    if (snippet.private && !isMaster) {
      throw new ForbiddenException('no permission to run this function')
    }

    const result =
      await this.serverlessService.injectContextIntoServerlessFunctionAndCall(
        snippet,
        { req, res: createMockedContextResponse(reply) },
      )

    if (!reply.sent) {
      return reply.send(result)
    }
  }

  /**
   * 重置内建函数，过期的内建函数会被删除
   */
  @Delete('/reset/:id')
  @Auth()
  async resetBuiltInFunction(@Param('id') id: string) {
    const builtIn = await this.serverlessService.isBuiltInFunction(id)
    if (!builtIn) {
      // throw new BadRequestException('can not reset a non-builtin function')
      const snippet = await this.serverlessService.model.findById(id)
      if (!snippet) {
        throw new BadRequestException('function not found')
      }
      await this.serverlessService.model.deleteOne({
        _id: id,
      })
      return
    }
    await this.serverlessService.resetBuiltInFunction(builtIn)

    return
  }
}
