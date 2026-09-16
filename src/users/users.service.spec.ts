import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Role } from '../enums/roles.enum';
import { UsersService } from './users.service';

function query<T>(value: T) {
  return {
    then: (resolve: (result: T) => unknown) =>
      Promise.resolve(value).then(resolve),
  };
}

describe('UsersService', () => {
  const requester = {
    _id: { toString: () => 'requester' },
    role: Role.STUDENT,
  };
  const updated = {
    _id: 'requester',
    email: 'new@example.com',
    role: Role.STUDENT,
  };
  const model = {
    findById: jest.fn(() => query(requester)),
    findByIdAndUpdate: jest.fn((...args: unknown[]) => {
      void args;
      return query(updated);
    }),
  };
  const service = new UsersService(model as never);

  beforeEach(() => jest.clearAllMocks());

  it('hashes a password and allows only DTO fields in an update', async () => {
    await service.updateUser('requester', 'requester', {
      email: 'new@example.com',
      password: 'new-password',
      fullName: 'New Name',
    });
    const update = model.findByIdAndUpdate.mock.calls[0][1] as {
      password: string;
    };
    expect(update.password).not.toBe('new-password');
    expect(await bcrypt.compare('new-password', update.password)).toBe(true);
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('requester', update, {
      new: true,
      runValidators: true,
    });
  });

  it('prevents one non-admin user from changing another', async () => {
    await expect(
      service.updateUser('requester', 'other-user', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
