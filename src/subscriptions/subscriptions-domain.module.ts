import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlansModule } from '../plans/plans.module';
import { userSchema } from '../users/entities/user.entity';
import { EntitlementsService } from './entitlements.service';
import { subscriptionPeriodSchema } from './entities/subscription-period.entity';
import { subscriptionSchema } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    PlansModule,
    MongooseModule.forFeature([
      { name: 'subscription', schema: subscriptionSchema },
      { name: 'subscriptionPeriod', schema: subscriptionPeriodSchema },
      { name: 'user', schema: userSchema },
    ]),
  ],
  providers: [SubscriptionsService, EntitlementsService],
  exports: [SubscriptionsService, EntitlementsService],
})
export class SubscriptionsDomainModule {}
