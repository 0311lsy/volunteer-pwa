'use strict';
// ========== GitHub 云同步 ==========
// 原理：把全部记录（含删除墓碑）合并后写入私有仓库的 records.json
// 冲突策略：按 updateAt 最后写入优先；删除用墓碑标记跨设备传播

const GH_REPO = '0311lsy/volunteer-data';
const GH_PATH = 'records.json';
const GH_TOKEN_KEY = 'gh_sync_token';
const GH_LASTSYNC_KEY = 'gh_sync_last';

function ghToken() {
  return localStorage.getItem(GH_TOKEN_KEY) || '';
}

function ghConfigure() {
  const cur = ghToken();
  const input = prompt(
    '粘贴 GitHub 令牌（Token）。\n' +
    '令牌需对私有仓库 ' + GH_REPO + ' 有「Contents 读写」权限。\n' +
    '令牌只保存在本设备浏览器中，不会上传。\n\n' +
    (cur ? '当前已配置令牌（' + cur.slice(0, 7) + '...）。输入新值可更换，留空并确定则清除：' : '尚未配置。请先在 GitHub 生成令牌后粘贴到这里：'),
    cur
  );
  if (input === null) return; // 取消
  if (input.trim() === '') {
    localStorage.removeItem(GH_TOKEN_KEY);
    alert('已清除本设备的同步令牌。');
  } else {
    localStorage.setItem(GH_TOKEN_KEY, input.trim());
    alert('令牌已保存。点击「立即同步」开始第一次同步。');
  }
  updateSyncStatus();
}

function ghIsConfigured() {
  return ghToken() !== '';
}

function ghLastSyncText() {
  const t = Number(localStorage.getItem(GH_LASTSYNC_KEY) || 0);
  if (!t) return '从未同步';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return '上次同步 ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function updateSyncStatus(state) {
  const box = document.getElementById('syncStatus');
  if (!box) return;
  if (!ghIsConfigured()) {
    box.className = 'folder-card warning';
    box.innerHTML =
      '<div class="folder-row">' +
        '<div><div class="folder-title">云同步未配置</div>' +
        '<div class="folder-sub">配置后手机和电脑的记录可互相同步（PDF 文件仍存本地）</div></div>' +
        '<button onclick="ghConfigure()" class="btn btn-blue btn-sm">配置</button>' +
      '</div>';
    return;
  }
  const cls = state === 'error' ? 'warning' : 'ok';
  const sub = state === 'syncing' ? '正在同步…' : ghLastSyncText();
  box.className = 'folder-card ' + cls;
  box.innerHTML =
    '<div class="folder-row">' +
      '<div><div class="folder-title">云同步已开启（' + GH_REPO + '）</div>' +
      '<div class="folder-sub">' + sub + '</div></div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
        '<button onclick="ghSyncNow()" class="btn btn-blue btn-sm">立即同步</button>' +
        '<button onclick="ghConfigure()" class="btn btn-slate btn-sm">设置</button>' +
      '</div>' +
    '</div>';
}

// ---------- base64（UTF-8 安全） ----------
function bytesToBase64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ---------- GitHub API ----------
async function ghFetchRemote() {
  const res = await fetch(
    'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_PATH,
    { headers: { 'Authorization': 'Bearer ' + ghToken(), 'Accept': 'application/vnd.github+json' } }
  );
  if (res.status === 404) return { data: null, sha: null };
  if (res.status === 401) throw new Error('令牌无效或已过期，请点「设置」重新配置');
  if (!res.ok) throw new Error('GitHub API 错误：HTTP ' + res.status);
  const json = await res.json();
  let parsed = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(json.content || '')));
  } catch (e) { parsed = null; }
  return { data: parsed, sha: json.sha };
}

async function ghPushRemote(obj, sha) {
  const body = {
    message: '同步志愿记录 ' + new Date().toLocaleString('zh-CN'),
    content: bytesToBase64(new TextEncoder().encode(JSON.stringify(obj, null, 2)))
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_PATH,
    {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + ghToken(),
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  if (res.status === 401) throw new Error('令牌无效或无写入权限（需要 Contents 读写）');
  if (res.status === 409) throw new Error('云端刚被其他设备更新过，请再点一次同步');
  if (!res.ok) throw new Error('写入 GitHub 失败：HTTP ' + res.status);
}

// ---------- 合并逻辑 ----------
function mergeRecords(localList, remoteData) {
  const remoteRecords = (remoteData && Array.isArray(remoteData.records)) ? remoteData.records : [];
  const remoteDeleted = new Set((remoteData && Array.isArray(remoteData.deletedIds)) ? remoteData.deletedIds : []);

  const map = new Map();
  // 远端记录入 map
  remoteRecords.forEach((r) => { if (r && r.id) map.set(r.id, r); });
  // 本地记录按 updateAt 覆盖（LWW）
  localList.forEach((r) => {
    if (!r || !r.id) return;
    const old = map.get(r.id);
    if (!old || (Number(r.updateAt) || 0) >= (Number(old.updateAt) || 0)) map.set(r.id, r);
  });

  // 墓碑集合 = 远端墓碑 ∪ 本地墓碑
  const deletedIds = new Set(remoteDeleted);
  localList.forEach((r) => { if (r && r.deleted && r.id) deletedIds.add(r.id); });
  map.forEach((r) => { if (r.deleted) deletedIds.add(r.id); });
  // 墓碑优先：任何在墓碑集合中的记录一律标记删除
  map.forEach((r, id) => {
    if (deletedIds.has(id) && !r.deleted) {
      r.deleted = true;
      r.deleteAt = Date.now();
    }
  });

  const records = [];
  map.forEach((r) => records.push(r));
  return { records: records, deletedIds: Array.from(deletedIds), syncedAt: Date.now() };
}

// ---------- 同步入口 ----------
let ghSyncing = false;

async function ghSync(silent) {
  if (ghSyncing) return;
  if (!ghIsConfigured()) {
    if (!silent) ghConfigure();
    return;
  }
  ghSyncing = true;
  if (!silent) updateSyncStatus('syncing');
  try {
    const localList = await getAllRecords(); // 含墓碑
    const { data, sha } = await ghFetchRemote();
    const merged = mergeRecords(localList, data);

    // 全量写回本地（含墓碑）
    for (const r of merged.records) await addRecord(r);

    // 远端内容与合并结果不同（或有本地改动）才推送
    const remoteSig = JSON.stringify(data ? { r: data.records, d: data.deletedIds } : null);
    const mergedSig = JSON.stringify({ r: merged.records, d: merged.deletedIds });
    const localSig = JSON.stringify({ r: localList, d: Array.from(new Set(localList.filter((r) => r.deleted).map((r) => r.id))) });
    if (remoteSig !== mergedSig || localSig !== mergedSig) {
      await ghPushRemote(merged, sha);
    }

    localStorage.setItem(GH_LASTSYNC_KEY, String(Date.now()));
    updateSyncStatus();
    if (!silent) {
      const alive = merged.records.filter((r) => !r.deleted).length;
      alert('同步完成，当前共 ' + alive + ' 条记录。');
    }
    if (typeof loadList === 'function') loadList();
  } catch (e) {
    updateSyncStatus('error');
    if (!silent) alert('同步失败：' + (e.message || e));
    else console.warn('自动同步失败：', e);
  } finally {
    ghSyncing = false;
  }
}

function ghSyncNow() { ghSync(false); }

// 保存/删除后自动同步（3 秒防抖，静默）
let _syncTimer = null;
function scheduleSync() {
  if (!ghIsConfigured()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => ghSync(true), 3000);
}

function initSync() {
  updateSyncStatus();
  if (ghIsConfigured()) ghSync(true); // 打开页面静默拉取一次
}
