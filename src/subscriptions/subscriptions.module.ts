import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsDomainModule } from './subscriptions-domain.module';

@Module({
  imports: [AuthModule, SubscriptionsDomainModule],
  controllers: [SubscriptionsController],
})
export class SubscriptionsModule {}
