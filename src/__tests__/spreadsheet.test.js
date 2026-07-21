import * as XLSX from 'xlsx';
import { xlsxBase64ToCsv, isSpreadsheet } from '../utils/spreadsheet';

// Build a real .xlsx workbook in memory and encode it as base64 so the
// round-trip exercises SheetJS parsing without a binary fixture on disk.
function makeXlsxBase64(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

describe('xlsxBase64ToCsv', () => {
  it('converts a workbook to CSV text', () => {
    const base64 = makeXlsxBase64([
      ['Date', 'Description', 'Amount'],
      ['2026-01-15', 'Tesco', -42.5],
      ['2026-01-20', 'Salary', 900],
    ]);
    const csv = xlsxBase64ToCsv(base64);
    expect(csv).toContain('Date,Description,Amount');
    expect(csv).toContain('Tesco');
    expect(csv).toContain('900');
  });

  it('drops empty sheets', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A', 'B']]), 'Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
    const csv = xlsxBase64ToCsv(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }));
    expect(csv).toContain('A,B');
    expect(csv.trim().endsWith('A,B')).toBe(true);
  });
});

describe('isSpreadsheet', () => {
  it('detects by extension', () => {
    expect(isSpreadsheet({ name: 'statement.xlsx' })).toBe(true);
    expect(isSpreadsheet({ name: 'statement.XLS' })).toBe(true);
    expect(isSpreadsheet({ name: 'statement.pdf' })).toBe(false);
  });

  it('detects by mime type', () => {
    expect(isSpreadsheet({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(true);
    expect(isSpreadsheet({ mimeType: 'application/vnd.ms-excel' })).toBe(true);
    expect(isSpreadsheet({ mimeType: 'application/pdf' })).toBe(false);
  });

  it('handles missing fields', () => {
    expect(isSpreadsheet()).toBe(false);
    expect(isSpreadsheet({})).toBe(false);
  });
});
