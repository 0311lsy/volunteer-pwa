'use strict';

// ========== 全局状态 ==========
let dirHandle = null;
let currentDetailId = null;
let editingId = null;
let pendingPdfChanged = false;

// ========== 工具 ==========
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function originalPdfName(fileName) {
  return fileName ? fileName.replace(/^\d{14}_/, '') : '';
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'page-home') loadList();
}

// ========== 文件夹连接（File System Access） ==========
function supportsFileSystemAccess() {
  return 'showDirectoryPicker' in window;
}

async function connectFolder() {
  if (!supportsFileSystemAccess()) {
    alert('当前浏览器不支持 File System Access API。请使用电脑版 Chrome / Edge，或安卓 Chrome。');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    dirHandle = handle;
    try {
      await saveDirHandle(handle);
    } catch (e) {
      alert('注意：当前浏览器无法记住文件夹授权，以后每次打开本页需要重新选择一次文件夹。');
    }
    updateFolderStatus();
    alert('已连接文件夹：' + handle.name + '\n今后上传的 PDF 都会保存到这个文件夹里。');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    alert('连接文件夹失败：' + (err.message || err));
  }
}

async function loadDirHandleFromDB() {
  try {
    dirHandle = await getSavedDirHandle();
  } catch (e) {
    dirHandle = null;
  }
  updateFolderStatus();
}

// 获取读写权限（requestPermission 必须由用户点击触发）
async function ensureAccess() {
  if (!dirHandle) {
    alert('请先点击「选择文件夹」，授权一个本地文件夹用于存放 PDF 文件。');
    return false;
  }
  let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
  if (perm === 'prompt') {
    perm = await dirHandle.requestPermission({ mode: 'readwrite' });
  }
  if (perm !== 'granted') {
    alert('未获得文件夹读写权限，无法读写 PDF 文件。');
    return false;
  }
  return true;
}

async function requestPermissionOnce() {
  if (!dirHandle) { connectFolder(); return; }
  const ok = await ensureAccess();
  if (ok) updateFolderStatus();
}

function updateFolderStatus() {
  const box = document.getElementById('folderStatus');
  const dot = document.getElementById('headerDot');
  if (!dirHandle) {
    dot.className = 'header-dot';
    box.className = 'folder-card warning';
    box.innerHTML =
      '<div class="folder-row">' +
        '<div><div class="folder-title">未连接存储文件夹</div>' +
        '<div class="folder-sub">上传的 PDF 将直接保存到你选择的本地文件夹，文件管理器随时可见</div></div>' +
        '<button onclick="connectFolder()" class="btn btn-blue btn-sm">选择文件夹</button>' +
      '</div>';
    return;
  }
  dirHandle.queryPermission({ mode: 'readwrite' }).then((perm) => {
    if (perm === 'granted') {
      dot.className = 'header-dot ok';
      box.className = 'folder-card ok';
      box.innerHTML =
        '<div class="folder-row">' +
          '<div><div class="folder-title">已连接：' + dirHandle.name + '</div>' +
          '<div class="folder-sub">PDF 文件保存在此文件夹中，可在文件管理器直接查看</div></div>' +
          '<button onclick="connectFolder()" class="btn btn-slate btn-sm">更换</button>' +
        '</div>';
    } else {
      dot.className = 'header-dot warn';
      box.className = 'folder-card warning';
      box.innerHTML =
        '<div class="folder-row">' +
          '<div><div class="folder-title">需要重新授权：' + dirHandle.name + '</div>' +
          '<div class="folder-sub">重新打开页面后需再次授权才能读写 PDF</div></div>' +
          '<button onclick="requestPermissionOnce()" class="btn btn-blue btn-sm">重新授权</button>' +
        '</div>';
    }
  });
}

// ========== PDF 文件读写 ==========
async function savePdfToFolder(file) {
  const fileName = timestamp() + '_' + safeFileName(file.name);
  const fh = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(file);
  await writable.close();
  return fileName;
}

async function getPdfFile(fileName) {
  const fh = await dirHandle.getFileHandle(fileName);
  return fh.getFile();
}

async function removePdfFile(fileName) {
  try {
    await dirHandle.removeEntry(fileName);
  } catch (e) {
    // 文件不存在时忽略
  }
}

// ========== 首页列表 ==========
// 排序：活动日期从最新到最旧；同日期按录入时间从新到旧
function sortRecordsDesc(list) {
  list.sort((a, b) =>
    (b.activityDate || '').localeCompare(a.activityDate || '') ||
    (Number(b.createAt) || 0) - (Number(a.createAt) || 0)
  );
}

async function loadList() {
  const all = await getAllRecords();
  const list = all.filter((r) => !r.deleted); // 过滤已删除（同步墓碑）
  sortRecordsDesc(list);

  let total = 0;
  list.forEach((r) => { total += Number(r.hours) || 0; });
  const t = Math.round(total * 10) / 10;
  document.getElementById('totalHours').textContent = String(t).replace(/\.0$/, '');
  document.getElementById('recordCount').textContent = list.length;

  const wrap = document.getElementById('recordList');
  wrap.innerHTML = '';
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">还没有记录。点击「新增记录」，开始记录你的第一次志愿服务。</div>';
    return;
  }
  list.forEach((rec) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.onclick = () => showDetail(rec.id);
    let html =
      '<div class="record-title">' + esc(rec.activityName || '未命名活动') + '</div>' +
      '<div class="record-meta">' + (rec.activityDate || '') + ' · ' + (Number(rec.hours) || 0) + ' 小时</div>';
    if (rec.pdfFileName) {
      html += '<div class="record-pdf">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M6 2h8l6 6v14H6z" stroke="#16a34a" stroke-width="1.8" fill="none"/><path d="M14 2v6h6" stroke="#16a34a" stroke-width="1.8" fill="none"/></svg>' +
        esc(originalPdfName(rec.pdfFileName)) + '</div>';
    }
    item.innerHTML = html;
    wrap.appendChild(item);
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ========== 详情 ==========
async function showDetail(id) {
  const rec = await getRecord(id);
  if (!rec) return;
  currentDetailId = id;
  const body = document.getElementById('detailBody');
  body.innerHTML =
    detailRow('活动名称', rec.activityName) +
    detailRow('活动日期', rec.activityDate) +
    detailRow('地点', rec.location || '-') +
    detailRow('服务内容', rec.content || '-') +
    detailRow('志愿时长', (Number(rec.hours) || 0) + ' 小时') +
    detailRow('主办单位', rec.organization || '-') +
    detailRow('备注', rec.remark || '-');

  const pdfSec = document.getElementById('pdfSection');
  if (rec.pdfFileName) {
    pdfSec.innerHTML =
      '<div class="pdf-box">' +
        '<div class="pdf-name">' + esc(originalPdfName(rec.pdfFileName)) + '</div>' +
        '<div class="pdf-loc">文件位置：' + esc(dirHandle ? dirHandle.name : '（未连接）') + ' / ' + esc(rec.pdfFileName) + '</div>' +
        '<button onclick="downloadPdf()" class="btn btn-blue btn-sm" style="margin-top:10px">下载 PDF</button>' +
      '</div>';
  } else {
    pdfSec.innerHTML = '';
  }
  showPage('page-detail');
}

function detailRow(label, value) {
  return '<div class="detail-row"><div class="detail-label">' + label + '</div><div class="detail-value">' + esc(value) + '</div></div>';
}

async function downloadPdf() {
  const rec = await getRecord(currentDetailId);
  if (!rec || !rec.pdfFileName) return;
  if (!(await ensureAccess())) return;
  try {
    const file = await getPdfFile(rec.pdfFileName);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    alert('文件夹中找不到对应的 PDF 文件（可能已被移动或删除）。\n请在你的文件管理器中查找：' + rec.pdfFileName);
  }
}

// ========== 新增 / 编辑 ==========
function openNewForm() {
  editingId = null;
  resetForm();
  document.getElementById('formTitle').textContent = '新增记录';
  showPage('page-form');
}

async function editRecord() {
  const rec = await getRecord(currentDetailId);
  if (!rec) return;
  editingId = rec.id;
  document.getElementById('activityName').value = rec.activityName || '';
  document.getElementById('activityDate').value = rec.activityDate || '';
  document.getElementById('location').value = rec.location || '';
  document.getElementById('content').value = rec.content || '';
  document.getElementById('hours').value = rec.hours || '';
  document.getElementById('organization').value = rec.organization || '';
  document.getElementById('remark').value = rec.remark || '';
  document.getElementById('pdfFile').value = '';
  pendingPdfChanged = false;
  const tip = document.getElementById('pdfTip');
  if (rec.pdfFileName) {
    tip.className = 'pdf-tip has';
    tip.textContent = '已有：' + originalPdfName(rec.pdfFileName) + '（可重新选择替换）';
  } else {
    tip.className = 'pdf-tip';
    tip.textContent = '未选择文件';
  }
  document.getElementById('formTitle').textContent = '编辑记录';
  showPage('page-form');
}

function onPdfChange(evt) {
  const f = evt.target.files[0];
  const tip = document.getElementById('pdfTip');
  if (f) {
    pendingPdfChanged = true;
    tip.className = 'pdf-tip has';
    tip.textContent = '已选择：' + f.name + '（保存时写入本地文件夹）';
  } else {
    pendingPdfChanged = false;
    tip.className = 'pdf-tip';
    tip.textContent = '未选择文件';
  }
}

async function saveRecord() {
  const activityName = document.getElementById('activityName').value.trim();
  const activityDate = document.getElementById('activityDate').value;
  const hours = Number(document.getElementById('hours').value);
  if (!activityName) { alert('请填写活动名称。'); return; }
  if (!activityDate) { alert('请选择活动日期。'); return; }
  if (!(hours >= 0)) { alert('请填写有效的志愿时长（不小于 0）。'); return; }

  const fileInput = document.getElementById('pdfFile');
  let pdfFileName = null;

  if (fileInput.files[0]) {
    const f = fileInput.files[0];
    if (!(await ensureAccess())) return;
    try {
      pdfFileName = await savePdfToFolder(f);
    } catch (e) {
      alert('PDF 写入文件夹失败：' + (e.message || e));
      return;
    }
    if (editingId) {
      const old = await getRecord(editingId);
      if (old && old.pdfFileName && old.pdfFileName !== pdfFileName) {
        await removePdfFile(old.pdfFileName);
      }
    }
  } else if (editingId) {
    const old = await getRecord(editingId);
    pdfFileName = old ? old.pdfFileName : null;
  }

  const now = Date.now();
  const rec = {
    id: editingId || uuid(),
    activityName: activityName,
    activityDate: activityDate,
    location: document.getElementById('location').value.trim(),
    content: document.getElementById('content').value.trim(),
    hours: hours,
    organization: document.getElementById('organization').value.trim(),
    remark: document.getElementById('remark').value.trim(),
    pdfFileName: pdfFileName,
    createAt: editingId ? (await getRecord(editingId)).createAt || now : now,
    updateAt: now
  };
  await addRecord(rec);
  resetForm();
  showPage('page-home');
  scheduleSync(); // 保存后自动同步到云端
}

function resetForm() {
  ['activityName', 'activityDate', 'location', 'content', 'hours', 'organization', 'remark'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('pdfFile').value = '';
  pendingPdfChanged = false;
  const tip = document.getElementById('pdfTip');
  tip.className = 'pdf-tip';
  tip.textContent = '未选择文件，保存时写入本地文件夹';
  document.getElementById('formTitle').textContent = '新增记录';
}

// ========== 删除 ==========
async function deleteRecord() {
  const rec = await getRecord(currentDetailId);
  if (!rec) return;
  const msg = rec.pdfFileName
    ? '确定删除这条记录吗？\n文件夹中的 PDF 文件「' + originalPdfName(rec.pdfFileName) + '」也会一并删除。'
    : '确定删除这条记录吗？';
  if (!confirm(msg)) return;
  if (rec.pdfFileName && dirHandle) {
    await removePdfFile(rec.pdfFileName);
  }
  // 删除改为打墓碑标记（保留记录骨架），供多设备同步删除
  rec.deleted = true;
  rec.deleteAt = Date.now();
  await addRecord(rec);
  currentDetailId = null;
  showPage('page-home');
  scheduleSync(); // 删除后自动同步到云端
}

// ========== 备份 ==========
async function exportBackup() {
  const all = await getAllRecords();
  const list = all.filter((r) => !r.deleted); // 导出时排除已删除的墓碑记录
  if (list.length === 0) { alert('暂无记录可导出。'); return; }
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '志愿台账备份_' + timestamp() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  alert('已导出文字记录备份。\n注意：PDF 文件本身在本地文件夹中，请连同文件夹一起备份（复制文件夹即可）。');
}

// ========== 导出 Excel ==========
async function exportExcel() {
  const all = await getAllRecords();
  const list = all.filter((r) => !r.deleted);
  if (list.length === 0) { alert('暂无记录可导出。'); return; }
  sortRecordsDesc(list); // 与首页一致：日期从最新到最旧

  const rows = [['活动名称', '活动日期', '地点', '服务内容', '志愿时长（小时）', '主办单位', '备注']];
  list.forEach((r) => {
    rows.push([
      r.activityName || '',
      r.activityDate || '',
      r.location || '',
      r.content || '',
      Number(r.hours) || 0,
      r.organization || '',
      r.remark || ''
    ]);
  });
  // 合计行
  const total = Math.round(list.reduce((s, r) => s + (Number(r.hours) || 0), 0) * 10) / 10;
  rows.push(['合计', '', '', '', total, '', '']);

  try {
    const data = makeXlsx(rows, '志愿记录');
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '志愿记录_' + timestamp() + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    alert('导出 Excel 失败：' + (e.message || e));
  }
}

async function importBackup(evt) {
  const f = evt.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('备份文件格式不正确');
    let count = 0;
    for (const r of arr) {
      if (!r.id) continue;
      await addRecord({
        id: r.id,
        activityName: r.activityName || '',
        activityDate: r.activityDate || '',
        location: r.location || '',
        content: r.content || '',
        hours: Number(r.hours) || 0,
        organization: r.organization || '',
        remark: r.remark || '',
        pdfFileName: r.pdfFileName || null,
        createAt: r.createAt || Date.now(),
        updateAt: r.updateAt || Date.now(),
        deleted: r.deleted || false,
        deleteAt: r.deleteAt || null
      });
      count++;
    }
    loadList();
    alert('导入完成，共 ' + count + ' 条。\n若记录关联的 PDF 文件仍在你选择的文件夹中，即可正常下载；否则需重新上传。');
  } catch (e) {
    alert('导入失败：' + e.message);
  } finally {
    evt.target.value = '';
  }
}

// ========== 初始化 ==========
function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (!supportsFileSystemAccess()) {
    document.getElementById('fsWarn').style.display = 'block';
  }
  loadDirHandleFromDB();
  loadList();
  initSync(); // 云同步：刷新状态并静默拉取
}

document.addEventListener('DOMContentLoaded', init);
