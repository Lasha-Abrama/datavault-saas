import { fromBuffer, Entry, ZipFile } from 'yauzl';
import { crc32 } from 'node:zlib';
import { GuardLimits, ScanError } from '../guard.constants';

export async function preflight(
  input: Buffer,
  limits: GuardLimits,
): Promise<Map<string, Buffer>> {
  if (input.length > limits.compressedBytes)
    throw new ScanError('guard_limit_exceeded');
  const end = input.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    end < 0 ||
    end + 22 > input.length ||
    input.readUInt16LE(end + 4) ||
    input.readUInt16LE(end + 6) ||
    input.readUInt16LE(end + 8) !== input.readUInt16LE(end + 10) ||
    end + 22 + input.readUInt16LE(end + 20) !== input.length ||
    input.readUInt16LE(end + 10) === 0xffff
  )
    throw new ScanError('guard_invalid_workbook');
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(
      input,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) reject(new ScanError('guard_invalid_workbook'));
        else resolve(archive);
      },
    );
  });
  const result = new Map<string, Buffer>();
  let expanded = 0;
  let count = 0;
  const intervals: [number, number][] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', () => reject(new ScanError('guard_invalid_workbook')));
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = entry.fileName;
          if (
            ++count > limits.entries ||
            entry.uncompressedSize > limits.entryBytes ||
            expanded + entry.uncompressedSize > limits.expandedBytes ||
            entry.uncompressedSize >
              Math.max(entry.compressedSize, 1) * limits.ratio
          )
            throw new ScanError('guard_limit_exceeded');
          if (
            !/^[A-Za-z0-9_\-./[\]]+$/.test(name) ||
            name.split('/').some((p) => p === '.' || p === '..' || p === '') ||
            result.has(name.toLowerCase()) ||
            entry.generalPurposeBitFlag & 0x41 ||
            ![0, 8].includes(entry.compressionMethod) ||
            entry.extraFields.some((f) => f.id === 1) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          )
            throw new ScanError('guard_invalid_workbook');
          const offset = entry.relativeOffsetOfLocalHeader;
          if (
            offset + 30 > input.length ||
            input.readUInt32LE(offset) !== 0x04034b50 ||
            input.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag ||
            input.readUInt16LE(offset + 8) !== entry.compressionMethod
          )
            throw new ScanError('guard_invalid_workbook');
          const nameLength = input.readUInt16LE(offset + 26);
          const dataStart =
            offset + 30 + nameLength + input.readUInt16LE(offset + 28);
          const dataEnd = dataStart + entry.compressedSize;
          if (
            input
              .subarray(offset + 30, offset + 30 + nameLength)
              .toString('utf8') !== name ||
            dataEnd > input.readUInt32LE(end + 16) ||
            intervals.some(([a, b]) => offset < b && dataEnd > a)
          )
            throw new ScanError('guard_invalid_workbook');
          if (
            !(entry.generalPurposeBitFlag & 8) &&
            (input.readUInt32LE(offset + 14) !== entry.crc32 ||
              input.readUInt32LE(offset + 18) !== entry.compressedSize ||
              input.readUInt32LE(offset + 22) !== entry.uncompressedSize)
          )
            throw new ScanError('guard_invalid_workbook');
          intervals.push([offset, dataEnd]);
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
            zip.openReadStream(entry, (err, stream) =>
              err || !stream
                ? rej(new ScanError('guard_invalid_workbook'))
                : res(stream),
            ),
          );
          const chunks: Buffer[] = [];
          let size = 0;
          let crc = 0;
          for await (const value of stream as AsyncIterable<Buffer>) {
            size += value.length;
            expanded += value.length;
            if (
              size > limits.entryBytes ||
              expanded > limits.expandedBytes ||
              size > Math.max(entry.compressedSize, 1) * limits.ratio
            )
              throw new ScanError('guard_limit_exceeded');
            crc = crc32(value, crc);
            chunks.push(value);
          }
          if (size !== entry.uncompressedSize || crc !== entry.crc32)
            throw new ScanError('guard_invalid_workbook');
          result.set(name.toLowerCase(), Buffer.concat(chunks));
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } catch (error) {
    throw error instanceof ScanError
      ? error
      : new ScanError('guard_invalid_workbook');
  } finally {
    zip.close();
  }
  if (
    !result.has('[content_types].xml') ||
    !result.has('xl/workbook.xml') ||
    !result.has('xl/_rels/workbook.xml.rels')
  )
    throw new ScanError('guard_invalid_workbook');
  return result;
}
