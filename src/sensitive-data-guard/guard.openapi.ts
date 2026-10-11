import { SchemaObject } from '@nestjs/swagger';
import { CATEGORIES, STATES } from './guard.constants';
export const jobSchema: SchemaObject = {
  type: 'object',
  properties: {
    jobId: { type: 'string' },
    sourceFileId: { type: 'string' },
    requestKey: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: [...STATES] },
    phase: { type: 'string' },
    errorCode: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    engineVersion: { type: 'string' },
    progress: {
      type: 'object',
      properties: {
        processedCells: { type: 'integer' },
        totalCells: { type: 'integer', nullable: true },
      },
    },
    findingCount: { type: 'integer' },
    sheets: { type: 'integer' },
    coverage: { type: 'string', enum: ['pending', 'limited', 'supported'] },
    compatibilityFlags: { type: 'array', items: { type: 'string' } },
    generationEligible: { type: 'boolean', enum: [false] },
  },
};
export const findingsSchema: SchemaObject = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ordinal: { type: 'integer' },
          sheetIndex: { type: 'integer' },
          row: { type: 'integer' },
          column: { type: 'integer' },
          category: { type: 'string', enum: [...CATEGORIES] },
          evidence: {
            type: 'string',
            enum: ['format_valid', 'checksum_valid'],
          },
          hidden: { type: 'boolean' },
        },
      },
    },
    nextCursor: { type: 'integer', nullable: true },
  },
};
