import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { IsValidMongoDBId } from '../users/dto/is-valid-objectID.dto';
import { GuardService } from './guard.service';
import { jobSchema, findingsSchema } from './guard.openapi';
import { GuardScanDto } from './dto/guard-scan.dto';
import {
  GuardEmptyDto,
  GuardJobsQueryDto,
  GuardQueryDto,
} from './dto/guard-query.dto';
@Controller()
@UseGuards(IsAuthGuard)
@ApiTags('Sensitive Data Guard')
@ApiBearerAuth('tenant-jwt')
export class GuardController {
  constructor(private readonly service: GuardService) {}
  @Post('files/:id/guard/scans')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Enqueue a deterministic, scan-only XLSX inspection',
  })
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() { id }: IsValidMongoDBId,
    @Body() dto: GuardScanDto,
    @Query() query: GuardEmptyDto,
  ) {
    void query;
    return this.service.submit(actor, id, dto);
  }
  @ApiOperation({
    summary: 'List your authorized scan jobs or recover a request UUID',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        jobs: { type: 'array', items: jobSchema },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  @Get('files/:id/guard/jobs')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() { id }: IsValidMongoDBId,
    @Query() query: GuardJobsQueryDto,
  ) {
    return this.service.list(actor, id, query);
  }
  @ApiOperation({ summary: 'Read your scan state without workbook content' })
  @ApiResponse({ status: 200, schema: jobSchema })
  @Get('guard/jobs/:id')
  @Header('Cache-Control', 'private, no-store')
  status(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() { id }: IsValidMongoDBId,
    @Query() _query: GuardEmptyDto,
  ) {
    void _query;
    return this.service.status(actor, id);
  }
  @ApiOperation({
    summary: 'Page through completed scan locations and evidence codes',
  })
  @ApiResponse({ status: 200, schema: findingsSchema })
  @Get('guard/scans/:id/findings')
  @Header('Cache-Control', 'private, no-store')
  findings(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() { id }: IsValidMongoDBId,
    @Query() query: GuardQueryDto,
  ) {
    return this.service.listFindings(actor, id, query);
  }
  @ApiOperation({
    summary: 'Cancel an active scan; completed scans are unchanged',
  })
  @ApiResponse({ status: 200, schema: jobSchema })
  @Post('guard/jobs/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() { id }: IsValidMongoDBId,
    @Body() _body: GuardEmptyDto,
    @Query() _query: GuardEmptyDto,
  ) {
    void _body;
    void _query;
    return this.service.cancel(actor, id);
  }
}
