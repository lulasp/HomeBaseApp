import * as XLSX from 'xlsx';

// Convert a base64-encoded .xlsx/.xls workbook into CSV text (all sheets
// concatenated). The CSV is what we hand to the AI — bank exports vary wildly
// in column names/order, so we let the model interpret the rows rather than
// hard-coding a column mapping.
export function xlsxBase64ToCsv(base64) {
  const wb = XLSX.read(base64, { type: 'base64' });
  return wb.SheetNames
    .map((name) => XLSX.utils.sheet_to_csv(wb.Sheets[name]))
    .filter((csv) => csv.trim().length > 0)
    .join('\n\n');
}

// True for filenames/mime types we treat as spreadsheets.
export function isSpreadsheet({ name = '', mimeType = '' } = {}) {
  return /\.(xlsx|xls)$/i.test(name)
    || mimeType.includes('spreadsheet')
    || mimeType.includes('ms-excel');
}
