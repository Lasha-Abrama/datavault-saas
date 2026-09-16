import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { Role } from '../enums/roles.enum';

describe('AuthService company onboarding', () => {
  const companyId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  let ownerInput: Record<string, unknown> | undefined;
  const companyModel = { create: jest.fn() };
  const userModel = {
    create: jest.fn((value: unknown) => {
      ownerInput = (value as Record<string, unknown>[])[0];
      return Promise.resolve([
        { _id: userId, companyId, role: Role.COMPANY_OWNER },
      ]);
    }),
    findOne: jest.fn(),
  };
  const connection = {
    transaction: jest.fn<
      Promise<unknown>,
      [(session: object) => Promise<unknown>]
    >((work) => work({})),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const subscriptionsService = { initializeFree: jest.fn() };
  const service = new AuthService(
    userModel as never,
    companyModel as never,
    connection as never,
    jwt as never,
    subscriptionsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates one company and its owner in the same transaction', async () => {
    companyModel.create.mockResolvedValue([{ _id: companyId, name: 'Acme' }]);
    await expect(
      service.signUp({
        companyName: 'Acme',
        fullName: 'Owner',
        email: 'owner@example.com',
        password: 'password',
      }),
    ).resolves.toEqual({ accessToken: 'token' });
    expect(connection.transaction).toHaveBeenCalledTimes(1);
    expect(ownerInput).toMatchObject({
      companyId,
      role: Role.COMPANY_OWNER,
    });
    expect(subscriptionsService.initializeFree).toHaveBeenCalledWith(
      companyId,
      expect.any(Object),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({ id: userId.toString() });
  });

  it('reports duplicate company names without leaving a user', async () => {
    connection.transaction.mockRejectedValueOnce({
      code: 11000,
      keyPattern: { name: 1 },
    });
    await expect(
      service.signUp({
        companyName: 'Acme',
        fullName: 'Owner',
        email: 'owner@example.com',
        password: 'password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports duplicate owner emails and rolls back onboarding', async () => {
    connection.transaction.mockRejectedValueOnce({
      code: 11000,
      keyPattern: { email: 1 },
    });
    await expect(
      service.signUp({
        companyName: 'Another Company',
        fullName: 'Owner',
        email: 'existing@example.com',
        password: 'password',
      }),
    ).rejects.toThrow('Email is already in use');
  });

  it('does not create tenantless users during Google sign-in', async () => {
    userModel.findOne.mockResolvedValue(null);
    await expect(
      service.signInWithGoogle({
        email: 'unknown@example.com',
        fullName: 'Unknown',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userModel.create).not.toHaveBeenCalled();
  });
});
