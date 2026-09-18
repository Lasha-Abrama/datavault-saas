import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlansModule } from '../plans/plans.module';
import { userSchema } from '../users/entities/user.entity';
import { employeeInvitationSchema } from '../invitations/entities/employee-invitation.entity';
import { EntitlementsService } from './entitlements.service';
import { subscriptionPeriodSchema } from './entities/subscription-period.entity';
import { subscriptionSchema } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';
import { BillingService } from './billing.service';
import { PaymentsDomainModule } from '../payments/payments-domain.module';

@Module({
  imports: [
    PlansModule,
    PaymentsDomainModule,
    MongooseModule.forFeature([
      { name: 'subscription', schema: subscriptionSchema },
      { name: 'subscriptionPeriod', schema: subscriptionPeriodSchema },
      { name: 'user', schema: userSchema },
      { name: 'employeeInvitation', schema: employeeInvitationSchema },
    ]),
  ],
  providers: [BillingService, SubscriptionsService, EntitlementsService],
  exports: [SubscriptionsService, EntitlementsService],
})
export class SubscriptionsDomainModule {}
