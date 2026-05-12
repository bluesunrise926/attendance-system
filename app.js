// ============================================================
// 員工打卡系統 — Firebase 整合版主程式
// 符合台灣勞動基準法第30條出勤記錄規定
// ============================================================

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
// 初始化：監聽登入狀態（含超時保護）
// ============================================================

// 超時保護：若 10 秒內 Firebase 未回應，直接跳到登入頁
const authTimeout = setTimeout(() => {
  const loading = document.getElementById('loadingScreen');
  if (loading && loading.classList.contains('active')) {
    hideScreen('loadingScreen');
    showScreen('loginScreen');
  }
}, 10000);

onAuthStateChanged(auth, async (user) => {
  clearTimeout(authTimeout);
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
});

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
    const msg = e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
      ? '帳號或密碼錯誤，請重新輸入'
      : e.code === 'auth/too-many-requests'
      ? '登入失敗次數過多，請稍後再試'
      : '登入失敗，請確認網路連線';
    showError(errEl, msg);
  }
}

async function handleLogout() {
  if (clockTimer) clearInterval(clockTimer);
  await signOut(auth);
}

// 讓 HTML onclick 能呼叫
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
      // 若無用戶資料，預設為員工
      currentUserData = { uid, name: '用戶', role: 'employee', dept: '' };
    }
  } catch (e) {
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
  } catch (e) { /* 使用預設值 */ }
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
  document.getElementById('currentTime').textContent =
    now.toLocaleTimeString('zh-TW', { hour12: false });
  document.getElementById('currentDate').textContent =
    now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  document.getElementById('dashDate') && (
    document.getElementById('dashDate').textContent =
      now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
  );
}

function getGPS() {
  const gpsText = document.getElementById('gpsText');
  const gpsIcon = document.getElementById('gpsIcon');
  if (!navigator.geolocation) {
    gpsText.textContent = '裝置不支援 GPS 定位';
    return;
  }
  gpsText.textContent = '正在取得位置...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPosition = pos.coords;
      const dist = calcDist(pos.coords.latitude, pos.coords.longitude, sysSettings.lat, sysSettings.lng);
      if (dist <= sysSettings.radius) {
        gpsText.textContent = `位置確認：${sysSettings.locationName}（${Math.round(dist)} 公尺）`;
        gpsText.style.color = '#2ec4b6';
        gpsIcon.textContent = '✅';
      } else {
        gpsText.textContent = `位置不符：距工作地點 ${Math.round(dist)} 公尺（允許 ${sysSettings.radius} 公尺）`;
        gpsText.style.color = '#e63946';
        gpsIcon.textContent = '⚠️';
      }
    },
    () => {
      currentPosition = null;
      gpsText.textContent = '無法取得位置（請開啟定位權限）';
      gpsText.style.color = '#f77f00';
      gpsIcon.textContent = '❓';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function loadTodayStatus() {
  const today = fmtDate(new Date());
  const recId = `${today}_${currentUser.uid}`;
  const snap = await getDoc(doc(db, 'records', recId));
  const rec = snap.exists() ? snap.data() : null;

  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  const sub = document.getElementById('statusSub');
  const btnIn = document.getElementById('btnIn');
  const btnOut = document.getElementById('btnOut');
  const summary = document.getElementById('todaySummary');

  if (!rec) {
    icon.textContent = '📋'; text.textContent = '今日尚未打卡';
    sub.textContent = `正常上班時間：${sysSettings.workStart}`;
    btnIn.disabled = false; btnOut.disabled = true;
    summary.style.display = 'none';
  } else if (rec.clockIn && !rec.clockOut) {
    icon.textContent = '✅'; text.textContent = '已上班打卡';
    sub.textContent = `上班時間：${rec.clockIn}`;
    btnIn.disabled = true; btnOut.disabled = false;
    showSummary(rec.clockIn, null);
  } else if (rec.clockIn && rec.clockOut) {
    icon.textContent = '🏠'; text.textContent = '今日已完成打卡';
    sub.textContent = `工作時數：${calcHoursStr(rec.clockIn, rec.clockOut)}`;
    btnIn.disabled = true; btnOut.disabled = true;
    showSummary(rec.clockIn, rec.clockOut);
  }
}

function showSummary(clockIn, clockOut) {
  document.getElementById('todaySummary').style.display = 'block';
  document.getElementById('sumIn').textContent = clockIn || '--:--';
  document.getElementById('sumOut').textContent = clockOut || '--:--';
  document.getElementById('sumHours').textContent = clockIn && clockOut ? calcHoursStr(clockIn, clockOut) : '--';
}

async function doClock(type) {
  const now = new Date();
  const today = fmtDate(now);
  const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const recId = `${today}_${currentUser.uid}`;

  // GPS 驗證
  if (currentPosition) {
    const dist = calcDist(currentPosition.latitude, currentPosition.longitude, sysSettings.lat, sysSettings.lng);
    if (dist > sysSettings.radius) {
      if (!confirm(`您目前距工作地點 ${Math.round(dist)} 公尺，超出允許範圍（${sysSettings.radius} 公尺）。\n確定要繼續打卡嗎？`)) return;
    }
  } else {
    if (!confirm('無法取得 GPS 位置，確定要繼續打卡嗎？\n（此次打卡將標記為無位置資訊）')) return;
  }

  const btn = type === 'in' ? document.getElementById('btnIn') : document.getElementById('btnOut');
  btn.disabled = true;
  btn.querySelector('.punch-label').textContent = '打卡中...';

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
    btn.disabled = false;
  }
  btn.querySelector('.punch-label').textContent = type === 'in' ? '上班打卡' : '下班打卡';
}

window.doClock = doClock;

async function loadMyRecords() {
  const month = document.getElementById('myMonthSel').value;
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
  if (records.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px;">本月無出勤記錄</p>';
    return;
  }
  let html = '<table class="dt"><thead><tr><th>日期</th><th>上班</th><th>下班</th><th>工時</th></tr></thead><tbody>';
  records.forEach(r => {
    const h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
    html += `<tr><td>${r.date}</td><td>${r.clockIn||'--'}</td><td>${r.clockOut||'--'}</td><td>${h}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

window.showMyRecords = function() {
  document.getElementById('myRecordsModal').style.display = 'flex';
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
  populateMonthSel('expMonthStats');
  loadDashboard();
  loadEmployeeList();
  loadSettingsForm();
}

async function loadDashboard() {
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

  document.getElementById('kpiTotal').textContent = employees.length;
  document.getElementById('kpiPresent').textContent = present;
  document.getElementById('kpiLeft').textContent = left;
  document.getElementById('kpiAbsent').textContent = employees.length - present - left;

  let html = '';
  employees.forEach(e => {
    const r = records.find(r => r.empId === e.id);
    const ci = r?.clockIn || '--';
    const co = r?.clockOut || '--';
    const h = r?.clockIn && r?.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
    let badge = '<span class="badge badge-gray">未打卡</span>';
    if (r?.clockIn && r?.clockOut) badge = '<span class="badge badge-blue">已下班</span>';
    else if (r?.clockIn) badge = '<span class="badge badge-green">上班中</span>';
    html += `<tr><td><strong>${e.name}</strong></td><td>${e.dept||''}</td><td>${ci}</td><td>${co}</td><td>${h}</td><td>${badge}</td></tr>`;
  });
  document.getElementById('dashBody').innerHTML = html || '<tr><td colspan="6" class="empty-row">今日尚無出勤記錄</td></tr>';
}

async function loadRecords() {
  const month = document.getElementById('recMonth').value;
  const empFilter = document.getElementById('recEmp').value;

  let q = query(
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
    html += `<tr>
      <td>${r.date}</td><td>${r.empName||''}</td><td>${r.empDept||''}</td>
      <td>${r.clockIn||'--'}</td><td>${r.clockOut||'--'}</td><td>${h}</td>
      <td style="font-size:12px;color:#999;">${loc}</td><td>${r.note||''}</td>
    </tr>`;
  });
  document.getElementById('recBody').innerHTML = html || '<tr><td colspan="8" class="empty-row">本月無出勤記錄</td></tr>';
}

async function loadEmployeeList() {
  const snap = await getDocs(collection(db, 'users'));
  const employees = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');

  // 同步更新篩選下拉
  ['recEmp', 'expEmp'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    employees.forEach(e => {
      const opt = new Option(e.name, e.id);
      sel.add(opt);
    });
    sel.value = cur;
  });

  let html = '';
  employees.forEach(e => {
    html += `<tr>
      <td><strong>${e.name}</strong></td>
      <td>${e.email||''}</td>
      <td>${e.dept||''}</td>
      <td>${e.joinDate||''}</td>
      <td>${e.active !== false ? '<span class="badge badge-green">在職</span>' : '<span class="badge badge-gray">停用</span>'}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="toggleEmpStatus('${e.id}', ${e.active !== false})">
          ${e.active !== false ? '停用' : '啟用'}
        </button>
      </td>
    </tr>`;
  });
  document.getElementById('empBody').innerHTML = html || '<tr><td colspan="6" class="empty-row">尚無員工資料</td></tr>';
}

async function createEmployee() {
  const name = document.getElementById('newEmpName').value.trim();
  const email = document.getElementById('newEmpEmail').value.trim();
  const pwd = document.getElementById('newEmpPwd').value;
  const dept = document.getElementById('newEmpDept').value.trim();
  const joinDate = document.getElementById('newEmpJoin').value;
  const errEl = document.getElementById('addEmpError');

  if (!name || !email || !pwd) {
    showError(errEl, '請填寫姓名、電子郵件與密碼');
    return;
  }
  if (pwd.length < 6) {
    showError(errEl, '密碼至少需要 6 個字元');
    return;
  }

  errEl.style.display = 'none';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name, email, dept, joinDate, role: 'employee', active: true,
      createdAt: serverTimestamp()
    });
    // 重新以管理員身份登入（因 createUser 會切換登入狀態）
    await signInWithEmailAndPassword(auth, currentUser.email, '');
    showToast(`員工 ${name} 建立成功`, 'success');
    closeModal('addEmpModal');
    loadEmployeeList();
  } catch (e) {
    const msg = e.code === 'auth/email-already-in-use' ? '此電子郵件已被使用'
      : e.code === 'auth/invalid-email' ? '電子郵件格式不正確'
      : `建立失敗：${e.message}`;
    showError(errEl, msg);
  }
}

async function toggleEmpStatus(uid, currentActive) {
  await updateDoc(doc(db, 'users', uid), { active: !currentActive });
  showToast(`員工狀態已更新`, 'success');
  loadEmployeeList();
}

function loadSettingsForm() {
  document.getElementById('sLocName').value = sysSettings.locationName;
  document.getElementById('sLat').value = sysSettings.lat;
  document.getElementById('sLng').value = sysSettings.lng;
  document.getElementById('sRadius').value = sysSettings.radius;
  document.getElementById('sWorkStart').value = sysSettings.workStart;
  document.getElementById('sWorkEnd').value = sysSettings.workEnd;
}

async function saveGPSSettings() {
  const settings = {
    locationName: document.getElementById('sLocName').value,
    lat: parseFloat(document.getElementById('sLat').value),
    lng: parseFloat(document.getElementById('sLng').value),
    radius: parseInt(document.getElementById('sRadius').value),
  };
  if (isNaN(settings.lat) || isNaN(settings.lng)) {
    showToast('請輸入有效的座標', 'error');
    return;
  }
  sysSettings = { ...sysSettings, ...settings };
  await setDoc(doc(db, 'settings', 'main'), sysSettings);
  showToast('GPS 設定已儲存', 'success');
}

async function saveTimeSettings() {
  sysSettings.workStart = document.getElementById('sWorkStart').value;
  sysSettings.workEnd = document.getElementById('sWorkEnd').value;
  await setDoc(doc(db, 'settings', 'main'), sysSettings);
  showToast('上下班時間設定已儲存', 'success');
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast('裝置不支援 GPS', 'error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('sLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('sLng').value = pos.coords.longitude.toFixed(6);
    showToast('已取得目前位置座標', 'success');
  }, () => showToast('無法取得位置，請確認定位權限', 'error'));
}

// ============================================================
// 報表匯出
// ============================================================
async function exportAttendanceCSV() {
  const month = document.getElementById('expMonth').value;
  const empFilter = document.getElementById('expEmp').value;

  const q = query(
    collection(db, 'records'),
    where('date', '>=', month + '-01'),
    where('date', '<=', month + '-31'),
    orderBy('date')
  );
  const snaps = await getDocs(q);
  let records = snaps.docs.map(d => d.data());
  if (empFilter) records = records.filter(r => r.empId === empFilter);

  let csv = '\uFEFF日期,員工姓名,部門,上班時間,下班時間,工作時數（小時）,打卡緯度,打卡經度\n';
  records.forEach(r => {
    const h = r.clockIn && r.clockOut ? calcHoursDec(r.clockIn, r.clockOut).toFixed(2) : '';
    csv += `${r.date},${r.empName||''},${r.empDept||''},${r.clockIn||''},${r.clockOut||''},${h},${r.lat||''},${r.lng||''}\n`;
  });
  dlCSV(csv, `出勤記錄_${month}.csv`);
  showToast('出勤報表匯出成功', 'success');
}

async function exportWorkStatsCSV() {
  const month = document.getElementById('expMonthStats').value;
  const empSnap = await getDocs(collection(db, 'users'));
  const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');

  const q = query(
    collection(db, 'records'),
    where('date', '>=', month + '-01'),
    where('date', '<=', month + '-31')
  );
  const recSnap = await getDocs(q);
  const records = recSnap.docs.map(d => d.data());

  const workDays = getWorkDays(month);
  let csv = '\uFEFF員工姓名,部門,出勤天數,缺勤天數,總工時（小時）,正常工時,加班工時\n';
  employees.forEach(e => {
    const empRecs = records.filter(r => r.empId === e.id && r.clockIn && r.clockOut);
    const total = empRecs.reduce((s, r) => s + calcHoursDec(r.clockIn, r.clockOut), 0);
    const normal = workDays * 8;
    const ot = Math.max(0, total - normal);
    csv += `${e.name},${e.dept||''},${empRecs.length},${workDays - empRecs.length},${total.toFixed(1)},${normal},${ot.toFixed(1)}\n`;
  });
  dlCSV(csv, `工時統計_${month}.csv`);
  showToast('工時統計報表匯出成功', 'success');
}

function dlCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ============================================================
// UI 工具
// ============================================================
function switchTab(tabName, el) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');
  el.classList.add('active');
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'records') loadRecords();
  if (tabName === 'employees') loadEmployeeList();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function openAddEmpModal() {
  document.getElementById('newEmpName').value = '';
  document.getElementById('newEmpEmail').value = '';
  document.getElementById('newEmpPwd').value = '123456';
  document.getElementById('newEmpDept').value = '';
  document.getElementById('newEmpJoin').value = fmtDate(new Date());
  document.getElementById('addEmpError').style.display = 'none';
  document.getElementById('addEmpModal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function closeModalOverlay(id, e) {
  if (e.target.id === id) closeModal(id);
}

function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function hideScreen(id) {
  document.getElementById(id).classList.remove('active');
}

function populateMonthSel(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '';
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = `${d.getFullYear()}年${d.getMonth()+1}月`;
    sel.add(new Option(label, val));
  }
}

// ============================================================
// 計算工具
// ============================================================
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function calcHoursDec(ci, co) {
  const [ih, im] = ci.split(':').map(Number);
  const [oh, om] = co.split(':').map(Number);
  return ((oh*60+om) - (ih*60+im)) / 60;
}

function calcHoursStr(ci, co) {
  const h = calcHoursDec(ci, co);
  return `${Math.floor(h)} 時 ${Math.round((h % 1) * 60)} 分`;
}

function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getWorkDays(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  let count = 0;
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const day = new Date(y, m-1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// 暴露給 HTML onclick
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.openAddEmpModal = openAddEmpModal;
window.createEmployee = createEmployee;
window.toggleEmpStatus = toggleEmpStatus;
window.closeModal = closeModal;
window.closeModalOverlay = closeModalOverlay;
window.loadMyRecords = loadMyRecords;
window.loadRecords = loadRecords;
window.saveGPSSettings = saveGPSSettings;
window.saveTimeSettings = saveTimeSettings;
window.useMyLocation = useMyLocation;
window.exportAttendanceCSV = exportAttendanceCSV;
window.exportWorkStatsCSV = exportWorkStatsCSV;
