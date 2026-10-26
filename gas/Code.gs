/**
 * 理化課程站｜作答回收（Google Apps Script）
 *
 * 部署方式見 gas/README.md。這支程式只做兩件事：
 *   1. doPost：接收網站送來的作答紀錄，寫進「作答紀錄」工作表。
 *   2. buildSummary：整理成「題目統計」與「迷思統計」，供老師查看。
 *
 * 網站是公開的，任何人都能送資料進來，所以這裡會檢查欄位格式並限制長度。
 */

const SHEET_RAW = '作答紀錄';
const HEADERS = ['收到時間', '作答時間', '班級', '座號', '頁面', '題號', '知識成分', '課綱代碼',
                 '選項', '答對', '迷思', '預測題', '第幾次', '作答秒數'];

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    const rows = items.map(toRow).filter(Boolean);
    if (rows.length) {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const sh = rawSheet_();
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      } finally {
        lock.releaseLock();
      }
    }
    return out_({ ok: true, saved: rows.length });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out_({ ok: true, msg: '作答回收服務運作中' });
}

function toRow(it) {
  const cls = String(it.cls || '');
  const seat = parseInt(it.seat, 10);
  const qid = String(it.qid || '');
  if (!/^\d{3}$/.test(cls) || !(seat >= 1 && seat <= 40)) return null;
  if (!/^[A-Za-z]{2}-[A-Z]{2,3}-\d{1,2}-\d{3}$/.test(qid)) return null;
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  return [
    new Date(),
    s(it.ts, 30),
    cls,
    seat,
    s(it.page, 20),
    qid,
    s(it.kc, 30),
    s(it.code, 12),
    Number(it.choice),
    it.ok === true,
    s(it.mis, 40),
    it.predict === true,
    Math.min(parseInt(it.attempt, 10) || 1, 99),
    Math.round(Math.min(Number(it.ms) || 0, 3600000) / 1000)
  ];
}

function rawSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_RAW);
  if (!sh) {
    sh = ss.insertSheet(SHEET_RAW);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 整理統計。只算每位學生在每一題的「第一次作答」（同一人同一題取最早一筆），
 * 因為第一次的選擇最能反映原本的想法。預測題另外標示。
 * 可在試算表選單「理化課程站 → 更新統計」執行，或設定每天自動執行。
 */
function buildSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = rawSheet_().getDataRange().getValues();
  const first = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const key = r[2] + '-' + r[3] + '-' + r[5];
    if (first[key]) continue; // 紀錄依收到時間排列，第一筆就是第一次作答
    first[key] = r;
  }
  const byQ = {}, byMis = {};
  Object.values(first).forEach(r => {
    const q = byQ[r[5]] = byQ[r[5]] || { kc: r[6], code: r[7], page: r[4], predict: r[11], n: 0, ok: 0 };
    q.n++; if (r[9] === true) q.ok++;
    if (r[10]) {
      const k = r[5] + '|' + r[10];
      byMis[k] = byMis[k] || { qid: r[5], kc: r[6], mis: r[10], n: 0, classes: {} };
      byMis[k].n++; byMis[k].classes[r[2]] = (byMis[k].classes[r[2]] || 0) + 1;
    }
  });

  const qRows = Object.keys(byQ).sort().map(id => {
    const q = byQ[id];
    return [q.page, id, q.code, q.kc, q.predict ? '預測' : '', q.n, q.ok, q.n ? q.ok / q.n : ''];
  });
  write_(ss, '題目統計', ['頁面', '題號', '課綱代碼', '知識成分', '題型', '作答人數', '第一次答對', '答對率'], qRows, 8);

  const mRows = Object.values(byMis).sort((a, b) => b.n - a.n).map(m =>
    [m.mis, m.qid, m.kc, m.n, Object.keys(m.classes).sort().map(c => c + '：' + m.classes[c]).join('、')]);
  write_(ss, '迷思統計', ['迷思', '題號', '知識成分', '人次', '各班人次'], mRows, 0);
}

function write_(ss, name, headers, rows, pctCol) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    if (pctCol) sh.getRange(2, pctCol, rows.length, 1).setNumberFormat('0%');
  }
  sh.getRange(1, headers.length + 2).setValue('更新於 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('理化課程站').addItem('更新統計', 'buildSummary').addToUi();
}
