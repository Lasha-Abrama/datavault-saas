import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Role } from '../enums/roles.enum';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { UsersService } from './users.service';

function paginatedQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(value),
  };
}

describe('UsersService tenant boundaries', () => {
  const companyId = new Types.ObjectId().toString();
  const otherCompanyId = new Types.ObjectId().toString();
  const ownerId = new Types.ObjectId().toString();
  const memberId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();
  const owner: AuthenticatedUser = {
    id: ownerId,
    companyId,
    role: Role.COMPANY_OWNER,
  };
  const member: AuthenticatedUser = {
    id: memberId,
    companyId,
    role: Role.COMPANY_MEMBER,
  };
  const memberDocument = {
    _id: new Types.ObjectId(memberId),
    companyId: new Types.ObjectId(companyId),
    role: Role.COMPANY_MEMBER,
  };
  let createdInput: Record<string, unknown> | undefined;
  let updatedInput: { password: string } | undefined;
  const model = {
    create: jest.fn((value: unknown) => {
      createdInput = value as Record<string, unknown>;
      return Promise.resolve(value);
    }),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn((...args: unknown[]) => {
      updatedInput = args[1] as { password: string };
      return Promise.resolve(memberDocument);
    }),
    findOneAndDelete: jest.fn(),
  };
  const service = new UsersService(model as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates members only inside the owner company', async () => {
    await service.createMember(owner, {
      fullName: 'Member',
      email: 'member@example.com',
      password: 'password',
    });
    expect(createdInput).toMatchObject({
      companyId,
      role: Role.COMPANY_MEMBER,
      email: 'member@example.com',
    });
    expect(createdInput?.password).not.toBe('password');
  });

  it('rejects member creation by another member', async () => {
    await expect(
      service.createMember(member, {
        fullName: 'Member',
        email: 'member@example.com',
        password: 'password',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('maps duplicate member emails to a conflict', async () => {
    model.create.mockRejectedValue({ code: 11000, keyPattern: { email: 1 } });
    await expect(
      service.createMember(owner, {
        fullName: 'Member',
        email: 'member@example.com',
        password: 'password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes lists and counts to the authenticated company', async () => {
    const query = paginatedQuery([memberDocument]);
    model.find.mockReturnValue(query);
    model.countDocuments.mockResolvedValue(1);
    await expect(
      service.findAll(owner, { page: 2, take: 10 }),
    ).resolves.toMatchObject({
      total: 1,
      page: 2,
      take: 10,
    });
    expect(model.find).toHaveBeenCalledWith({ companyId });
    expect(model.countDocuments).toHaveBeenCalledWith({ companyId });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  it('returns not found when an owner targets a user outside the company', async () => {
    model.findOne.mockResolvedValue(null);
    await expect(service.findOne(owner, otherUserId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model.findOne).toHaveBeenCalledWith({
      _id: otherUserId,
      companyId,
    });
    expect(otherCompanyId).not.toBe(companyId);
  });

  it('cannot update a user outside the owner company', async () => {
    model.findOne.mockResolvedValue(null);
    await expect(
      service.updateUser(owner, otherUserId, { fullName: 'Changed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('prevents a member from reading another user', async () => {
    await expect(service.findOne(member, otherUserId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('hashes passwords while updating a tenant user', async () => {
    model.findOne.mockResolvedValue(memberDocument);
    await service.updateUser(owner, memberId, { password: 'new-password' });
    expect(updatedInput).toBeDefined();
    expect(await bcrypt.compare('new-password', updatedInput!.password)).toBe(
      true,
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: memberId, companyId },
      updatedInput,
      { new: true, runValidators: true },
    );
  });

  it('does not allow the company owner to be deleted', async () => {
    model.findOne.mockResolvedValue({
      ...memberDocument,
      role: Role.COMPANY_OWNER,
    });
    await expect(service.deleteUser(owner, ownerId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(model.findOneAndDelete).not.toHaveBeenCalled();
  });
});
