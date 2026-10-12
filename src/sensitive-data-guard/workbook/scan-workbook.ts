import { SaxesParser, SaxesTagNS } from 'saxes';
import { posix } from 'node:path';
import { detect } from '../detectors';
import {
  Category,
  GuardLimits,
  SafeFinding,
  ScanError,
  ScanResult,
} from '../guard.constants';
import { preflight } from './xlsx-preflight';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function attr(tag: SaxesTagNS, name: string) {
  return tag.attributes[name]?.value;
}
function integer(value: string | undefined, min: number, max: number) {
  if (!value || !/^\d+$/.test(value))
    throw new ScanError('guard_invalid_workbook');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new ScanError('guard_limit_exceeded');
  return number;
}
export function xml(
  buffer: Buffer,
  limits: GuardLimits,
  open: (tag: SaxesTagNS) => void,
  text: (value: string) => void,
  close: (tag: SaxesTagNS) => void,
) {
  let depth = 0,
    nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => {
    throw new ScanError('guard_invalid_workbook');
  });
  parser.on('doctype', () => {
    throw new ScanError('guard_invalid_workbook');
  });
  parser.on('processinginstruction', () => {
    throw new ScanError('guard_invalid_workbook');
  });
  parser.on('opentag', (tag) => {
    if (
      ++depth > 64 ||
      ++nodes > 1000000 ||
      Object.keys(tag.attributes).length > 64 ||
      Object.values(tag.attributes).some(
        (a) => Buffer.byteLength(a.value) > limits.textBytes,
      )
    )
      throw new ScanError('guard_limit_exceeded');
    open(tag);
  });
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', (tag) => {
    close(tag);
    depth--;
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let offset = 0; offset < buffer.length; offset += 4096)
    parser.write(
      decoder.decode(buffer.subarray(offset, offset + 4096), { stream: true }),
    );
  parser.write(decoder.decode());
  parser.close();
}

export async function scanWorkbook(
  input: Buffer,
  categories: Category[],
  phoneRegion: string | undefined,
  limits: GuardLimits,
): Promise<ScanResult> {
  try {
    return await scan(input, categories, phoneRegion, limits);
  } catch (error) {
    throw error instanceof ScanError
      ? error
      : new ScanError('guard_invalid_workbook');
  }
}
async function scan(
  input: Buffer,
  categories: Category[],
  phoneRegion: string | undefined,
  limits: GuardLimits,
): Promise<ScanResult> {
  const parts = await preflight(input, limits);
  const flags = new Set<string>(['cell_text_only', 'metadata_not_scanned']);
  const contentTypes = parts.get('[content_types].xml')!;
  let workbookType = false;
  xml(
    contentTypes,
    limits,
    (tag) => {
      if (
        tag.local === 'Override' &&
        attr(tag, 'PartName') === '/xl/workbook.xml'
      ) {
        workbookType =
          attr(tag, 'ContentType') ===
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
      }
    },
    () => {},
    () => {},
  );
  if (!workbookType) throw new ScanError('guard_invalid_workbook');
  for (const [name, body] of parts) {
    if (
      /vbaproject|embeddings\/|activex\/|externallinks\//i.test(name) ||
      !/\.(xml|rels)$/.test(name)
    )
      throw new ScanError('guard_invalid_workbook');
    if (
      !/^\[content_types\]\.xml$|^_rels\/\.rels$|^docprops\/(core|app|custom)\.xml$|^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedstrings\.xml|styles\.xml|theme\/theme\d+\.xml|worksheets\/sheet\d+\.xml|worksheets\/_rels\/sheet\d+\.xml\.rels)$/.test(
        name,
      )
    )
      flags.add('unsupported_parts');
    // Parse every XML part so malformed/DTD payloads cannot hide off the cell path.
    xml(
      body,
      limits,
      (tag) => {
        if (tag.uri === REL && tag.local === 'Relationship') {
          const target = attr(tag, 'Target');
          if (
            !target ||
            attr(tag, 'TargetMode') === 'External' ||
            /[\\:#?%]/.test(target)
          )
            throw new ScanError('guard_invalid_workbook');
          if (attr(tag, 'Type') === `${OFFICE_REL}/hyperlink`)
            flags.add('hyperlinks');
        }
      },
      () => {},
      () => {},
    );
  }
  const relationships = new Map<string, string>();
  xml(
    parts.get('xl/_rels/workbook.xml.rels')!,
    limits,
    (tag) => {
      if (tag.uri !== REL || tag.local !== 'Relationship') return;
      const id = attr(tag, 'Id'),
        target = attr(tag, 'Target');
      if (!id || !target || relationships.has(id))
        throw new ScanError('guard_invalid_workbook');
      if (attr(tag, 'Type') === `${OFFICE_REL}/worksheet`) {
        const resolved = posix
          .normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`)
          .toLowerCase();
        if (
          !/^xl\/worksheets\/sheet\d+\.xml$/.test(resolved) ||
          !parts.has(resolved)
        )
          throw new ScanError('guard_invalid_workbook');
        relationships.set(id, resolved);
      }
    },
    () => {},
    () => {},
  );
  const sheets: { path: string; hidden: boolean }[] = [];
  const seenPaths = new Set<string>();
  let workbookRoot = false;
  xml(
    parts.get('xl/workbook.xml')!,
    limits,
    (tag) => {
      if (tag.local === 'workbook') {
        if (tag.uri !== MAIN || workbookRoot)
          throw new ScanError('guard_invalid_workbook');
        workbookRoot = true;
      }
      if (tag.local === 'definedName') flags.add('defined_names');
      if (tag.local === 'workbookProtection')
        throw new ScanError('guard_invalid_workbook');
      if (tag.uri === MAIN && tag.local === 'sheet') {
        const relationship = Object.values(tag.attributes).find(
          (a) => a.local === 'id' && a.uri === OFFICE_REL,
        )?.value;
        const path = relationship ? relationships.get(relationship) : undefined;
        if (!path || seenPaths.has(path))
          throw new ScanError('guard_invalid_workbook');
        seenPaths.add(path);
        sheets.push({
          path,
          hidden: ['hidden', 'veryHidden'].includes(attr(tag, 'state') ?? ''),
        });
        if (sheets.length > limits.sheets)
          throw new ScanError('guard_limit_exceeded');
      }
    },
    () => {},
    () => {},
  );
  if (
    !workbookRoot ||
    !sheets.length ||
    [...parts.keys()].some(
      (p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p) && !seenPaths.has(p),
    )
  )
    throw new ScanError('guard_invalid_workbook');
  const strings: string[] = [];
  const referenced = new Set<number>();
  if (parts.has('xl/sharedstrings.xml')) {
    let value = '',
      inside = false,
      inText = false;
    xml(
      parts.get('xl/sharedstrings.xml')!,
      limits,
      (tag) => {
        if (tag.uri !== MAIN) throw new ScanError('guard_invalid_workbook');
        if (tag.local === 'si') {
          inside = true;
          value = '';
        }
        if (tag.local === 't' && inside) inText = true;
      },
      (chunk) => {
        if (inText) {
          value += chunk;
          if (Buffer.byteLength(value) > limits.textBytes)
            throw new ScanError('guard_limit_exceeded');
        }
      },
      (tag) => {
        if (tag.local === 't') inText = false;
        if (tag.local === 'si') {
          strings.push(value);
          inside = false;
          if (strings.length > limits.cells)
            throw new ScanError('guard_limit_exceeded');
        }
      },
    );
  }
  const findings: SafeFinding[] = [];
  let cells = 0;
  for (const [sheetIndex, sheet] of sheets.entries()) {
    let dataOpen = false,
      rowOpen = false;
    let root = false,
      row = 0,
      hiddenRow = false;
    const hiddenColumns = new Set<number>();
    const addresses = new Set<string>();
    let cell:
      | {
          row: number;
          column: number;
          type: string;
          value: string;
          formula: boolean;
        }
      | undefined;
    let capture = false;
    xml(
      parts.get(sheet.path)!,
      limits,
      (tag) => {
        if (tag.local === 'worksheet') {
          if (tag.uri !== MAIN || root)
            throw new ScanError('guard_invalid_workbook');
          root = true;
        }
        if (tag.uri !== MAIN) {
          throw new ScanError('guard_invalid_workbook');
        }
        if (['sheetProtection'].includes(tag.local))
          throw new ScanError('guard_invalid_workbook');
        if (
          [
            'hyperlink',
            'dataValidation',
            'conditionalFormatting',
            'tablePart',
            'drawing',
            'legacyDrawing',
            'ext',
            'headerFooter',
          ].includes(tag.local)
        )
          flags.add('unsupported_elements');
        if (tag.local === 'mergeCell') flags.add('merged_cells');
        if (tag.local === 'col') {
          const min = integer(attr(tag, 'min'), 1, limits.columns),
            max = integer(attr(tag, 'max'), min, limits.columns);
          if (['1', 'true'].includes(attr(tag, 'hidden') ?? ''))
            for (let i = min; i <= max; i++) hiddenColumns.add(i);
        }
        if (tag.local === 'sheetData') {
          if (dataOpen) throw new ScanError('guard_invalid_workbook');
          dataOpen = true;
        }
        if (tag.local === 'row') {
          if (!dataOpen || rowOpen)
            throw new ScanError('guard_invalid_workbook');
          rowOpen = true;
          const next = integer(attr(tag, 'r'), 1, limits.rows);
          if (next <= row) throw new ScanError('guard_invalid_workbook');
          row = next;
          hiddenRow = ['1', 'true'].includes(attr(tag, 'hidden') ?? '');
        }
        if (tag.local === 'c') {
          if (!rowOpen) throw new ScanError('guard_invalid_workbook');
          if (cell || ++cells > limits.cells)
            throw new ScanError('guard_limit_exceeded');
          const address = attr(tag, 'r') ?? '';
          const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);
          if (!match || addresses.has(address) || Number(match[2]) !== row)
            throw new ScanError('guard_invalid_workbook');
          addresses.add(address);
          let column = 0;
          for (const c of match[1]) column = column * 26 + c.charCodeAt(0) - 64;
          if (column > limits.columns)
            throw new ScanError('guard_limit_exceeded');
          const type = attr(tag, 't') ?? 'n';
          if (!['n', 'b', 'e', 'd', 's', 'str', 'inlineStr'].includes(type))
            throw new ScanError('guard_invalid_workbook');
          cell = { row, column, type, value: '', formula: false };
        }
        if (tag.local === 'f') {
          flags.add('formulas');
          if (cell) cell.formula = true;
        }
        if (cell && ['v', 't'].includes(tag.local)) capture = true;
      },
      (chunk) => {
        if (cell && capture) {
          cell.value += chunk;
          if (Buffer.byteLength(cell.value) > limits.textBytes)
            throw new ScanError('guard_limit_exceeded');
        }
      },
      (tag) => {
        if (tag.local === 'row') rowOpen = false;
        if (tag.local === 'sheetData') dataOpen = false;
        if (['v', 't'].includes(tag.local)) capture = false;
        if (tag.local !== 'c' || !cell) return;
        let text: string | undefined;
        if (!cell.formula && cell.type === 's') {
          const index = integer(cell.value, 0, strings.length - 1);
          text = strings[index];
          if (text === undefined) throw new ScanError('guard_invalid_workbook');
          referenced.add(index);
        } else if (!cell.formula && ['str', 'inlineStr'].includes(cell.type))
          text = cell.value;
        if (text !== undefined)
          for (const category of detect(text, categories, phoneRegion)) {
            if (findings.length >= limits.findings)
              throw new ScanError('guard_limit_exceeded');
            findings.push({
              ordinal: findings.length,
              sheetIndex,
              row: cell.row,
              column: cell.column,
              category,
              evidence: ['payment_card', 'iban'].includes(category)
                ? 'checksum_valid'
                : 'format_valid',
              hidden:
                sheet.hidden || hiddenRow || hiddenColumns.has(cell.column),
            });
          }
        cell = undefined;
      },
    );
    if (!root) throw new ScanError('guard_invalid_workbook');
  }
  if (strings.length > referenced.size)
    flags.add('unreferenced_shared_strings');
  return {
    findings,
    processedCells: cells,
    sheets: sheets.length,
    compatibilityFlags: [...flags].sort(),
    coverage: 'limited',
  };
}
