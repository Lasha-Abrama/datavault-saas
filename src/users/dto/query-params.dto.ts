import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class QueryParams {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  take: number = 30;
}
