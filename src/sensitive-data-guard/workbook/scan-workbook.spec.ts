import {
  archive,
  CANARIES,
  workbook,
  workbookParts,
  MAIN,
} from '../../../test/fixtures/guard/workbook';
import { CATEGORIES, DEFAULT_LIMITS, GuardLimits } from '../guard.constants';
import { scanWorkbook } from './scan-workbook';
describe('bounded XLSX inspection', () => {
  const scan = (bytes: Buffer, limits: GuardLimits = DEFAULT_LIMITS) =>
    scanWorkbook(bytes, [...CATEGORIES], undefined, limits);
  it('scans genuine OOXML, hidden rows/columns/sheets and flags formulas without evaluation', async () => {
    const result = await scan(workbook());
    expect(result.processedCells).toBe(8);
    expect(result.sheets).toBe(2);
    expect(result.findings).toHaveLength(6);
    expect(result.findings.filter((f) => f.hidden)).toHaveLength(4);
    expect(result.findings.filter((f) => f.column === 4)).toEqual([]);
    expect(result.compatibilityFlags).toContain('formulas');
    const json = JSON.stringify(result);
    for (const raw of [...CANARIES, 'private person', 'private bank', '1+1'])
      expect(json).not.toContain(raw);
  });
  it('handles shared/rich strings and detects unused payload coverage', async () => {
    const parts = workbookParts();
    parts['xl/sharedStrings.xml'] =
      `<sst xmlns="${MAIN}"><si><r><t>test.person@</t></r><r><t>example.com</t></r></si><si><t>unused private value</t></si></sst>`;
    parts['xl/worksheets/sheet1.xml'] =
      `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`;
    const result = await scan(archive(parts));
    expect(result.findings.some((f) => f.category === 'email')).toBe(true);
    expect(result.compatibilityFlags).toContain('unreferenced_shared_strings');
  });
  it.each([
    'compressedBytes',
    'expandedBytes',
    'entryBytes',
    'entries',
    'sheets',
    'cells',
    'rows',
    'columns',
    'textBytes',
  ] as const)('enforces %s', async (key) => {
    await expect(
      scan(workbook(), { ...DEFAULT_LIMITS, [key]: 1 }),
    ).rejects.toMatchObject({ code: 'guard_limit_exceeded' });
  });
  it('rejects a high-ratio compressed bomb before XML parsing', async () => {
    await expect(
      scan(
        archive({ ...workbookParts(), 'huge.xml': 'X'.repeat(1000000) }, true),
      ),
    ).rejects.toMatchObject({ code: 'guard_limit_exceeded' });
  });
  it.each([
    'dtd',
    'external',
    'macro',
    'traversal',
    'duplicate',
    'invalid_xml',
    'missing_sheet',
  ])('rejects %s without revealing input', async (kind) => {
    const parts = workbookParts();
    if (kind === 'dtd')
      parts['xl/workbook.xml'] =
        '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///private">]>' +
        parts['xl/workbook.xml'];
    if (kind === 'external')
      parts['xl/_rels/workbook.xml.rels'] = parts[
        'xl/_rels/workbook.xml.rels'
      ].replace(
        'Target="worksheets/sheet1.xml"',
        'Target="https://private.invalid" TargetMode="External"',
      );
    if (kind === 'macro') parts['xl/vbaProject.bin'] = 'private';
    if (kind === 'traversal') parts['../private.xml'] = '<private/>';
    if (kind === 'duplicate')
      parts['XL/workbook.xml'] = parts['xl/workbook.xml'];
    if (kind === 'invalid_xml')
      parts['xl/workbook.xml'] = '<workbook><unclosed>';
    if (kind === 'missing_sheet') delete parts['xl/worksheets/sheet1.xml'];
    await expect(scan(archive(parts))).rejects.toMatchObject({
      code: 'guard_invalid_workbook',
      message: 'guard_invalid_workbook',
    });
  });
  it('detects corrupt CRC, truncated/encrypted archives and invalid sparse coordinates', async () => {
    const bytes = workbook();
    bytes[80] ^= 1;
    await expect(scan(bytes)).rejects.toHaveProperty(
      'code',
      'guard_invalid_workbook',
    );
    await expect(scan(workbook().subarray(0, 90))).rejects.toHaveProperty(
      'code',
      'guard_invalid_workbook',
    );
    const encrypted = workbook();
    encrypted.writeUInt16LE(1, 6);
    await expect(scan(encrypted)).rejects.toHaveProperty(
      'code',
      'guard_invalid_workbook',
    );
    const parts = workbookParts();
    parts['xl/worksheets/sheet1.xml'] = parts[
      'xl/worksheets/sheet1.xml'
    ].replace('r="A1"', 'r="ZZZ1"');
    await expect(scan(archive(parts))).rejects.toHaveProperty(
      'code',
      'guard_limit_exceeded',
    );
  });
});
