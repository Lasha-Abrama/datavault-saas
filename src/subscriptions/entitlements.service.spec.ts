import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PLAN_CATALOG, PlanCode } from '../plans/plan.constants';
import { EntitlementsService } from './entitlements.service';
import { EntitlementDenialReason } from './subscription.constants';

describe('EntitlementsService', () => {
  const companyId = 'company-id';
  const activatedAt = new Date('2026-01-20T10:00:00.000Z');
  const session = {};
  const subscriptionsService = {
    getSubscription: jest.fn(),
    acquireLock: jest.fn(),
  };
  const plansService = {
    findOne: jest.fn((code: PlanCode) => PLAN_CATALOG[code]),
  };
  const userModel = { countDocuments: jest.fn() };
  const invitationModel = { countDocuments: jest.fn() };
  const periodModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const connection = {
    transaction: jest.fn((work: (value: object) => unknown) => work(session)),
  };
  const service = new EntitlementsService(
    subscriptionsService as never,
    plansService as never,
    userModel as never,
    invitationModel as never,
    periodModel as never,
    connection as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionsService.getSubscription.mockResolvedValue({
      planCode: PlanCode.FREE,
      activatedAt,
    });
    subscriptionsService.acquireLock.mockResolvedValue({
      planCode: PlanCode.FREE,
      activatedAt,
    });
    userModel.countDocuments.mockResolvedValue(0);
    invitationModel.countDocuments.mockResolvedValue(0);
    periodModel.findOne.mockResolvedValue(null);
    periodModel.findOneAndUpdate.mockResolvedValue({ uploadedFiles: 1 });
  });

  it('reserves Free for the owner and permits no employees', async () => {
    try {
      await service.assertEmployeeCapacity(companyId, session as never);
      throw new Error('Expected employee limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        reason: EntitlementDenialReason.EMPLOYEE_LIMIT_REACHED,
        limit: 0,
      });
    }
  });

  it('permits ten Basic employees and rejects the eleventh', async () => {
    subscriptionsService.acquireLock.mockResolvedValue({
      planCode: PlanCode.BASIC,
      activatedAt,
    });
    userModel.countDocuments.mockResolvedValueOnce(9);
    await expect(
      service.assertEmployeeCapacity(companyId, session as never),
    ).resolves.toBeUndefined();
    userModel.countDocuments.mockResolvedValueOnce(10);
    await expect(
      service.assertEmployeeCapacity(companyId, session as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not impose an employee limit on Premium', async () => {
    subscriptionsService.acquireLock.mockResolvedValue({
      planCode: PlanCode.PREMIUM,
      activatedAt,
    });
    userModel.countDocuments.mockResolvedValue(10000);
    await expect(
      service.assertEmployeeCapacity(companyId, session as never),
    ).resolves.toBeUndefined();
  });

  it('reserves Basic seats for unexpired pending invitations', async () => {
    subscriptionsService.acquireLock.mockResolvedValue({
      planCode: PlanCode.BASIC,
      activatedAt,
    });
    userModel.countDocuments.mockResolvedValue(8);
    invitationModel.countDocuments.mockResolvedValue(2);
    await expect(
      service.assertEmployeeCapacity(companyId, session as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertEmployeeCapacity(companyId, session as never, 0),
    ).resolves.toBeUndefined();
  });

  it('allows the tenth Free file but rejects the eleventh', async () => {
    periodModel.findOne.mockResolvedValue({ uploadedFiles: 9 });
    await expect(
      service.checkFileUpload(
        companyId,
        1,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ allowed: true, remainingIncludedFiles: 1 });
    periodModel.findOne.mockResolvedValue({ uploadedFiles: 10 });
    await expect(
      service.checkFileUpload(
        companyId,
        1,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: EntitlementDenialReason.FILE_LIMIT_REACHED,
    });
  });

  it('enforces the Basic 100-file hard limit', async () => {
    subscriptionsService.getSubscription.mockResolvedValue({
      planCode: PlanCode.BASIC,
      activatedAt,
    });
    periodModel.findOne.mockResolvedValueOnce({ uploadedFiles: 99 });
    await expect(
      service.checkFileUpload(
        companyId,
        1,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ allowed: true });
    periodModel.findOne.mockResolvedValueOnce({ uploadedFiles: 100 });
    await expect(
      service.checkFileUpload(
        companyId,
        1,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      allowed: false,
      includedFilesPerMonth: 100,
    });
  });

  it('quotes only the incremental Premium overage for a request', async () => {
    subscriptionsService.getSubscription.mockResolvedValue({
      planCode: PlanCode.PREMIUM,
      activatedAt,
    });
    periodModel.findOne.mockResolvedValue({ uploadedFiles: 1001 });
    await expect(
      service.checkFileUpload(
        companyId,
        2,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      additionalChargeCents: 100,
    });
  });

  it('atomically records Premium usage and overage', async () => {
    subscriptionsService.acquireLock.mockResolvedValue({
      planCode: PlanCode.PREMIUM,
      activatedAt,
    });
    periodModel.findOne.mockResolvedValue({ uploadedFiles: 999 });
    await service.recordFileUploads(
      companyId,
      3,
      new Date('2026-01-21T00:00:00.000Z'),
    );
    expect(periodModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        companyId,
        startsAt: new Date('2026-01-20T10:00:00.000Z'),
      },
      expect.objectContaining({
        $inc: { uploadedFiles: 3, fileOverageCents: 100 },
      }),
      expect.objectContaining({ upsert: true, session }),
    );
  });

  it('rejects hard-limit usage without updating the counter', async () => {
    periodModel.findOne.mockResolvedValue({ uploadedFiles: 10 });
    await expect(
      service.recordFileUploads(
        companyId,
        1,
        new Date('2026-01-21T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(periodModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid file quantities', async () => {
    await expect(service.checkFileUpload(companyId, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.recordFileUploads(companyId, 1.5),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
