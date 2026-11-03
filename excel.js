'use strict';
// ========== 纯 JS 生成 .xlsx（无第三方依赖，离线可用） ==========
// 结构：ZIP（仅 STORE 不压缩）+ SpreadsheetML 最小文件集

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- 字节写入器 ----------
class ByteWriter {
  constructor() { this.chunks = []; this.length = 0; }
  pushBytes(arr) { this.chunks.push(arr); this.length += arr.length; }
  pushU16(v) { this.pushBytes(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF])); }
  pushU32(v) { this.pushBytes(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF])); }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

function dosDateTime(d) {
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

// 把多个 {name, data:Uint8Array} 打包为 ZIP（STORE 模式）
function buildZip(files) {
  const w = new ByteWriter();
  const central = new ByteWriter();
  const dt = dosDateTime(new Date());

  files.forEach((f) => {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const offset = w.length;
    // 本地文件头
    w.pushU32(0x04034b50);
    w.pushU16(20);          // 版本
    w.pushU16(0x0800);      // UTF-8 文件名标志
    w.pushU16(0);           // STORE 不压缩
    w.pushU16(dt.time);
    w.pushU16(dt.date);
    w.pushU32(crc);
    w.pushU32(f.data.length);   // 压缩后大小
    w.pushU32(f.data.length);   // 原始大小
    w.pushU16(nameBytes.length);
    w.pushU16(0);           // extra 长度
    w.pushBytes(nameBytes);
    w.pushBytes(f.data);
    // 中央目录项
    central.pushU32(0x02014b50);
    central.pushU16(20);    // 创建版本
    central.pushU16(20);    // 需要版本
    central.pushU16(0x0800);
    central.pushU16(0);
    central.pushU16(dt.time);
    central.pushU16(dt.date);
    central.pushU32(crc);
    central.pushU32(f.data.length);
    central.pushU32(f.data.length);
    central.pushU16(nameBytes.length);
    central.pushU16(0);     // extra
    central.pushU16(0);     // comment
    central.pushU16(0);     // 磁盘号
    central.pushU16(0);     // 内部属性
    central.pushU32(0);     // 外部属性
    central.pushU32(offset);
    central.pushBytes(nameBytes);
  });

  const cdOffset = w.length;
  const cd = central.toUint8Array();
  w.pushBytes(cd);
  // EOCD
  w.pushU32(0x06054b50);
  w.pushU16(0);
  w.pushU16(0);
  w.pushU16(files.length);
  w.pushU16(files.length);
  w.pushU32(cd.length);
  w.pushU32(cdOffset);
  w.pushU16(0);
  return w.toUint8Array();
}

// ---------- XML 工具 ----------
function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// 列号数字转字母（1→A）
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellText(ref, text) {
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(text) + '</t></is></c>';
}
function cellNum(ref, num) {
  return '<c r="' + ref + '"><v>' + num + '</v></c>';
}

// rows: 二维数组，字符串→文本单元格，number→数字单元格
function sheetXml(rows) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, i) => {
    const r = i + 1;
    xml += '<row r="' + r + '">';
    row.forEach((val, j) => {
      const ref = colLetter(j + 1) + r;
      if (typeof val === 'number' && isFinite(val)) xml += cellNum(ref, val);
      else xml += cellText(ref, val == null ? '' : String(val));
    });
    xml += '</row>';
  });
  xml += '</sheetData></worksheet>';
  return xml;
}

// 生成 xlsx（Uint8Array）。sheetName ≤31 字符且不含 : \ / ? * [ ]
function makeXlsx(rows, sheetName) {
  const name = (sheetName || 'Sheet1').replace(/[:\\\/?\*\[\]]/g, ' ').slice(0, 31) || 'Sheet1';
  const enc = (s) => new TextEncoder().encode(s);
  const files = [
    {
      name: '[Content_Types].xml',
      data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>')
    },
    {
      name: '_rels/.rels',
      data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>')
    },
    {
      name: 'xl/workbook.xml',
      data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + xmlEsc(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>')
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>')
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: enc(sheetXml(rows))
    },
    {
      name: 'xl/styles.xml',
      data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        '</styleSheet>')
    }
  ];
  return buildZip(files);
}
