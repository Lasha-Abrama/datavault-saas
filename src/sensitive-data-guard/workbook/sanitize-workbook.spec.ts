import { createHash } from 'node:crypto';
import {
  archive,
  workbookParts,
  CANARIES,
  MAIN,
  OFFICE,
} from '../../../test/fixtures/guard/workbook';
import {
  CATEGORIES,
  DEFAULT_LIMITS,
  REDACTION_MARKER,
  SanitizationOptions,
} from '../guard.constants';
import { sanitizeWorkbook } from './sanitize-workbook';
import { scanWorkbook } from './scan-workbook';
import * as writer from './write-xlsx';
import { preflight } from './xlsx-preflight';
import { GuardRunner } from '../guard.runner';
export function plainParts() {
  const parts = workbookParts();
  parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(
    '<c r="C2"><f>1+1</f><v>2</v></c>',
    '',
  );
  return parts;
}
async function options(input: Buffer): Promise<SanitizationOptions> {
  const scan = await scanWorkbook(
    input,
    [...CATEGORIES],
    undefined,
    DEFAULT_LIMITS,
  );
  return {
    categories: [...CATEGORIES],
    selection: { categories: [...CATEGORIES], columns: [] },
    findingsDigest: createHash('sha256')
      .update(JSON.stringify(scan.findings))
      .digest('hex'),
  };
}
describe('strict plain-cell XLSX full redaction', () => {
  it('reopens, redacts categories in hidden areas, preserves other typed cells and never mutates input', async () => {
    const input = archive(plainParts()),
      before = Buffer.from(input);
    const result = await sanitizeWorkbook(
      input,
      await options(input),
      DEFAULT_LIMITS,
    );
    expect(input.equals(before)).toBe(true);
    expect(result.redactedCells).toBe(6);
    const parts = await preflight(result.bytes, DEFAULT_LIMITS);
    const xml = [...parts.values()].map((part) => part.toString()).join('');
    for (const value of [...CANARIES, 'private person', 'private bank'])
      expect(xml).not.toContain(value);
    expect(xml).toContain('4111111111111111'); // Unselected numeric cell deliberately remains.
    expect(xml).toContain('state="veryHidden"');
    expect(xml).toContain('hidden="1"');
    expect((xml.match(/\[REDACTED\]/g) ?? []).length).toBe(6);
    expect(
      (
        await scanWorkbook(
          result.bytes,
          [...CATEGORIES],
          undefined,
          DEFAULT_LIMITS,
        )
      ).findings,
    ).toHaveLength(0);
  });
  it('redacts selected whole columns including numeric cells and honors explicit row-1 exclusion', async () => {
    const input = archive(plainParts()),
      opts = await options(input);
    opts.selection = {
      categories: [],
      columns: [
        { sheetIndex: 0, column: 4, includeHeader: true },
        { sheetIndex: 0, column: 1, includeHeader: false },
      ],
    };
    const result = await sanitizeWorkbook(input, opts, DEFAULT_LIMITS);
    expect(result.redactedCells).toBe(2);
    const parts = await preflight(result.bytes, DEFAULT_LIMITS);
    const text = parts.get('xl/worksheets/sheet1.xml')!.toString();
    expect(text).toContain(CANARIES[0]);
    expect(text).not.toContain(CANARIES[3]);
    expect(text).not.toContain('4111111111111111');
  });
  it('rebuilds shared strings and strips unused strings and workbook metadata', async () => {
    const parts = plainParts();
    parts['xl/worksheets/sheet1.xml'] = parts[
      'xl/worksheets/sheet1.xml'
    ].replace(
      `<c r="A1" t="inlineStr"><is><t>${CANARIES[0]}</t></is></c>`,
      '<c r="A1" t="s"><v>0</v></c>',
    );
    parts['xl/sharedStrings.xml'] =
      `<sst xmlns="${MAIN}" count="1" uniqueCount="2"><si><t>${CANARIES[0]}</t></si><si><t>unused private canary</t></si></sst>`;
    parts['xl/_rels/workbook.xml.rels'] = parts[
      'xl/_rels/workbook.xml.rels'
    ].replace(
      '</Relationships>',
      `<Relationship Id="strings" Type="${OFFICE}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    );
    parts['docProps/core.xml'] =
      '<properties><author>metadata private canary</author></properties>';
    const input = archive(parts),
      result = await sanitizeWorkbook(
        input,
        await options(input),
        DEFAULT_LIMITS,
      );
    const output = await preflight(result.bytes, DEFAULT_LIMITS);
    expect(output.has('xl/sharedstrings.xml')).toBe(false);
    expect(output.has('docprops/core.xml')).toBe(false);
    expect(
      [...output.values()].map((part) => part.toString()).join(''),
    ).not.toMatch(/unused private canary|metadata private canary/);
  });
  it.each([
    '<mergeCells><mergeCell ref="A1:B1"/></mergeCells>',
    '<dataValidations/>',
    '<conditionalFormatting/>',
    '<hyperlinks/>',
    '<drawing/>',
    '<extLst/>',
  ])('rejects unsupported worksheet structures: %s', async (extra) => {
    const parts = plainParts();
    parts['xl/worksheets/sheet1.xml'] = parts[
      'xl/worksheets/sheet1.xml'
    ].replace('</worksheet>', `${extra}</worksheet>`);
    const input = archive(parts);
    const opts = await options(input);
    await expect(
      sanitizeWorkbook(input, opts, DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_profile_unsupported');
  });
  it.each([
    'xl/styles.xml',
    'xl/comments1.xml',
    'xl/drawings/drawing1.xml',
    'xl/pivotTables/pivot1.xml',
    'xl/connections.xml',
  ])('rejects unsupported package part %s', async (name) => {
    const parts = plainParts();
    parts[name] = '<content/>';
    const input = archive(parts);
    await expect(
      sanitizeWorkbook(input, await options(input), DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_profile_unsupported');
  });
  it('rejects formulas and caches, unknown attributes, bad selections and changed scan findings', async () => {
    const formula = archive(workbookParts());
    await expect(
      sanitizeWorkbook(formula, await options(formula), DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_profile_unsupported');
    const input = archive(plainParts()),
      opts = await options(input);
    opts.selection = {
      categories: [],
      columns: [{ sheetIndex: 0, column: 500, includeHeader: true }],
    };
    await expect(
      sanitizeWorkbook(input, opts, DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_selection_invalid');
    opts.findingsDigest = '0'.repeat(64);
    await expect(
      sanitizeWorkbook(input, opts, DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_source_changed');
    const parts = plainParts();
    parts['xl/worksheets/sheet1.xml'] = parts[
      'xl/worksheets/sheet1.xml'
    ].replace('r="A1"', 'r="A1" secret="hidden canary"');
    const altered = archive(parts);
    await expect(
      sanitizeWorkbook(altered, await options(altered), DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_profile_unsupported');
  });
  it('fails verification if a writer returns an unchanged workbook', async () => {
    const input = archive(plainParts());
    const spy = jest.spyOn(writer, 'writeXlsx').mockReturnValue(input);
    try {
      await expect(
        sanitizeWorkbook(input, await options(input), DEFAULT_LIMITS),
      ).rejects.toHaveProperty('code', 'guard_output_verification_failed');
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    'overlapping_columns',
    'all_hidden',
    'defined_names',
    'rich_strings',
  ])('rejects ambiguous workbook structure %s', async (kind) => {
    const parts = plainParts();
    if (kind === 'overlapping_columns')
      parts['xl/worksheets/sheet1.xml'] = parts[
        'xl/worksheets/sheet1.xml'
      ].replace('</cols>', '<col min="2" max="3" hidden="0"/></cols>');
    if (kind === 'all_hidden')
      parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace(
        'sheetId="1"',
        'sheetId="1" state="hidden"',
      );
    if (kind === 'defined_names')
      parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace(
        '</workbook>',
        '<definedNames><definedName name="secret">private value</definedName></definedNames></workbook>',
      );
    if (kind === 'rich_strings')
      parts['xl/sharedStrings.xml'] =
        `<sst xmlns="${MAIN}"><si><r><t>private value</t></r></si></sst>`;
    const input = archive(parts);
    await expect(
      sanitizeWorkbook(input, await options(input), DEFAULT_LIMITS),
    ).rejects.toHaveProperty('code', 'guard_profile_unsupported');
  });
  it('runs sanitization only inside the compiled permission-restricted child', async () => {
    const input = archive(plainParts());
    const result = await new GuardRunner(DEFAULT_LIMITS).sanitize(
      input,
      await options(input),
      new AbortController().signal,
    );
    expect(result.redactedCells).toBe(6);
    expect(
      (await preflight(result.bytes, DEFAULT_LIMITS))
        .get('xl/worksheets/sheet1.xml')!
        .toString(),
    ).toContain(REDACTION_MARKER);
  });
});
