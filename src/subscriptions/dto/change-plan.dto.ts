import { IsEnum } from 'class-validator';
import { PlanCode } from '../../plans/plan.constants';

export class ChangePlanDto {
  @IsEnum(PlanCode)
  planCode: PlanCode;
}
