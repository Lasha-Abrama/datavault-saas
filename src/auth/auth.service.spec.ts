import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { Role } from '../enums/roles.enum';

const registration = {
  companyName: 'Acme',
  email: 'owner@example.com',
  password: 'password',
  country: 'GE',
  industry: 'Technology',
};

describe('AuthService company onboarding', () => {
  const companyId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const session = {};
  const companyModel = { create: jest.fn(), findOne: jest.fn() };
  const userModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
  };
  const connection = {
    transaction: jest.fn((work: (value: object) => unknown) => work(session)),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const subscriptions = { initializeFree: jest.fn() };
  const delivery = {
    email: registration.email,
    companyName: 'Acme',
    token: 'raw-token',
  };
  const verification = {
    createForRegistration: jest.fn(),
    sendActivationEmail: jest.fn(),
  };
  const service = new AuthService(
    userModel as never,
    companyModel as never,
    connection as never,
    jwt as never,
    subscriptions as never,
    verification as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    companyModel.create.mockResolvedValue([{ _id: companyId, name: 'Acme' }]);
    userModel.create.mockResolvedValue([
      {
        _id: userId,
        companyId,
        role: Role.COMPANY_OWNER,
        email: registration.email,
      },
    ]);
    verification.createForRegistration.mockResolvedValue(delivery);
    verification.sendActivationEmail.mockResolvedValue(undefined);
    companyModel.findOne.mockResolvedValue({
      _id: companyId,
      activatedAt: new Date(),
    });
  });

  it('atomically creates a pending company, owner, Free subscription and token without a JWT', async () => {
    await expect(service.signUp(registration)).resolves.toEqual({
      message: 'Company registered. Check your email to activate the account.',
    });
    expect(companyModel.create).toHaveBeenCalledWith(
      [
        {
          name: 'Acme',
          country: 'GE',
          industry: 'Technology',
          activatedAt: null,
        },
      ],
      { session },
    );
    expect(subscriptions.initializeFree).toHaveBeenCalledWith(
      companyId,
      session,
    );
    expect(verification.createForRegistration).toHaveBeenCalledWith(
      companyId,
      userId,
      registration.email,
      'Acme',
      session,
    );
    expect(verification.sendActivationEmail).toHaveBeenCalledWith(delivery);
    expect(
      verification.sendActivationEmail.mock.invocationCallOrder[0],
    ).toBeGreaterThan(connection.transaction.mock.invocationCallOrder[0]);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['name', 'Company name is already in use'],
    ['email', 'Email is already in use'],
  ])(
    'reports a duplicate %s and never sends an activation email',
    async (field, message) => {
      connection.transaction.mockRejectedValueOnce({
        code: 11000,
        keyPattern: { [field]: 1 },
      } as never);
      await expect(service.signUp(registration)).rejects.toThrow(message);
      expect(verification.sendActivationEmail).not.toHaveBeenCalled();
    },
  );

  it('keeps a committed registration recoverable when email delivery fails', async () => {
    verification.sendActivationEmail.mockRejectedValueOnce(
      new Error('SMTP unavailable'),
    );
    await expect(service.signUp(registration)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(subscriptions.initializeFree).toHaveBeenCalledTimes(1);
    expect(verification.createForRegistration).toHaveBeenCalledTimes(1);
  });

  it('rejects password sign-in before activation even with valid credentials', async () => {
    const user = {
      _id: userId,
      companyId,
      role: Role.COMPANY_OWNER,
      password: await bcrypt.hash('password', 10),
    };
    userModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
    companyModel.findOne.mockResolvedValue(null);
    await expect(service.signIn(registration)).rejects.toThrow(
      'Account is not activated',
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('issues a token after activation and still verifies the password', async () => {
    userModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: userId,
        companyId,
        role: Role.COMPANY_OWNER,
        password: await bcrypt.hash('password', 10),
      }),
    });
    await expect(service.signIn(registration)).resolves.toEqual({
      accessToken: 'token',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ id: userId.toString() });
    await expect(
      service.signIn({ email: registration.email, password: 'incorrect' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('does not let Google bypass activation or modify an inactive account', async () => {
    const user = {
      _id: userId,
      companyId,
      role: Role.COMPANY_OWNER,
      save: jest.fn(),
    };
    userModel.findOne.mockResolvedValue(user);
    companyModel.findOne.mockResolvedValue(null);
    await expect(
      service.signInWithGoogle({
        email: registration.email,
        fullName: 'Owner',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.save).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('allows existing activated accounts to sign in with Google', async () => {
    const user = {
      _id: userId,
      companyId,
      role: Role.COMPANY_OWNER,
      save: jest.fn(),
    };
    userModel.findOne.mockResolvedValue(user);
    await expect(
      service.signInWithGoogle({
        email: registration.email,
        fullName: 'Owner',
      }),
    ).resolves.toBe('token');
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('reloads user and company before exchanging a Google code, blocking deactivation or suspension', async () => {
    const user = { _id: userId, companyId, role: Role.COMPANY_OWNER };
    userModel.findById.mockResolvedValue(user);
    companyModel.findOne.mockResolvedValueOnce(null);
    await expect(service.exchangeGoogleUser(userId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
    companyModel.findOne.mockResolvedValueOnce({
      _id: companyId,
      activatedAt: new Date(),
      platformStatus: 'suspended',
    });
    await expect(service.exchangeGoogleUser(userId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
    userModel.findById.mockResolvedValueOnce(null);
    await expect(service.exchangeGoogleUser(userId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
    companyModel.findOne.mockResolvedValueOnce({
      _id: companyId,
      activatedAt: new Date(),
    });
    await expect(service.exchangeGoogleUser(userId)).resolves.toEqual({
      accessToken: 'token',
    });
  });
});
