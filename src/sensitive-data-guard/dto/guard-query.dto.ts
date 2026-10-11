import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
export class GuardQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  after?: number;
}
export class GuardJobsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
  @ApiPropertyOptional({ pattern: '^[a-fA-F0-9]{24}$' })
  @IsOptional()
  @IsMongoId()
  after?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  requestKey?: string;
}
export class GuardEmptyDto {}
