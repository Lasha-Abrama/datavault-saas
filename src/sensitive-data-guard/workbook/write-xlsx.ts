import { crc32 } from 'node:zlib';
import { ScanError } from '../guard.constants';
// Canonical stored ZIP: no inherited package parts, comments, timestamps or extra fields.
export function writeXlsx(
  parts: Record<string, string>,
  maxBytes: number,
): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(parts)) {
    const filename = Buffer.from(name),
      body = Buffer.from(value);
    if (offset + filename.length + body.length + 30 > maxBytes)
      throw new ScanError('guard_limit_exceeded');
    const local = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc32(body), 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, body);
    central.push(directory, filename);
    offset += local.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  if (offset + directory.length + end.length > maxBytes)
    throw new ScanError('guard_limit_exceeded');
  return Buffer.concat([...locals, directory, end]);
}
