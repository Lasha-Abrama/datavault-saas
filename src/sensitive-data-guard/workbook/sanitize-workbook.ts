import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  GuardLimits,
  REDACTION_MARKER,
  SanitizationOptions,
  SanitizationResult,
  ScanError,
} from '../guard.constants';
import { preflight } from './xlsx-preflight';
import { scanWorkbook, xml } from './scan-workbook';
import { writeXlsx } from './write-xlsx';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
interface Element {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: Element[];
}
interface Cell {
  address: string;
  row: number;
  column: number;
  type: string;
  value: string;
}
interface Sheet {
  state: string;
  rows: { attrs: Record<string, string>; cells: Cell[] }[];
  columns: Record<string, string>[];
}
const allowed: Record<string, { children: string[]; attrs: string[] }> = {
  workbook: { children: ['sheets', 'bookViews', 'workbookPr'], attrs: [] },
  workbookPr: { children: [], attrs: ['date1904'] },
  bookViews: { children: ['workbookView'], attrs: [] },
  workbookView: {
    children: [],
    attrs: [
      'activeTab',
      'firstSheet',
      'visibility',
      'showHorizontalScroll',
      'showVerticalScroll',
      'showSheetTabs',
      'xWindow',
      'yWindow',
      'windowWidth',
      'windowHeight',
      'tabRatio',
    ],
  },
  sheets: { children: ['sheet'], attrs: [] },
  sheet: { children: [], attrs: ['name', 'sheetId', 'state', 'r:id'] },
  worksheet: { children: ['sheetData', 'cols', 'dimension'], attrs: [] },
  dimension: { children: [], attrs: ['ref'] },
  cols: { children: ['col'], attrs: [] },
  col: {
    children: [],
    attrs: ['min', 'max', 'hidden', 'width', 'customWidth'],
  },
  sheetData: { children: ['row'], attrs: [] },
  row: {
    children: ['c'],
    attrs: ['r', 'hidden', 'ht', 'customHeight', 'spans'],
  },
  c: { children: ['v', 'is'], attrs: ['r', 't'] },
  is: { children: ['t'], attrs: [] },
  t: { children: [], attrs: ['xml:space'] },
  v: { children: [], attrs: [] },
  sst: { children: ['si'], attrs: ['count', 'uniqueCount'] },
  si: { children: ['t'], attrs: [] },
};
const unsupported = () => new ScanError('guard_profile_unsupported');
const digest = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;');
function tree(bytes: Buffer, limits: GuardLimits): Element {
  const stack: Element[] = [];
  let root: Element | undefined;
  xml(
    bytes,
    limits,
    (tag) => {
      const rule = allowed[tag.local];
      if (
        tag.uri !== MAIN ||
        !rule ||
        (stack.length &&
          !allowed[stack[stack.length - 1].name].children.includes(tag.local))
      )
        throw unsupported();
      const attrs: Record<string, string> = {};
      for (const [name, attribute] of Object.entries(tag.attributes)) {
        if (
          (name === 'xmlns' && attribute.value === MAIN) ||
          (name === 'xmlns:r' && attribute.value === OFFICE)
        )
          continue;
        if (!rule.attrs.includes(name)) throw unsupported();
        attrs[name] = attribute.value;
      }
      const element: Element = {
        name: tag.local,
        attrs,
        text: '',
        children: [],
      };
      if (stack.length) stack[stack.length - 1].children.push(element);
      else if (root) throw unsupported();
      else root = element;
      stack.push(element);
    },
    (text) => {
      const element = stack[stack.length - 1];
      if (!element) {
        if (text.trim()) throw unsupported();
        return;
      }
      if (!['t', 'v'].includes(element.name) && text.trim())
        throw unsupported();
      element.text += text;
      if (Buffer.byteLength(element.text) > limits.textBytes)
        throw new ScanError('guard_limit_exceeded');
    },
    () => {
      stack.pop();
    },
  );
  if (!root) throw unsupported();
  return root;
}
function one(node: Element, name: string): Element | undefined {
  const found = node.children.filter((child) => child.name === name);
  if (found.length > 1) throw unsupported();
  return found[0];
}
function attrsText(attrs: Record<string, string>) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join('');
}
async function supported(input: Buffer, limits: GuardLimits): Promise<Sheet[]> {
  const parts = await preflight(input, limits);
  for (const name of parts.keys())
    if (
      !/^\[content_types\]\.xml$|^_rels\/\.rels$|^docprops\/(core|app|custom)\.xml$|^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedstrings\.xml|worksheets\/sheet\d+\.xml)$/.test(
        name,
      )
    )
      throw unsupported();
  const book = tree(parts.get('xl/workbook.xml')!, limits);
  if (
    book.name !== 'workbook' ||
    ['1', 'true'].includes(one(book, 'workbookPr')?.attrs.date1904 ?? '')
  )
    throw unsupported();
  const relationships = new Map<string, string>();
  xml(
    parts.get('xl/_rels/workbook.xml.rels')!,
    limits,
    (tag) => {
      if (tag.local !== 'Relationship') return;
      const id = tag.attributes.Id?.value,
        target = tag.attributes.Target?.value;
      if (
        tag.attributes.Type?.value === `${OFFICE}/sharedStrings` &&
        parts.has('xl/sharedstrings.xml')
      )
        return;
      if (
        !id ||
        !target ||
        tag.attributes.Type?.value !== `${OFFICE}/worksheet` ||
        relationships.has(id)
      )
        throw unsupported();
      relationships.set(
        id,
        posix
          .normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`)
          .toLowerCase(),
      );
    },
    () => {},
    () => {},
  );
  const strings = parts.has('xl/sharedstrings.xml')
    ? tree(parts.get('xl/sharedstrings.xml')!, limits).children.map((si) => {
        const text = one(si, 't');
        if (!text || si.name !== 'si') throw unsupported();
        return text.text;
      })
    : [];
  const inventory = one(book, 'sheets');
  if (!inventory || !inventory.children.length) throw unsupported();
  const sheets: Sheet[] = [];
  for (const sheet of inventory.children) {
    const path = relationships.get(sheet.attrs['r:id']);
    if (!path || !parts.has(path)) throw unsupported();
    const root = tree(parts.get(path)!, limits);
    if (root.name !== 'worksheet') throw unsupported();
    const data = one(root, 'sheetData');
    if (!data) throw unsupported();
    const state = sheet.attrs.state ?? 'visible';
    if (!['visible', 'hidden', 'veryHidden'].includes(state))
      throw unsupported();
    const rows = data.children.map((row) => ({
      attrs: Object.fromEntries(
        Object.entries(row.attrs).filter(([key]) => key !== 'spans'),
      ),
      cells: row.children.map((cell) => {
        const address = cell.attrs.r,
          match = /^([A-Z]+)(\d+)$/.exec(address);
        if (!match) throw unsupported();
        let column = 0;
        for (const letter of match[1])
          column = column * 26 + letter.charCodeAt(0) - 64;
        const type = cell.attrs.t ?? 'n';
        let value = '';
        if (type === 'inlineStr') {
          if (one(cell, 'v')) throw unsupported();
          const inline = one(cell, 'is');
          const text = inline ? one(inline, 't') : undefined;
          if (!text) throw unsupported();
          value = text.text;
        } else {
          if (one(cell, 'is')) throw unsupported();
          value = one(cell, 'v')?.text ?? '';
          if (type === 's') {
            if (!/^\d+$/.test(value) || strings[Number(value)] === undefined)
              throw unsupported();
            value = strings[Number(value)];
          } else if (type === 'n') {
            if (
              value &&
              (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
                !Number.isFinite(Number(value)))
            )
              throw unsupported();
          } else if (type === 'b') {
            if (!['0', '1'].includes(value)) throw unsupported();
          } else if (type !== 'str') throw unsupported();
        }
        return {
          address,
          row: Number(match[2]),
          column,
          type: ['s', 'str'].includes(type) ? 'inlineStr' : type,
          value,
        };
      }),
    }));
    const columns = one(root, 'cols')?.children.map((col) => col.attrs) ?? [];
    for (const attrs of [...rows.map((row) => row.attrs), ...columns]) {
      for (const name of ['hidden', 'customWidth', 'customHeight'])
        if (attrs[name] && !['0', '1', 'true', 'false'].includes(attrs[name]))
          throw unsupported();
      for (const name of ['width', 'ht'])
        if (
          attrs[name] &&
          (!/^\d+(?:\.\d+)?$/.test(attrs[name]) || Number(attrs[name]) > 4096)
        )
          throw unsupported();
    }
    let previousColumn = 0;
    for (const column of columns) {
      if (Number(column.min) <= previousColumn) throw unsupported();
      previousColumn = Number(column.max);
    }
    sheets.push({ state, rows, columns });
  }
  if (!sheets.some((sheet) => sheet.state === 'visible')) throw unsupported();
  return sheets;
}
function generate(sheets: Sheet[], limits: GuardLimits): Buffer {
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${OFFICE}"><sheets>${sheets.map((sheet, i) => `<sheet name="Sheet ${i + 1}" sheetId="${i + 1}" state="${sheet.state}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${OFFICE}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  for (const [i, sheet] of sheets.entries())
    parts[`xl/worksheets/sheet${i + 1}.xml`] =
      `<worksheet xmlns="${MAIN}">${sheet.columns.length ? `<cols>${sheet.columns.map((attrs) => `<col${attrsText(attrs)}/>`).join('')}</cols>` : ''}<sheetData>${sheet.rows.map((row) => `<row${attrsText(row.attrs)}>${row.cells.map((cell) => (cell.type === 'inlineStr' ? `<c r="${cell.address}" t="inlineStr"><is><t xml:space="preserve">${escape(cell.value)}</t></is></c>` : `<c r="${cell.address}" t="${cell.type}">${cell.value ? `<v>${escape(cell.value)}</v>` : ''}</c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return writeXlsx(parts, limits.compressedBytes);
}
export async function sanitizeWorkbook(
  input: Buffer,
  options: SanitizationOptions,
  limits: GuardLimits,
): Promise<SanitizationResult> {
  try {
    const scan = await scanWorkbook(
      input,
      options.categories,
      options.phoneRegion,
      limits,
    );
    if (digest(JSON.stringify(scan.findings)) !== options.findingsDigest)
      throw new ScanError('guard_source_changed');
    const sheets = await supported(input, limits);
    const selected = new Set(
      scan.findings
        .filter((f) => options.selection.categories.includes(f.category))
        .map((f) => `${f.sheetIndex}:${f.row}:${f.column}`),
    );
    for (const column of options.selection.columns) {
      const sheet = sheets[column.sheetIndex];
      if (
        !sheet ||
        !sheet.rows.some((row) =>
          row.cells.some((cell) => cell.column === column.column),
        )
      )
        throw new ScanError('guard_selection_invalid');
      for (const row of sheet.rows)
        for (const cell of row.cells)
          if (
            cell.column === column.column &&
            (column.includeHeader || cell.row !== 1)
          )
            selected.add(`${column.sheetIndex}:${cell.row}:${cell.column}`);
    }
    if (!selected.size || selected.size > limits.cells)
      throw new ScanError('guard_selection_invalid');
    let changed = 0;
    for (const [index, sheet] of sheets.entries())
      for (const row of sheet.rows)
        for (const cell of row.cells)
          if (selected.has(`${index}:${cell.row}:${cell.column}`)) {
            cell.value = REDACTION_MARKER;
            cell.type = 'inlineStr';
            changed++;
          }
    if (changed !== selected.size)
      throw new ScanError('guard_output_verification_failed');
    const output = generate(sheets, limits);
    await scanWorkbook(output, options.categories, options.phoneRegion, limits);
    const reopened = await supported(output, limits);
    if (JSON.stringify(reopened) !== JSON.stringify(sheets))
      throw new ScanError('guard_output_verification_failed');
    return {
      bytes: output,
      redactedCells: changed,
      outputDigest: digest(output),
    };
  } catch (error) {
    throw error instanceof ScanError ? error : unsupported();
  }
}
