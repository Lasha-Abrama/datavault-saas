import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { Role } from '../enums/roles.enum';
import { PlanCode } from '../plans/plan.constants';
import { PlansService } from '../plans/plans.service';
import { User } from '../users/entities/user.entity';
import {
  EmployeeInvitation,
  InvitationStatus,
} from '../invitations/entities/employee-invitation.entity';
import { billingPeriod } from './billing-period';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { Subscription } from './entities/subscription.entity';
import { BillingService } from './billing.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel('subscription')
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel('subscriptionPeriod')
    private readonly periodModel: Model<SubscriptionPeriod>,
    @InjectModel('user') private readonly userModel: Model<User>,
    @InjectModel('employeeInvitation')
    private readonly invitationModel: Model<EmployeeInvitation>,
    private readonly plansService: PlansService,
    private readonly billingService: BillingService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async initializeFree(
    companyId: Types.ObjectId,
    session: ClientSession,
    activatedAt = new Date(),
  ) {
    const [subscription] = await this.subscriptionModel.create(
      [
        {
          companyId,
          planCode: PlanCode.FREE,
          activatedAt,
          planChangedAt: activatedAt,
        },
      ],
      { session },
    );
    return subscription;
  }

  async getCurrent(companyId: string, at = new Date()) {
    return this.connection.transaction(
      async (session) => {
        const subscription = await this.getSubscription(companyId, session);
        const plan = this.plansService.findOne(subscription.planCode);
        const period = billingPeriod(subscription.activatedAt, at);
        const usage = await this.periodModel.findOne(
          { companyId, startsAt: period.startsAt },
          null,
          { session },
        );
        const employeeCount = await this.userModel.countDocuments(
          {
            companyId,
            role: Role.COMPANY_MEMBER,
          },
          { session },
        );
        const billingSummary = this.billingService.calculate(
          subscription,
          usage,
          employeeCount,
          at,
        );

        return {
          companyId: subscription.companyId,
          plan,
          activatedAt: subscription.activatedAt,
          planChangedAt: subscription.planChangedAt,
          billingPeriod: {
            ...period,
            uploadedFiles: usage?.uploadedFiles ?? 0,
            fileOverageCents: usage?.fileOverageCents ?? 0,
          },
          employeeCount,
          monthlyPriceEstimateCents: billingSummary.totalAmountCents,
          billingSummary,
        };
      },
      { readConcern: { level: 'snapshot' } },
    );
  }

  async getCurrentBilling(companyId: string) {
    return (await this.getCurrent(companyId)).billingSummary;
  }

  async changePlan(actor: AuthenticatedUser, planCode: PlanCode) {
    if (actor.role !== Role.COMPANY_OWNER)
      throw new ForbiddenException('Company owner access is required');
    const plan = this.plansService.findOne(planCode);
    const changedAt = new Date();

    await this.connection.transaction(async (session) => {
      const subscription = await this.acquireLock(actor.companyId, session);
      const employeeCount = await this.userModel.countDocuments(
        { companyId: actor.companyId, role: Role.COMPANY_MEMBER },
        { session },
      );
      const pendingInvitationCount = await this.invitationModel.countDocuments(
        {
          companyId: actor.companyId,
          status: InvitationStatus.PENDING,
          expiresAt: { $gt: changedAt },
        },
        { session },
      );
      if (
        plan.maxEmployees !== null &&
        employeeCount + pendingInvitationCount > plan.maxEmployees
      )
        throw new ForbiddenException(
          `The ${plan.name} plan supports at most ${plan.maxEmployees} employees and pending invitations`,
        );
      if (subscription.planCode === planCode) return;

      await this.subscriptionModel.findOneAndUpdate(
        { _id: subscription._id, companyId: actor.companyId },
        { $set: { planCode, planChangedAt: changedAt } },
        { new: true, runValidators: true, session },
      );
    });

    return this.getCurrent(actor.companyId);
  }

  async getSubscription(companyId: string, session?: ClientSession) {
    const subscription = await this.subscriptionModel.findOne(
      { companyId },
      null,
      session ? { session } : undefined,
    );
    if (!subscription)
      throw new NotFoundException('Company subscription not found');
    return subscription;
  }

  async acquireLock(companyId: string, session: ClientSession) {
    const subscription = await this.subscriptionModel.findOneAndUpdate(
      { companyId },
      { $inc: { revision: 1 } },
      { new: true, session },
    );
    if (!subscription)
      throw new NotFoundException('Company subscription not found');
    return subscription;
  }
}
