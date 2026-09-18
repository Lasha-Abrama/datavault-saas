import { IsIn } from 'class-validator';
import { PlanCode } from '../../plans/plan.constants';

export class CheckoutDto {
  @IsIn([PlanCode.BASIC, PlanCode.PREMIUM])
  planCode: PlanCode.BASIC | PlanCode.PREMIUM;
}

export class PaymentPlanDto {
  @IsIn(Object.values(PlanCode))
  planCode: PlanCode;
}

export class EmptyPaymentDto {}
