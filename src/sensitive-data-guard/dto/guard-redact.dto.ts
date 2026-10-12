import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CATEGORIES, Category } from '../guard.constants';
export class GuardColumnDto {
  @ApiProperty({ minimum: 0, maximum: 19 })
  @IsInt()
  @Min(0)
  @Max(19)
  sheetIndex: number;
  @ApiProperty({ minimum: 1, maximum: 512 })
  @IsInt()
  @Min(1)
  @Max(512)
  column: number;
  @ApiProperty({ description: 'Whether row 1 is redacted; no header guessing' })
  @IsBoolean()
  includeHeader: boolean;
}
export class GuardRedactDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') requestKey: string;
  @ApiPropertyOptional({ type: [String], enum: CATEGORIES })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(CATEGORIES, { each: true })
  categories: Category[] = [];
  @ApiPropertyOptional({ type: [GuardColumnDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GuardColumnDto)
  columns: GuardColumnDto[] = [];
}
