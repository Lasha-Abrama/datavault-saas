import { crc32, deflateRawSync } from 'node:zlib';
export function archive(
  parts: Record<string, string | Buffer>,
  compress = false,
): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(parts)) {
    const filename = Buffer.from(name),
      body = Buffer.from(value),
      data = compress ? deflateRawSync(body) : body;
    const local = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(compress ? 8 : 0, 10);
    directory.writeUInt32LE(crc32(body), 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, data);
    central.push(directory, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const REL =
  'http://schemas.openxmlformats.org/package/2006/relationships';
export const OFFICE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CANARIES = [
  'test.person@example.com',
  '+1 213 373 4253',
  '4111 1111 1111 1111',
  'GB82 WEST 1234 5698 7654 32',
  '2001:db8::1',
];
export function workbookParts(): Record<string, string> {
  const text = (address: string, value: string) =>
    `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
  return {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${OFFICE}"><sheets><sheet name="private person" sheetId="1" r:id="rId1"/><sheet name="private bank" sheetId="2" state="veryHidden" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN}"><cols><col min="2" max="2" hidden="1"/></cols><sheetData><row r="1">${text('A1', CANARIES[0])}${text('B1', CANARIES[1])}${text('C1', CANARIES[2])}<c r="D1"><v>4111111111111111</v></c></row><row r="2" hidden="1">${text('A2', CANARIES[3])}${text('B2', '192.0.2.1')}<c r="C2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${MAIN}"><sheetData><row r="1">${text('A1', CANARIES[4])}</row></sheetData></worksheet>`,
  };
}
export function workbook() {
  return archive(workbookParts());
}

export function plainWorkbook() {
  const parts = workbookParts();
  parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(
    '<c r="C2"><f>1+1</f><v>2</v></c>',
    '',
  );
  return archive(parts);
}
