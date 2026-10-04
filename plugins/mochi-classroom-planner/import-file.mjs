import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { parseRows } from './timetable.mjs';

export async function importFile(bytes, filename) {
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('课表文件请控制在 8 MB 以内。');
  const workbook = new ExcelJS.Workbook();
  let sheet;
  if (/\.xlsx$/i.test(filename)) {
    await workbook.xlsx.load(bytes);
    const sheets = workbook.worksheets.filter(row => row.state !== 'veryHidden' && row.actualRowCount > 0);
    if (sheets.length !== 1) throw new Error('文件含有多个课表页，请将本班课表另存为一个工作表后导入。');
    sheet = sheets[0];
  } else if (/\.csv$/i.test(filename)) {
    sheet = await workbook.csv.read(Readable.from([bytes]), { map: value => value });
  } else throw new Error('请选择 .xlsx 或 .csv 课表；截图和照片请使用图片导入。');
  if (sheet.rowCount > 300 || sheet.columnCount > 40) throw new Error('课表范围过大，请保留本班课表后重新导入。');
  const rows = [];
  for (let i = 1; i <= sheet.rowCount; i++) {
    rows.push(Array.from({ length: sheet.columnCount }, (_, j) => sheet.getRow(i).getCell(j + 1).value));
  }
  return parseRows(rows, filename);
}
