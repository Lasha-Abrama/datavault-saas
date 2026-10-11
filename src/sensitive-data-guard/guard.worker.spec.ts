import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GuardWorker } from './guard.worker';
import { GuardService } from './guard.service';
import { GuardRunner } from './guard.runner';
import { FilesService } from '../files/files.service';
import {
  DEFAULT_LIMITS,
  DEFAULT_RUNTIME_POLICY,
  GUARD_LIMITS,
  GUARD_RUNTIME_POLICY,
} from './guard.constants';
import { guardJobSchema } from './entities/guard-job.entity';
import { guardFindingSchema } from './entities/guard-finding.entity';
import { guardEventSchema } from './entities/guard-event.entity';

describe('Guard startup safety', () => {
  const persistence = () => ({
    createCollection: jest.fn().mockResolvedValue(undefined),
    createIndexes: jest.fn().mockResolvedValue(undefined),
    findOneAndUpdate: jest.fn(),
  });
  afterEach(() => jest.restoreAllMocks());

  it('disables automatic database creation even when the connection enables it', () => {
    for (const schema of [
      guardJobSchema,
      guardFindingSchema,
      guardEventSchema,
    ]) {
      expect(schema.get('autoCreate')).toBe(false);
      expect(schema.get('autoIndex')).toBe(false);
    }
  });

  it('does no persistence, polling, storage or child work with production defaults', async () => {
    const service = {
      jobs: persistence(),
      findings: persistence(),
      events: persistence(),
    };
    const files = { download: jest.fn() };
    const runner = { run: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        GuardWorker,
        { provide: GuardService, useValue: service },
        { provide: FilesService, useValue: files },
        { provide: GuardRunner, useValue: runner },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'production' }),
        },
        { provide: GUARD_LIMITS, useValue: DEFAULT_LIMITS },
        { provide: GUARD_RUNTIME_POLICY, useValue: DEFAULT_RUNTIME_POLICY },
      ],
    }).compile();
    const interval = jest.spyOn(global, 'setInterval');
    const worker = module.get(GuardWorker);
    await worker.onApplicationBootstrap();
    await worker.tick();
    await module.close();
    expect(interval).not.toHaveBeenCalled();
    for (const model of Object.values(service)) {
      expect(model.createCollection).not.toHaveBeenCalled();
      expect(model.createIndexes).not.toHaveBeenCalled();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    }
    expect(files.download).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails closed before polling when approved-runtime index initialization fails', async () => {
    const jobs = persistence();
    jobs.createIndexes.mockRejectedValue(new Error('synthetic index failure'));
    const worker = new GuardWorker(
      {
        jobs,
        findings: persistence(),
        events: persistence(),
      } as unknown as GuardService,
      {} as FilesService,
      {} as GuardRunner,
      new ConfigService({ NODE_ENV: 'production' }),
      DEFAULT_LIMITS,
      { isolationApproved: true },
    );
    const interval = jest.spyOn(global, 'setInterval');
    await expect(worker.onApplicationBootstrap()).rejects.toThrow(
      'synthetic index failure',
    );
    expect(jobs.createCollection).toHaveBeenCalledTimes(1);
    expect(interval).not.toHaveBeenCalled();
    expect(jobs.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
