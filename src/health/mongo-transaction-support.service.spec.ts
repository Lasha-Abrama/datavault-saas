import { ConfigService } from '@nestjs/config';
import { MongoTransactionSupportService } from './mongo-transaction-support.service';

describe('MongoTransactionSupportService', () => {
  function service(response: object | Error, nodeEnv = 'production') {
    const command =
      response instanceof Error
        ? jest.fn().mockRejectedValue(response)
        : jest.fn().mockResolvedValue(response);
    return {
      command,
      support: new MongoTransactionSupportService(
        { db: { admin: () => ({ command }) } } as never,
        new ConfigService({ NODE_ENV: nodeEnv }),
      ),
    };
  }

  it.each([
    {
      name: 'replica set',
      hello: { logicalSessionTimeoutMinutes: 30, setName: 'atlas-set' },
    },
    {
      name: 'sharded cluster',
      hello: { logicalSessionTimeoutMinutes: 30, msg: 'isdbgrid' },
    },
  ])('accepts a transaction-capable $name', async ({ hello }) => {
    const { support } = service(hello);
    await expect(support.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails startup clearly for standalone MongoDB', async () => {
    const { support } = service({ logicalSessionTimeoutMinutes: 30 });
    await expect(support.onApplicationBootstrap()).rejects.toThrow(
      'replica set or sharded cluster',
    );
  });

  it('does not expose driver details when the capability command fails', async () => {
    const { support } = service(new Error('mongodb://user:password@host'));
    await expect(support.onApplicationBootstrap()).rejects.toThrow(
      'MongoDB transaction capability check failed',
    );
  });

  it('skips the infrastructure capability command in isolated tests', async () => {
    const { support, command } = service({}, 'test');
    await expect(support.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(command).not.toHaveBeenCalled();
  });
});
