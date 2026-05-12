// ============================================================
// 員工打卡系統 — 單一檔案整合版（Firebase 內嵌）
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============================================================
// Firebase 設定（請確認這裡的設定與您的 Firebase 專案相符）
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDRBU7-cKEw0Je9YsjR1Ruj1GFd-6i56mY",
  authDomain: "cusineclock.firebaseapp.com",
  projectId: "cusineclock",
  storageBucket: "cusineclock.firebasestorage.app",
  messagingSenderId: "1065273909620",
  appId: "1:1065273909620:web:58ab926235611f77c4cc21"
};

let app, db, auth;

// ============================================================
// 初始化 Firebase（含錯誤捕捉）
// ============================================================
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  console.log("Firebase 初始化成功");
} catch (e) {
  console.error("Firebase 初始化失敗：", e);
  setLoadingMsg("Firebase 初始化失敗，請重新整理頁面");
  setTimeout(() => {
    hideScreen('loadingScreen');
    showScreen('loginScreen');
  }, 3000);
}

// ============================================================
// 全域狀態
// ============================================================
let currentUser = null;
let currentUserData = null;
let currentPosition = null;
let clockTimer = null;
let sysSettings = {
  locationName: '公司總部',
  lat: 25.033964,
  lng: 121.564468,
  radius: 200,
  workStart: '09:00',
  workEnd: '18:00'
};

// ============================================================
// 工具函式
// ============================================================
function hideScreen(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}
function showScreen(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function setLoadingMsg(msg) {
  const el = document.getElementById('loadingMsg');
  if (el) el.textContent = msg;
}
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calcHoursStr(inStr, outStr) {
  if (!inStr || !outStr) return '--';
  const [ih, im] = inStr.split(':').map(Number);
  const [oh, om] = outStr.split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im);
  if (mins <= 0) return '--';
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}
function populateMonthSel(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const now = new Date();
  sel.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const opt = new Option(`${d.getFullYear()}年${d.getMonth() + 1}月`, val);
    sel.add(opt);
  }
}

// ============================================================
// 監聽登入狀態（含超時保護）
// ============================================================
const authTimeout = setTimeout(() => {
  const loading = document.getElementById('loadingScreen');
  if (loading && loading.classList.contains('active')) {
    console.warn("Firebase Auth 超時，跳至登入頁");
    setLoadingMsg("連線逾時，請重新整理");
    hideScreen('loadingScreen');
    showScreen('loginScreen');
  }
}, 8000);

if (auth) {
  onAuthStateChanged(auth, async (user) => {
    clearTimeout(authTimeout);
    setLoadingMsg("載入用戶資料...");
    if (user) {
      currentUser = user;
      try {
        await loadUserData(user.uid);
        await loadSettings();
      } catch (e) {
        console.warn('載入資料失敗，使用預設值', e);
      }
      hideScreen('loadingScreen');
      if (currentUserData && currentUserData.role === 'admin') {
        showScreen('adminScreen');
        initAdmin();
      } else {
        showScreen('employeeScreen');
        initEmployee();
      }
    } else {
      currentUser = null;
      currentUserData = null;
      hideScreen('loadingScreen');
      showScreen('loginScreen');
    }
  }, (error) => {
    clearTimeout(authTimeout);
    console.error("Auth 監聽錯誤：", error);
    hideScreen('loadingScreen');
    showScreen('loginScreen');
  });
}

// ============================================================
// 登入 / 登出
// ============================================================
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!email || !password) {
    showError(errEl, '請輸入電子郵件與密碼');
    return;
  }

  btn.textContent = '登入中...';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    btn.textContent = '登入';
    btn.disabled = false;
    const code = e.code || '';
    const msg = (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
      ? '帳號或密碼錯誤，請重新輸入'
      : code.includes('too-many-requests')
      ? '登入失敗次數過多，請稍後再試'
      : '登入失敗：' + (e.message || '請確認網路連線');
    showError(errEl, msg);
  }
}

async function handleLogout() {
  if (clockTimer) clearInterval(clockTimer);
  try { await signOut(auth); } catch (e) { console.error(e); }
}

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

// ============================================================
// 載入用戶資料
// ============================================================
async function loadUserData(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      currentUserData = { uid, ...snap.data() };
    } else {
      currentUserData = { uid, name: '用戶', role: 'employee', dept: '' };
    }
  } catch (e) {
    console.error('loadUserData error:', e);
    currentUserData = { uid, name: '用戶', role: 'employee', dept: '' };
  }
}

// ============================================================
// 載入系統設定
// ============================================================
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'main'));
    if (snap.exists()) {
      sysSettings = { ...sysSettings, ...snap.data() };
    }
  } catch (e) { console.warn('loadSettings error:', e); }
}

// ============================================================
// 員工打卡畫面
// ============================================================
function initEmployee() {
  document.getElementById('userNameEmp').textContent = currentUserData.name || '員工';
  document.getElementById('userDeptEmp').textContent = currentUserData.dept || '';
  document.getElementById('userAvatarEmp').textContent = (currentUserData.name || '員')[0];
  startClock();
  getGPS();
  loadTodayStatus();
  populateMonthSel('myMonthSel');
}

function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const t = document.getElementById('currentTime');
  const d = document.getElementById('currentDate');
  const dd = document.getElementById('dashDate');
  if (t) t.textContent = now.toLocaleTimeString('zh-TW', { hour12: false });
  if (d) d.textContent = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  if (dd) dd.textContent = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getGPS() {
  const gpsText = document.getElementById('gpsText');
  const gpsIcon = document.getElementById('gpsIcon');
  if (!navigator.geolocation) {
    if (gpsText) gpsText.textContent = '裝置不支援 GPS 定位';
    return;
  }
  if (gpsText) gpsText.textContent = '正在取得位置...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPosition = pos.coords;
      const dist = calcDist(pos.coords.latitude, pos.coords.longitude, sysSettings.lat, sysSettings.lng);
      if (dist <= sysSettings.radius) {
        if (gpsText) { gpsText.textContent = `位置確認：${sysSettings.locationName}（${Math.round(dist)} 公尺）`; gpsText.style.color = '#2ec4b6'; }
        if (gpsIcon) gpsIcon.textContent = '✅';
      } else {
        if (gpsText) { gpsText.textContent = `位置不符：距工作地點 ${Math.round(dist)} 公尺`; gpsText.style.color = '#e63946'; }
        if (gpsIcon) gpsIcon.textContent = '⚠️';
      }
    },
    () => {
      currentPosition = null;
      if (gpsText) { gpsText.textContent = '無法取得位置（請開啟定位權限）'; gpsText.style.color = '#f77f00'; }
      if (gpsIcon) gpsIcon.textContent = '❓';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function loadTodayStatus() {
  const today = fmtDate(new Date());
  const recId = `${today}_${currentUser.uid}`;
  try {
    const snap = await getDoc(doc(db, 'records', recId));
    const rec = snap.exists() ? snap.data() : null;
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const btnIn = document.getElementById('btnIn');
    const btnOut = document.getElementById('btnOut');
    const summary = document.getElementById('todaySummary');

    if (!rec) {
      if (icon) icon.textContent = '📋';
      if (text) text.textContent = '今日尚未打卡';
      if (sub) sub.textContent = `正常上班時間：${sysSettings.workStart}`;
      if (btnIn) btnIn.disabled = false;
      if (btnOut) btnOut.disabled = true;
      if (summary) summary.style.display = 'none';
    } else if (rec.clockIn && !rec.clockOut) {
      if (icon) icon.textContent = '✅';
      if (text) text.textContent = '已上班打卡';
      if (sub) sub.textContent = `上班時間：${rec.clockIn}`;
      if (btnIn) btnIn.disabled = true;
      if (btnOut) btnOut.disabled = false;
      showSummary(rec.clockIn, null);
    } else if (rec.clockIn && rec.clockOut) {
      if (icon) icon.textContent = '🏠';
      if (text) text.textContent = '今日已完成打卡';
      if (sub) sub.textContent = `工作時數：${calcHoursStr(rec.clockIn, rec.clockOut)}`;
      if (btnIn) btnIn.disabled = true;
      if (btnOut) btnOut.disabled = true;
      showSummary(rec.clockIn, rec.clockOut);
    }
  } catch (e) {
    console.error('loadTodayStatus error:', e);
  }
}

function showSummary(clockIn, clockOut) {
  const s = document.getElementById('todaySummary');
  if (s) s.style.display = 'block';
  const si = document.getElementById('sumIn');
  const so = document.getElementById('sumOut');
  const sh = document.getElementById('sumHours');
  if (si) si.textContent = clockIn || '--:--';
  if (so) so.textContent = clockOut || '--:--';
  if (sh) sh.textContent = clockIn && clockOut ? calcHoursStr(clockIn, clockOut) : '--';
}

async function doClock(type) {
  const now = new Date();
  const today = fmtDate(now);
  const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const recId = `${today}_${currentUser.uid}`;

  if (currentPosition) {
    const dist = calcDist(currentPosition.latitude, currentPosition.longitude, sysSettings.lat, sysSettings.lng);
    if (dist > sysSettings.radius) {
      if (!confirm(`您目前距工作地點 ${Math.round(dist)} 公尺，超出允許範圍（${sysSettings.radius} 公尺）。\n確定要繼續打卡嗎？`)) return;
    }
  } else {
    if (!confirm('無法取得 GPS 位置，確定要繼續打卡嗎？')) return;
  }

  const btn = document.getElementById(type === 'in' ? 'btnIn' : 'btnOut');
  if (btn) { btn.disabled = true; const lbl = btn.querySelector('.punch-label'); if (lbl) lbl.textContent = '打卡中...'; }

  try {
    if (type === 'in') {
      await setDoc(doc(db, 'records', recId), {
        empId: currentUser.uid,
        empName: currentUserData.name,
        empDept: currentUserData.dept || '',
        date: today,
        clockIn: timeStr,
        clockOut: null,
        lat: currentPosition ? currentPosition.latitude : null,
        lng: currentPosition ? currentPosition.longitude : null,
        createdAt: serverTimestamp()
      });
      showToast(`上班打卡成功！${timeStr}`, 'success');
    } else {
      await updateDoc(doc(db, 'records', recId), {
        clockOut: timeStr,
        clockOutAt: serverTimestamp()
      });
      showToast(`下班打卡成功！${timeStr}`, 'success');
    }
    loadTodayStatus();
  } catch (e) {
    showToast('打卡失敗，請確認網路連線', 'error');
    if (btn) btn.disabled = false;
  }
  if (btn) { const lbl = btn.querySelector('.punch-label'); if (lbl) lbl.textContent = type === 'in' ? '上班打卡' : '下班打卡'; }
}

window.doClock = doClock;

async function loadMyRecords() {
  const sel = document.getElementById('myMonthSel');
  if (!sel) return;
  const month = sel.value;
  try {
    const q = query(
      collection(db, 'records'),
      where('empId', '==', currentUser.uid),
      where('date', '>=', month + '-01'),
      where('date', '<=', month + '-31'),
      orderBy('date')
    );
    const snaps = await getDocs(q);
    const records = snaps.docs.map(d => d.data());
    const container = document.getElementById('myRecordsList');
    if (!container) return;
    if (records.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px;">本月無出勤記錄</p>';
      return;
    }
    let html = '<table class="dt"><thead><tr><th>日期</th><th>上班</th><th>下班</th><th>工時</th></tr></thead><tbody>';
    records.forEach(r => {
      const h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
      html += `<tr><td>${r.date}</td><td>${r.clockIn || '--'}</td><td>${r.clockOut || '--'}</td><td>${h}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    console.error('loadMyRecords error:', e);
  }
}

window.showMyRecords = function () {
  const m = document.getElementById('myRecordsModal');
  if (m) m.style.display = 'flex';
  loadMyRecords();
};
window.loadMyRecords = loadMyRecords;

// ============================================================
// 管理員後台
// ============================================================
function initAdmin() {
  updateClock();
  setInterval(updateClock, 1000);
  populateMonthSel('recMonth');
  populateMonthSel('expMonth');
  loadDashboard();
  loadEmployeeList();
  loadSettingsForm();
}

async function loadDashboard() {
  try {
    const today = fmtDate(new Date());
    const [empSnap, recSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(query(collection(db, 'records'), where('date', '==', today)))
    ]);
    const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');
    const records = recSnap.docs.map(d => d.data());
    let present = 0, left = 0;
    employees.forEach(e => {
      const r = records.find(r => r.empId === e.id);
      if (r && r.clockIn && r.clockOut) left++;
      else if (r && r.clockIn) present++;
    });
    const kpiTotal = document.getElementById('kpiTotal');
    const kpiPresent = document.getElementById('kpiPresent');
    const kpiLeft = document.getElementById('kpiLeft');
    const kpiAbsent = document.getElementById('kpiAbsent');
    if (kpiTotal) kpiTotal.textContent = employees.length;
    if (kpiPresent) kpiPresent.textContent = present;
    if (kpiLeft) kpiLeft.textContent = left;
    if (kpiAbsent) kpiAbsent.textContent = employees.length - present - left;

    let html = '';
    employees.forEach(e => {
      const r = records.find(r => r.empId === e.id);
      const ci = r?.clockIn || '--';
      const co = r?.clockOut || '--';
      const h = r?.clockIn && r?.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
      let badge = '<span class="badge badge-gray">未打卡</span>';
      if (r?.clockIn && r?.clockOut) badge = '<span class="badge badge-blue">已下班</span>';
      else if (r?.clockIn) badge = '<span class="badge badge-green">上班中</span>';
      html += `<tr><td><strong>${e.name}</strong></td><td>${e.dept || ''}</td><td>${ci}</td><td>${co}</td><td>${h}</td><td>${badge}</td></tr>`;
    });
    const dashBody = document.getElementById('dashBody');
    if (dashBody) dashBody.innerHTML = html || '<tr><td colspan="6" class="empty-row">今日尚無出勤記錄</td></tr>';
  } catch (e) {
    console.error('loadDashboard error:', e);
  }
}

window.loadDashboard = loadDashboard;

async function loadRecords() {
  const recMonth = document.getElementById('recMonth');
  const recEmp = document.getElementById('recEmp');
  if (!recMonth) return;
  const month = recMonth.value;
  const empFilter = recEmp ? recEmp.value : '';
  try {
    const q = query(
      collection(db, 'records'),
      where('date', '>=', month + '-01'),
      where('date', '<=', month + '-31'),
      orderBy('date', 'desc')
    );
    const snaps = await getDocs(q);
    let records = snaps.docs.map(d => d.data());
    if (empFilter) records = records.filter(r => r.empId === empFilter);
    let html = '';
    records.forEach(r => {
      const h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
      const loc = r.lat ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : '無位置';
      html += `<tr><td>${r.date}</td><td>${r.empName || ''}</td><td>${r.empDept || ''}</td><td>${r.clockIn || '--'}</td><td>${r.clockOut || '--'}</td><td>${h}</td><td style="font-size:12px;color:#999;">${loc}</td><td>${r.note || ''}</td></tr>`;
    });
    const recBody = document.getElementById('recBody');
    if (recBody) recBody.innerHTML = html || '<tr><td colspan="8" class="empty-row">本月無出勤記錄</td></tr>';
  } catch (e) {
    console.error('loadRecords error:', e);
  }
}

window.loadRecords = loadRecords;

async function loadEmployeeList() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const employees = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');
    ['recEmp', 'expEmp'].forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const cur = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      employees.forEach(e => sel.add(new Option(e.name, e.id)));
      sel.value = cur;
    });
    let html = '';
    employees.forEach(e => {
      html += `<tr>
        <td><strong>${e.name}</strong></td>
        <td>${e.email || ''}</td>
        <td>${e.dept || ''}</td>
        <td>${e.joinDate || ''}</td>
        <td>${e.active !== false ? '<span class="badge badge-green">在職</span>' : '<span class="badge badge-gray">停用</span>'}</td>
        <td><button class="btn btn-sm btn-danger" onclick="toggleEmpStatus('${e.id}', ${e.active !== false})">${e.active !== false ? '停用' : '啟用'}</button></td>
      </tr>`;
    });
    const empBody = document.getElementById('empBody');
    if (empBody) empBody.innerHTML = html || '<tr><td colspan="6" class="empty-row">尚無員工資料</td></tr>';
  } catch (e) {
    console.error('loadEmployeeList error:', e);
  }
}

async function createEmployee() {
  const name = document.getElementById('newEmpName')?.value.trim();
  const email = document.getElementById('newEmpEmail')?.value.trim();
  const pwd = document.getElementById('newEmpPwd')?.value;
  const dept = document.getElementById('newEmpDept')?.value.trim();
  const joinDate = document.getElementById('newEmpJoin')?.value;
  const errEl = document.getElementById('addEmpError');

  if (!name || !email || !pwd) { showError(errEl, '請填寫姓名、Email 與密碼'); return; }
  if (pwd.length < 6) { showError(errEl, '密碼至少需要 6 個字元'); return; }
  if (errEl) errEl.style.display = 'none';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name, email, dept: dept || '', role: 'employee',
      joinDate: joinDate || '', active: true, createdAt: serverTimestamp()
    });
    showToast(`員工 ${name} 新增成功`, 'success');
    ['newEmpName', 'newEmpEmail', 'newEmpPwd', 'newEmpDept', 'newEmpJoin'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    loadEmployeeList();
  } catch (e) {
    const msg = e.code === 'auth/email-already-in-use' ? '此 Email 已被使用' : '新增失敗：' + e.message;
    showError(errEl, msg);
  }
}

window.createEmployee = createEmployee;

async function toggleEmpStatus(uid, currentActive) {
  try {
    await updateDoc(doc(db, 'users', uid), { active: !currentActive });
    showToast(currentActive ? '已停用員工帳號' : '已啟用員工帳號', 'info');
    loadEmployeeList();
  } catch (e) {
    showToast('操作失敗', 'error');
  }
}

window.toggleEmpStatus = toggleEmpStatus;

function loadSettingsForm() {
  document.getElementById('setLocName') && (document.getElementById('setLocName').value = sysSettings.locationName);
  document.getElementById('setLat') && (document.getElementById('setLat').value = sysSettings.lat);
  document.getElementById('setLng') && (document.getElementById('setLng').value = sysSettings.lng);
  document.getElementById('setRadius') && (document.getElementById('setRadius').value = sysSettings.radius);
  document.getElementById('setWorkStart') && (document.getElementById('setWorkStart').value = sysSettings.workStart);
  document.getElementById('setWorkEnd') && (document.getElementById('setWorkEnd').value = sysSettings.workEnd);
}

async function saveSettings() {
  const settings = {
    locationName: document.getElementById('setLocName')?.value.trim() || '公司總部',
    lat: parseFloat(document.getElementById('setLat')?.value) || 25.033964,
    lng: parseFloat(document.getElementById('setLng')?.value) || 121.564468,
    radius: parseInt(document.getElementById('setRadius')?.value) || 200,
    workStart: document.getElementById('setWorkStart')?.value || '09:00',
    workEnd: document.getElementById('setWorkEnd')?.value || '18:00'
  };
  try {
    await setDoc(doc(db, 'settings', 'main'), settings);
    sysSettings = settings;
    showToast('設定儲存成功', 'success');
  } catch (e) {
    showToast('儲存失敗：' + e.message, 'error');
  }
}

window.saveSettings = saveSettings;

async function exportCSV() {
  const recMonth = document.getElementById('expMonth') || document.getElementById('recMonth');
  if (!recMonth) return;
  const month = recMonth.value;
  try {
    const q = query(
      collection(db, 'records'),
      where('date', '>=', month + '-01'),
      where('date', '<=', month + '-31'),
      orderBy('date')
    );
    const snaps = await getDocs(q);
    const records = snaps.docs.map(d => d.data());
    let csv = '\uFEFF日期,姓名,部門,上班時間,下班時間,工作時數\n';
    records.forEach(r => {
      const h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '';
      csv += `${r.date},${r.empName || ''},${r.empDept || ''},${r.clockIn || ''},${r.clockOut || ''},${h}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `出勤記錄_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('匯出失敗：' + e.message, 'error');
  }
}

window.exportCSV = exportCSV;

// ============================================================
// Tab 切換
// ============================================================
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
}

window.switchTab = switchTab;
