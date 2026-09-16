import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { Role } from '../enums/roles.enum';
import { PlansService } from '../plans/plans.service';
import { User } from '../users/entities/user.entity';
import {
  EmployeeInvitation,
  InvitationStatus,
} from '../invitations/entities/employee-invitation.entity';
import { billingPeriod } from './billing-period';
import { EntitlementDenialReason } from './subscription.constants';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly plansService: PlansService,
    @InjectModel('user') private readonly userModel: Model<User>,
    @InjectModel('employeeInvitation')
    private readonly invitationModel: Model<EmployeeInvitation>,
    @InjectModel('subscriptionPeriod')
    private readonly periodModel: Model<SubscriptionPeriod>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async assertEmployeeCapacity(
    companyId: string,
    session: ClientSession,
    additionalSeats = 1,
    at = new Date(),
  ) {
    if (!Number.isSafeInteger(additionalSeats) || additionalSeats < 0)
      throw new BadRequestException(
        'Additional employee seats must be a non-negative integer',
      );
    const subscription = await this.subscriptionsService.acquireLock(
      companyId,
      session,
    );
    const plan = this.plansService.findOne(subscription.planCode);
    if (plan.maxEmployees === null) return;
    const [employeeCount, pendingInvitationCount] = await Promise.all([
      this.userModel.countDocuments(
        { companyId, role: Role.COMPANY_MEMBER },
        { session },
      ),
      this.invitationModel.countDocuments(
        {
          companyId,
          status: InvitationStatus.PENDING,
          expiresAt: { $gt: at },
        },
        { session },
      ),
    ]);
    if (
      employeeCount + pendingInvitationCount + additionalSeats >
      plan.maxEmployees
    )
      throw new ForbiddenException({
        message: `The ${plan.name} plan employee limit has been reached`,
        reason: EntitlementDenialReason.EMPLOYEE_LIMIT_REACHED,
        limit: plan.maxEmployees,
        employees: employeeCount,
        pendingInvitations: pendingInvitationCount,
      });
  }

  async checkFileUpload(companyId: string, quantity = 1, at = new Date()) {
    this.validateQuantity(quantity);
    const subscription =
      await this.subscriptionsService.getSubscription(companyId);
    const plan = this.plansService.findOne(subscription.planCode);
    const period = billingPeriod(subscription.activatedAt, at);
    const usage = await this.periodModel.findOne({
      companyId,
      startsAt: period.startsAt,
    });
    const uploadedFiles = usage?.uploadedFiles ?? 0;
    const resultingFiles = uploadedFiles + quantity;
    const excessFiles = Math.max(
      0,
      resultingFiles - plan.includedFilesPerMonth,
    );
    const existingExcessFiles = Math.max(
      0,
      uploadedFiles - plan.includedFilesPerMonth,
    );
    const allowed = plan.extraFilePriceCents !== null || excessFiles === 0;

    return {
      allowed,
      reason: allowed ? null : EntitlementDenialReason.FILE_LIMIT_REACHED,
      planCode: plan.code,
      uploadedFiles,
      requestedFiles: quantity,
      includedFilesPerMonth: plan.includedFilesPerMonth,
      remainingIncludedFiles: Math.max(
        0,
        plan.includedFilesPerMonth - uploadedFiles,
      ),
      additionalChargeCents:
        (excessFiles - existingExcessFiles) * (plan.extraFilePriceCents ?? 0),
      billingPeriod: period,
    };
  }

  async recordFileUploads(
    companyId: string,
    quantity = 1,
    at = new Date(),
    session?: ClientSession,
  ) {
    this.validateQuantity(quantity);
    if (session)
      return this.recordFileUploadsInTransaction(
        companyId,
        quantity,
        at,
        session,
      );
    return this.connection.transaction((transactionSession) =>
      this.recordFileUploadsInTransaction(
        companyId,
        quantity,
        at,
        transactionSession,
      ),
    );
  }

  private async recordFileUploadsInTransaction(
    companyId: string,
    quantity: number,
    at: Date,
    session: ClientSession,
  ) {
    const subscription = await this.subscriptionsService.acquireLock(
      companyId,
      session,
    );
    const plan = this.plansService.findOne(subscription.planCode);
    const period = billingPeriod(subscription.activatedAt, at);
    const usage = await this.periodModel.findOne(
      { companyId, startsAt: period.startsAt },
      null,
      { session },
    );
    const uploadedFiles = usage?.uploadedFiles ?? 0;
    const resultingFiles = uploadedFiles + quantity;
    const priorExcess = Math.max(0, uploadedFiles - plan.includedFilesPerMonth);
    const resultingExcess = Math.max(
      0,
      resultingFiles - plan.includedFilesPerMonth,
    );
    if (plan.extraFilePriceCents === null && resultingExcess > 0)
      throw new ForbiddenException({
        message: `The ${plan.name} monthly file limit has been reached`,
        reason: EntitlementDenialReason.FILE_LIMIT_REACHED,
        limit: plan.includedFilesPerMonth,
      });
    const additionalOverageCents =
      (resultingExcess - priorExcess) * (plan.extraFilePriceCents ?? 0);

    return this.periodModel.findOneAndUpdate(
      { companyId, startsAt: period.startsAt },
      {
        $setOnInsert: { companyId, ...period },
        $inc: {
          uploadedFiles: quantity,
          fileOverageCents: additionalOverageCents,
        },
      },
      { upsert: true, new: true, runValidators: true, session },
    );
  }

  private validateQuantity(quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      throw new BadRequestException('File quantity must be a positive integer');
  }
}
