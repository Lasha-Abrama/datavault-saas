import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO31661Alpha2,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CATEGORIES, Category } from '../guard.constants';
export class GuardScanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  requestKey: string;
  @ApiProperty({ type: [String], enum: CATEGORIES, minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(CATEGORIES, { each: true })
  categories: Category[];
  @ApiPropertyOptional({
    description:
      'Explicit ISO country for national phone text; no tenant country inference',
    pattern: '^[A-Z]{2}$',
  })
  @IsOptional()
  @IsISO31661Alpha2()
  phoneRegion?: string;
}
