// ============================================================
// 員工打卡系統 — Firebase Compat 版 v3
// 新增：員工自助註冊、離職日管理
// 符合台灣勞動基準法第30條出勤記錄規定
// ============================================================

// Firebase compat SDK 已在 index.html body 底部載入
// 使用全域 firebase 物件，不需要 import 語法

// ============================================================
// Firebase 初始化
// ============================================================
var firebaseConfig = {
  apiKey: "AIzaSyDRBU7-cKEw0Je9YsjR1Ruj1GFd-6i56mY",
  authDomain: "cusineclock.firebaseapp.com",
  projectId: "cusineclock",
  storageBucket: "cusineclock.firebasestorage.app",
  messagingSenderId: "1065273909620",
  appId: "1:1065273909620:web:58ab926235611f77c4cc21"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
var db   = firebase.firestore();
var auth = firebase.auth();

// ============================================================
// 全域狀態
// ============================================================
var currentUser     = null;
var currentUserData = null;
var currentPosition = null;
var clockTimer      = null;

var IDLE_TIMEOUT = 3 * 60 * 1000;
var WARN_BEFORE  = 60 * 1000;
var idleTimer      = null;
var warnTimer      = null;
var countdownTimer = null;

var sysSettings = {
  locationName: '公司總部',
  lat: 24.142500,
  lng: 120.643300,
  radius: 50,
  workStart: '09:00',
  workEnd: '18:00',
  shifts: [
    { name: '早班', start: '09:00', end: '14:00' },
    { name: '晚班', start: '17:00', end: '22:00' }
  ]
};

// 目前員工選擇的班別索引
var currentShiftIndex = 0;

// ============================================================
// 頁面載入
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  restoreRememberedEmail();
  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  // 設定到職日預設為今天
  var today = fmtDate(new Date());
  var regJoin = document.getElementById('regJoinDate');
  if (regJoin) regJoin.value = today;
});

function restoreRememberedEmail() {
  var saved = localStorage.getItem('rememberedEmail');
  if (saved) {
    var emailInput  = document.getElementById('loginEmail');
    var rememberChk = document.getElementById('rememberEmail');
    if (emailInput)  emailInput.value    = saved;
    if (rememberChk) rememberChk.checked = true;
  }
}

// ============================================================
// 畫面切換
// ============================================================
function showLoginScreen() {
  showScreen('loginScreen');
}

function showRegisterScreen() {
  // 清空表單
  ['regName','regEmail','regPwd','regPwd2','regDept','regPhone'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('regJoinDate').value = fmtDate(new Date());
  document.getElementById('regError').style.display = 'none';
  showScreen('registerScreen');
}

window.showLoginScreen    = showLoginScreen;
window.showRegisterScreen = showRegisterScreen;

// ============================================================
// 自動登出（3 分鐘無操作）
// ============================================================
var IDLE_EVENTS = ['mousemove','mousedown','keydown','touchstart','scroll','click'];

function startIdleWatch() {
  IDLE_EVENTS.forEach(function(e) {
    document.addEventListener(e, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

function stopIdleWatch() {
  IDLE_EVENTS.forEach(function(e) {
    document.removeEventListener(e, resetIdleTimer);
  });
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  clearInterval(countdownTimer);
  hideAutoLogoutBar();
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  clearInterval(countdownTimer);
  hideAutoLogoutBar();
  warnTimer = setTimeout(function() { showAutoLogoutBar(); }, IDLE_TIMEOUT - WARN_BEFORE);
  idleTimer = setTimeout(function() {
    stopIdleWatch();
    showToast('因閒置超過 3 分鐘，已自動登出', 'error');
    handleLogout();
  }, IDLE_TIMEOUT);
}

function showAutoLogoutBar() {
  var bar = document.getElementById('autoLogoutBar');
  if (!bar) return;
  var sec = 60;
  document.getElementById('autoLogoutCountdown').textContent = sec;
  bar.classList.add('show');
  countdownTimer = setInterval(function() {
    sec--;
    var el = document.getElementById('autoLogoutCountdown');
    if (el) el.textContent = sec;
    if (sec <= 0) clearInterval(countdownTimer);
  }, 1000);
}

function hideAutoLogoutBar() {
  var bar = document.getElementById('autoLogoutBar');
  if (bar) bar.classList.remove('show');
  clearInterval(countdownTimer);
}

window.resetIdleTimer = resetIdleTimer;

// ============================================================
// 登入 / 登出
// ============================================================
function handleLogin() {
  var email    = document.getElementById('loginEmail').value.trim();
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  var btn      = document.getElementById('loginBtn');

  if (!email || !password) { showError(errEl, '請輸入電子郵件與密碼'); return; }

  var rememberChk = document.getElementById('rememberEmail');
  if (rememberChk && rememberChk.checked) {
    localStorage.setItem('rememberedEmail', email);
  } else {
    localStorage.removeItem('rememberedEmail');
  }

  btn.textContent = '登入中...';
  btn.disabled    = true;
  errEl.style.display = 'none';
  showScreen('loadingScreen');

  auth.signInWithEmailAndPassword(email, password)
    .then(function(cred) {
      currentUser = cred.user;
      return loadUserData(cred.user.uid);
    })
    .then(function() {
      return loadSettings();
    })
    .then(function() {
      btn.textContent = '登入';
      btn.disabled    = false;
      if (currentUserData && currentUserData.role === 'admin') {
        showScreen('adminScreen');
        initAdmin();
      } else {
        showScreen('employeeScreen');
        initEmployee();
      }
      startIdleWatch();
    })
    .catch(function(e) {
      btn.textContent = '登入';
      btn.disabled    = false;
      showScreen('loginScreen');
      var msg = (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found')
        ? '帳號或密碼錯誤，請重新輸入'
        : e.code === 'auth/too-many-requests'
        ? '登入失敗次數過多，請稍後再試'
        : e.code === 'auth/invalid-email'
        ? '電子郵件格式不正確'
        : '登入失敗，請確認網路連線（' + e.code + '）';
      showError(errEl, msg);
    });
}

// ============================================================
// 員工自助註冊
// ============================================================
function handleRegister() {
  var name     = document.getElementById('regName').value.trim();
  var email    = document.getElementById('regEmail').value.trim();
  var pwd      = document.getElementById('regPwd').value;
  var pwd2     = document.getElementById('regPwd2').value;
  var dept     = document.getElementById('regDept').value.trim();
  var joinDate = document.getElementById('regJoinDate').value;
  var phone    = document.getElementById('regPhone').value.trim();
  var errEl    = document.getElementById('regError');
  var btn      = document.getElementById('regBtn');

  // 驗證
  if (!name)     { showError(errEl, '請填寫姓名'); return; }
  if (!email)    { showError(errEl, '請填寫電子郵件'); return; }
  if (!pwd)      { showError(errEl, '請設定密碼'); return; }
  if (pwd.length < 6) { showError(errEl, '密碼至少需要 6 個字元'); return; }
  if (pwd !== pwd2)   { showError(errEl, '兩次密碼輸入不一致'); return; }
  if (!joinDate) { showError(errEl, '請填寫到職日期'); return; }

  errEl.style.display = 'none';
  btn.textContent = '註冊中...';
  btn.disabled    = true;

  var newUid = null;

  auth.createUserWithEmailAndPassword(email, pwd)
    .then(function(cred) {
      newUid = cred.user.uid;
      return db.collection('users').doc(newUid).set({
        name:      name,
        email:     email,
        dept:      dept,
        joinDate:  joinDate,
        leaveDate: '',
        phone:     phone,
        role:      'employee',
        active:    true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function() {
      // 註冊成功後直接登入
      currentUser = auth.currentUser;
      return loadUserData(newUid);
    })
    .then(function() {
      return loadSettings();
    })
    .then(function() {
      btn.textContent = '完成註冊並登入';
      btn.disabled    = false;
      showToast('註冊成功！歡迎 ' + name, 'success');
      showScreen('employeeScreen');
      initEmployee();
      startIdleWatch();
    })
    .catch(function(e) {
      btn.textContent = '完成註冊並登入';
      btn.disabled    = false;
      var msg = e.code === 'auth/email-already-in-use'
        ? '此電子郵件已被使用，請直接登入或使用其他信箱'
        : e.code === 'auth/invalid-email'
        ? '電子郵件格式不正確'
        : e.code === 'auth/weak-password'
        ? '密碼強度不足，請使用更複雜的密碼'
        : '註冊失敗：' + e.message;
      showError(errEl, msg);
    });
}

window.handleRegister = handleRegister;

function handleLogout() {
  stopIdleWatch();
  if (clockTimer) clearInterval(clockTimer);
  currentUser     = null;
  currentUserData = null;
  auth.signOut().then(function() {
    showScreen('loginScreen');
    restoreRememberedEmail();
  }).catch(function() {
    showScreen('loginScreen');
    restoreRememberedEmail();
  });
}

window.handleLogin  = handleLogin;
window.handleLogout = handleLogout;

// ============================================================
// 載入用戶資料
// ============================================================
function loadUserData(uid) {
  return db.collection('users').doc(uid).get().then(function(snap) {
    currentUserData = snap.exists
      ? Object.assign({ uid: uid }, snap.data())
      : { uid: uid, name: '用戶', role: 'employee', dept: '' };
  }).catch(function() {
    currentUserData = { uid: uid, name: '用戶', role: 'employee', dept: '' };
  });
}

// ============================================================
// 載入系統設定
// ============================================================
function loadSettings() {
  return db.collection('settings').doc('main').get().then(function(snap) {
    if (snap.exists) sysSettings = Object.assign({}, sysSettings, snap.data());
  }).catch(function() { /* 使用預設值 */ });
}

// ============================================================
// 員工打卡畫面
// ============================================================
function initEmployee() {
  document.getElementById('userNameEmp').textContent   = currentUserData.name || '員工';
  document.getElementById('userDeptEmp').textContent   = currentUserData.dept || '';
  document.getElementById('userAvatarEmp').textContent = (currentUserData.name || '員')[0];
  startClock();
  getGPS();
  initShiftSelector();
  loadTodayStatus();
  populateMonthSel('myMonthSel');
}

// 初始化班別選擇器
function initShiftSelector() {
  var shifts = sysSettings.shifts || [];
  var bar    = document.getElementById('shiftSelectBar');
  var sel    = document.getElementById('empShiftSel');
  if (!sel) return;

  sel.innerHTML = '';
  if (shifts.length <= 1) {
    // 只有一個班別時自動套用，不顯示選擇列
    bar.style.display = 'none';
    currentShiftIndex = 0;
  } else {
    // 多班別：顯示選擇列
    bar.style.display = 'flex';
    shifts.forEach(function(s, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.name + '（' + s.start + ' – ' + s.end + '）';
      sel.appendChild(opt);
    });
    // 依目前時間自動建議班別
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var best = 0;
    var bestDiff = Infinity;
    shifts.forEach(function(s, i) {
      var parts = s.start.split(':');
      var startMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      var diff = Math.abs(nowMin - startMin);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    sel.value = best;
    currentShiftIndex = best;
  }
}

function onShiftChange() {
  var sel = document.getElementById('empShiftSel');
  currentShiftIndex = parseInt(sel.value) || 0;
  // 更新狀態列的班別提示
  var shift = (sysSettings.shifts || [])[currentShiftIndex];
  var sub = document.getElementById('statusSub');
  if (sub && shift) sub.textContent = '班別：' + shift.name + '（' + shift.start + ' – ' + shift.end + '）';
}

window.onShiftChange = onShiftChange;

function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  var now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('zh-TW', { hour12: false });
  document.getElementById('currentDate').textContent = now.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  var dd = document.getElementById('dashDate');
  if (dd) dd.textContent = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getGPS() {
  var gpsText = document.getElementById('gpsText');
  var gpsIcon = document.getElementById('gpsIcon');
  if (!navigator.geolocation) { gpsText.textContent = '裝置不支援 GPS 定位'; return; }
  gpsText.textContent = '正在取得位置...';
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      currentPosition = pos.coords;
      var dist = calcDist(pos.coords.latitude, pos.coords.longitude, sysSettings.lat, sysSettings.lng);
      if (dist <= sysSettings.radius) {
        gpsText.textContent = '位置確認：' + sysSettings.locationName + '（' + Math.round(dist) + ' 公尺）';
        gpsText.style.color = '#2ec4b6';
        gpsIcon.textContent = '✅';
      } else {
        gpsText.textContent = '位置不符：距工作地點 ' + Math.round(dist) + ' 公尺（允許 ' + sysSettings.radius + ' 公尺）';
        gpsText.style.color = '#e63946';
        gpsIcon.textContent = '⚠️';
      }
    },
    function() {
      currentPosition = null;
      gpsText.textContent = '無法取得位置（請開啟定位權限）';
      gpsText.style.color = '#f77f00';
      gpsIcon.textContent = '❓';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function loadTodayStatus() {
  var today = fmtDate(new Date());
  var recId = today + '_' + currentUser.uid;
  db.collection('records').doc(recId).get().then(function(snap) {
    var rec    = snap.exists ? snap.data() : null;
    var icon   = document.getElementById('statusIcon');
    var text   = document.getElementById('statusText');
    var sub    = document.getElementById('statusSub');
    var btnIn  = document.getElementById('btnIn');
    var btnOut = document.getElementById('btnOut');
    var summary = document.getElementById('todaySummary');
    if (!rec) {
      icon.textContent = '📋'; text.textContent = '今日尚未打卡';
      var shifts = sysSettings.shifts || [];
      var curShift = shifts[currentShiftIndex];
      if (curShift) {
        sub.textContent = '班別：' + curShift.name + '（' + curShift.start + ' – ' + curShift.end + '）';
      } else {
        sub.textContent = '上班時間：' + (sysSettings.workStart || '09:00');
      }
      btnIn.disabled = false; btnOut.disabled = true;
      summary.style.display = 'none';
    } else if (rec.clockIn && !rec.clockOut) {
      icon.textContent = '✅'; text.textContent = '已上班打卡';
      sub.textContent = '上班時間：' + rec.clockIn;
      btnIn.disabled = true; btnOut.disabled = false;
      showSummary(rec.clockIn, null);
    } else if (rec.clockIn && rec.clockOut) {
      icon.textContent = '🏠'; text.textContent = '今日已完成打卡';
      sub.textContent = '工作時數：' + calcHoursStr(rec.clockIn, rec.clockOut);
      btnIn.disabled = true; btnOut.disabled = true;
      showSummary(rec.clockIn, rec.clockOut);
    }
  });
}

function showSummary(clockIn, clockOut) {
  document.getElementById('todaySummary').style.display = 'block';
  document.getElementById('sumIn').textContent    = clockIn  || '--:--';
  document.getElementById('sumOut').textContent   = clockOut || '--:--';
  document.getElementById('sumHours').textContent = clockIn && clockOut ? calcHoursStr(clockIn, clockOut) : '--';
}

function doClock(type) {
  var now    = new Date();
  var today  = fmtDate(now);
  var timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  var recId  = today + '_' + currentUser.uid;

  if (currentPosition) {
    var dist = calcDist(currentPosition.latitude, currentPosition.longitude, sysSettings.lat, sysSettings.lng);
    if (dist > sysSettings.radius) {
      if (!confirm('您目前距工作地點 ' + Math.round(dist) + ' 公尺，超出允許範圍（' + sysSettings.radius + ' 公尺）。\n確定要繼續打卡嗎？')) return;
    }
  } else {
    if (!confirm('無法取得 GPS 位置，確定要繼續打卡嗎？\n（此次打卡將標記為無位置資訊）')) return;
  }

  var btn = type === 'in' ? document.getElementById('btnIn') : document.getElementById('btnOut');
  btn.disabled = true;
  btn.querySelector('.punch-label').textContent = '打卡中...';

  var shifts = sysSettings.shifts || [];
  var curShift = shifts[currentShiftIndex] || { name: '正常班', start: sysSettings.workStart || '09:00', end: sysSettings.workEnd || '18:00' };

  var promise;
  if (type === 'in') {
    promise = db.collection('records').doc(recId).set({
      empId:     currentUser.uid,
      empName:   currentUserData.name,
      empDept:   currentUserData.dept || '',
      date:      today,
      clockIn:   timeStr,
      clockOut:  null,
      shiftName: curShift.name,
      shiftStart: curShift.start,
      shiftEnd:   curShift.end,
      lat: currentPosition ? currentPosition.latitude  : null,
      lng: currentPosition ? currentPosition.longitude : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    promise = db.collection('records').doc(recId).update({
      clockOut:   timeStr,
      clockOutAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  promise.then(function() {
    showToast((type === 'in' ? '上班' : '下班') + '打卡成功！' + timeStr, 'success');
    loadTodayStatus();
  }).catch(function() {
    showToast('打卡失敗，請確認網路連線', 'error');
    btn.disabled = false;
  }).finally(function() {
    btn.querySelector('.punch-label').textContent = type === 'in' ? '上班打卡' : '下班打卡';
  });
}

window.doClock = doClock;

function loadMyRecords() {
  var month = document.getElementById('myMonthSel').value;
  db.collection('records')
    .where('empId', '==', currentUser.uid)
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date')
    .get()
    .then(function(snap) {
      var records   = snap.docs.map(function(d) { return d.data(); });
      var container = document.getElementById('myRecordsList');
      if (records.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#aaa;padding:16px;">本月無出勤記錄</p>';
        return;
      }
      var html = '<table class="dt"><thead><tr><th>日期</th><th>上班</th><th>下班</th><th>工時</th></tr></thead><tbody>';
      records.forEach(function(r) {
        var h = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        html += '<tr><td>' + r.date + '</td><td>' + (r.clockIn||'--') + '</td><td>' + (r.clockOut||'--') + '</td><td>' + h + '</td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    });
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

function loadDashboard() {
  var today = fmtDate(new Date());
  Promise.all([
    db.collection('users').get(),
    db.collection('records').where('date', '==', today).get()
  ]).then(function(results) {
    var empSnap = results[0], recSnap = results[1];
    var employees = empSnap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee' && e.active !== false; });
    var records = recSnap.docs.map(function(d) { return d.data(); });
    var present = 0, left = 0;
    employees.forEach(function(e) {
      var r = records.find(function(r) { return r.empId === e.id; });
      if (r && r.clockIn && r.clockOut) left++;
      else if (r && r.clockIn) present++;
    });
    document.getElementById('kpiTotal').textContent   = employees.length;
    document.getElementById('kpiPresent').textContent = present;
    document.getElementById('kpiLeft').textContent    = left;
    document.getElementById('kpiAbsent').textContent  = employees.length - present - left;
    var html = '';
    employees.forEach(function(e) {
      var r  = records.find(function(r) { return r.empId === e.id; });
      var ci = (r && r.clockIn)  || '--';
      var co = (r && r.clockOut) || '--';
      var h  = (r && r.clockIn && r.clockOut) ? calcHoursStr(r.clockIn, r.clockOut) : '--';
      var badge = '<span class="badge badge-gray">未打卡</span>';
      if (r && r.clockIn && r.clockOut) badge = '<span class="badge badge-blue">已下班</span>';
      else if (r && r.clockIn)          badge = '<span class="badge badge-green">上班中</span>';
      html += '<tr><td><strong>' + e.name + '</strong></td><td>' + (e.dept||'') + '</td><td>' + ci + '</td><td>' + co + '</td><td>' + h + '</td><td>' + badge + '</td></tr>';
    });
    document.getElementById('dashBody').innerHTML = html || '<tr><td colspan="6" class="empty-row">今日尚無出勤記錄</td></tr>';
  });
}

function loadRecords() {
  var month     = document.getElementById('recMonth').value;
  var empFilter = document.getElementById('recEmp').value;
  db.collection('records')
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date', 'desc')
    .get()
    .then(function(snap) {
      var records = snap.docs.map(function(d) { return d.data(); });
      if (empFilter) records = records.filter(function(r) { return r.empId === empFilter; });
      var html = '';
      records.forEach(function(r) {
        var h    = r.clockIn && r.clockOut ? calcHoursStr(r.clockIn, r.clockOut) : '--';
        var loc  = r.lat ? (r.lat.toFixed(4) + ', ' + r.lng.toFixed(4)) : '無位置';
        var shift = r.shiftName ? ('<span class="badge badge-blue">' + r.shiftName + '</span>') : '<span class="badge badge-gray">未指定</span>';
        html += '<tr><td>' + r.date + '</td><td>' + (r.empName||'') + '</td><td>' + (r.empDept||'') + '</td><td>' + shift + '</td><td>' + (r.clockIn||'--') + '</td><td>' + (r.clockOut||'--') + '</td><td>' + h + '</td><td style="font-size:12px;color:#999;">' + loc + '</td><td>' + (r.note||'') + '</td></tr>';
      });
      document.getElementById('recBody').innerHTML = html || '<tr><td colspan="9" class="empty-row">本月無出勤記錄</td></tr>';
    });
}

function loadEmployeeList() {
  db.collection('users').get().then(function(snap) {
    var employees = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee'; });

    // 更新篩選下拉
    ['recEmp','expEmp'].forEach(function(selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var cur = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      employees.filter(function(e) { return e.active !== false; })
               .forEach(function(e) { sel.add(new Option(e.name, e.id)); });
      sel.value = cur;
    });

    var html = '';
    employees.forEach(function(e) {
      var isActive  = e.active !== false;
      var hasLeave  = e.leaveDate && e.leaveDate !== '';
      // 狀態判斷：有離職日 → 已離職；停用 → 停用；其他 → 在職
      var statusBadge;
      if (hasLeave) {
        statusBadge = '<span class="badge badge-orange">已離職</span>';
      } else if (!isActive) {
        statusBadge = '<span class="badge badge-gray">停用</span>';
      } else {
        statusBadge = '<span class="badge badge-green">在職</span>';
      }
      html += '<tr>'
        + '<td><strong>' + e.name + '</strong></td>'
        + '<td>' + (e.email||'') + '</td>'
        + '<td>' + (e.dept||'') + '</td>'
        + '<td>' + (e.joinDate||'—') + '</td>'
        + '<td>' + (e.leaveDate || '—') + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td class="emp-actions">'
        + '<button class="btn btn-sm btn-outline" onclick="openEditEmpModal(\'' + e.id + '\')">編輯</button> '
        + '<button class="btn btn-sm btn-danger" onclick="toggleEmpStatus(\'' + e.id + '\',' + isActive + ')">' + (isActive ? '停用' : '啟用') + '</button>'
        + '</td></tr>';
    });
    document.getElementById('empBody').innerHTML = html || '<tr><td colspan="7" class="empty-row">尚無員工資料</td></tr>';
  });
}

function createEmployee() {
  var name     = document.getElementById('newEmpName').value.trim();
  var email    = document.getElementById('newEmpEmail').value.trim();
  var pwd      = document.getElementById('newEmpPwd').value;
  var dept     = document.getElementById('newEmpDept').value.trim();
  var joinDate = document.getElementById('newEmpJoin').value;
  var errEl    = document.getElementById('addEmpError');
  if (!name || !email || !pwd) { showError(errEl, '請填寫姓名、電子郵件與密碼'); return; }
  if (pwd.length < 6)          { showError(errEl, '密碼至少需要 6 個字元'); return; }
  errEl.style.display = 'none';
  auth.createUserWithEmailAndPassword(email, pwd)
    .then(function(cred) {
      return db.collection('users').doc(cred.user.uid).set({
        name: name, email: email, dept: dept,
        joinDate: joinDate, leaveDate: '',
        phone: '',
        role: 'employee', active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function() {
      showToast('員工 ' + name + ' 建立成功', 'success');
      closeModal('addEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) {
      var msg = e.code === 'auth/email-already-in-use' ? '此電子郵件已被使用'
        : e.code === 'auth/invalid-email' ? '電子郵件格式不正確'
        : '建立失敗：' + e.message;
      showError(errEl, msg);
    });
}

// ============================================================
// 編輯員工（含離職日）
// ============================================================
function openEditEmpModal(uid) {
  db.collection('users').doc(uid).get().then(function(snap) {
    if (!snap.exists) { showToast('找不到員工資料', 'error'); return; }
    var data = snap.data();
    document.getElementById('editEmpUid').value   = uid;
    document.getElementById('editEmpName').value  = data.name  || '';
    document.getElementById('editEmpDept').value  = data.dept  || '';
    document.getElementById('editEmpJoin').value  = data.joinDate  || '';
    document.getElementById('editEmpLeave').value = data.leaveDate || '';
    document.getElementById('editEmpError').style.display = 'none';
    document.getElementById('editEmpModal').style.display = 'flex';
  });
}

function saveEditEmployee() {
  var uid      = document.getElementById('editEmpUid').value;
  var name     = document.getElementById('editEmpName').value.trim();
  var dept     = document.getElementById('editEmpDept').value.trim();
  var joinDate = document.getElementById('editEmpJoin').value;
  var leaveDate = document.getElementById('editEmpLeave').value;
  var errEl    = document.getElementById('editEmpError');

  if (!name) { showError(errEl, '請填寫員工姓名'); return; }
  errEl.style.display = 'none';

  // 如果有離職日，自動設為停用
  var updateData = {
    name: name,
    dept: dept,
    joinDate: joinDate,
    leaveDate: leaveDate
  };
  if (leaveDate) {
    updateData.active = false;
  }

  db.collection('users').doc(uid).update(updateData)
    .then(function() {
      showToast('員工資料已更新', 'success');
      closeModal('editEmpModal');
      loadEmployeeList();
    })
    .catch(function(e) {
      showError(errEl, '更新失敗：' + e.message);
    });
}

window.openEditEmpModal  = openEditEmpModal;
window.saveEditEmployee  = saveEditEmployee;

function toggleEmpStatus(uid, currentActive) {
  db.collection('users').doc(uid).update({ active: !currentActive })
    .then(function() {
      showToast('員工狀態已更新', 'success');
      loadEmployeeList();
    });
}

function loadSettingsForm() {
  document.getElementById('sLocName').value = sysSettings.locationName;
  document.getElementById('sLat').value     = sysSettings.lat;
  document.getElementById('sLng').value     = sysSettings.lng;
  document.getElementById('sRadius').value  = sysSettings.radius;
  renderShiftRows();
}

// 班別列表渲染
function renderShiftRows() {
  var container = document.getElementById('shiftsContainer');
  if (!container) return;
  var shifts = sysSettings.shifts || [{ name: '正常班', start: '09:00', end: '18:00' }];
  var html = '';
  shifts.forEach(function(s, i) {
    html += '<div class="shift-row" id="shiftRow_' + i + '">';
    html += '<div class="shift-row-name"><input type="text" class="shift-input" id="sShiftName_' + i + '" value="' + s.name + '" placeholder="班別名稱"></div>';
    html += '<div class="shift-row-time">';
    html += '<span class="shift-time-label">上班</span><input type="time" class="shift-input" id="sShiftStart_' + i + '" value="' + s.start + '">';
    html += '<span class="shift-time-sep">–</span>';
    html += '<span class="shift-time-label">下班</span><input type="time" class="shift-input" id="sShiftEnd_' + i + '" value="' + s.end + '">';
    html += '</div>';
    if (shifts.length > 1) {
      html += '<button class="btn btn-sm btn-danger shift-del-btn" onclick="removeShiftRow(' + i + ')">刪除</button>';
    } else {
      html += '<span class="shift-del-placeholder"></span>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
}

// 新增班別列
function addShiftRow() {
  var shifts = sysSettings.shifts || [];
  shifts.push({ name: '新班別', start: '09:00', end: '18:00' });
  sysSettings.shifts = shifts;
  renderShiftRows();
}

// 刪除班別列
function removeShiftRow(index) {
  var shifts = sysSettings.shifts || [];
  if (shifts.length <= 1) { showToast('至少需保留一個班別', 'error'); return; }
  shifts.splice(index, 1);
  sysSettings.shifts = shifts;
  renderShiftRows();
}

// 儲存班別設定
function saveShiftSettings() {
  var container = document.getElementById('shiftsContainer');
  var rows = container.querySelectorAll('.shift-row');
  var shifts = [];
  var valid = true;
  rows.forEach(function(row, i) {
    var name  = document.getElementById('sShiftName_'  + i).value.trim();
    var start = document.getElementById('sShiftStart_' + i).value;
    var end   = document.getElementById('sShiftEnd_'   + i).value;
    if (!name)  { showToast('班別名稱不能為空', 'error'); valid = false; return; }
    if (!start || !end) { showToast('請填寫完整的上下班時間', 'error'); valid = false; return; }
    shifts.push({ name: name, start: start, end: end });
  });
  if (!valid || shifts.length === 0) return;
  sysSettings.shifts    = shifts;
  // 對齊舊欄位（相容性）
  sysSettings.workStart = shifts[0].start;
  sysSettings.workEnd   = shifts[0].end;
  db.collection('settings').doc('main').set(sysSettings, { merge: true })
    .then(function() {
      showToast('班別設定已儲存', 'success');
      renderShiftRows();
    })
    .catch(function() { showToast('儲存失敗，請確認網路連線', 'error'); });
}

window.addShiftRow    = addShiftRow;
window.removeShiftRow = removeShiftRow;
window.saveShiftSettings = saveShiftSettings;

function saveGPSSettings() {
  var settings = {
    locationName: document.getElementById('sLocName').value,
    lat:    parseFloat(document.getElementById('sLat').value),
    lng:    parseFloat(document.getElementById('sLng').value),
    radius: parseInt(document.getElementById('sRadius').value),
  };
  if (isNaN(settings.lat) || isNaN(settings.lng)) { showToast('請輸入有效的座標', 'error'); return; }
  sysSettings = Object.assign({}, sysSettings, settings);
  db.collection('settings').doc('main').set(sysSettings, { merge: true })
    .then(function() { showToast('GPS 設定已儲存', 'success'); })
    .catch(function() { showToast('儲存失敗，請確認網路連線', 'error'); });
}

function saveTimeSettings() {
  // 已被 saveShiftSettings 取代，保留相容
  saveShiftSettings();
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast('裝置不支援 GPS', 'error'); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    document.getElementById('sLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('sLng').value = pos.coords.longitude.toFixed(6);
    showToast('已取得目前位置座標', 'success');
  }, function() { showToast('無法取得位置，請確認定位權限', 'error'); });
}

// ============================================================
// 報表匯出
// ============================================================
function exportAttendanceCSV() {
  var month     = document.getElementById('expMonth').value;
  var empFilter = document.getElementById('expEmp').value;
  db.collection('records')
    .where('date', '>=', month + '-01')
    .where('date', '<=', month + '-31')
    .orderBy('date')
    .get()
    .then(function(snap) {
      var records = snap.docs.map(function(d) { return d.data(); });
      if (empFilter) records = records.filter(function(r) { return r.empId === empFilter; });
      var csv = '\uFEFF日期,員工姓名,部門,班別,上班時間,下班時間,工作時數（小時）,打卡緯度,打卡經度\n';
      records.forEach(function(r) {
        var h = r.clockIn && r.clockOut ? calcHoursDec(r.clockIn, r.clockOut).toFixed(2) : '';
        csv += r.date + ',' + (r.empName||'') + ',' + (r.empDept||'') + ',' + (r.shiftName||'') + ',' + (r.clockIn||'') + ',' + (r.clockOut||'') + ',' + h + ',' + (r.lat||'') + ',' + (r.lng||'') + '\n';
      });
      dlCSV(csv, '出勤記錄_' + month + '.csv');
      showToast('出勤報表匯出成功', 'success');
    });
}

function exportWorkStatsCSV() {
  var month = document.getElementById('expMonthStats').value;
  Promise.all([
    db.collection('users').get(),
    db.collection('records').where('date', '>=', month+'-01').where('date', '<=', month+'-31').get()
  ]).then(function(results) {
    var employees = results[0].docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(e) { return e.role === 'employee'; });
    var records  = results[1].docs.map(function(d) { return d.data(); });
    var workDays = getWorkDays(month);
    var csv = '\uFEFF員工姓名,部門,出勤天數,缺勤天數,總工時（小時）,正常工時,加班工時\n';
    employees.forEach(function(e) {
      var empRecs = records.filter(function(r) { return r.empId === e.id && r.clockIn && r.clockOut; });
      var total   = empRecs.reduce(function(s, r) { return s + calcHoursDec(r.clockIn, r.clockOut); }, 0);
      var normal  = workDays * 8;
      var ot      = Math.max(0, total - normal);
      csv += e.name + ',' + (e.dept||'') + ',' + empRecs.length + ',' + (workDays - empRecs.length) + ',' + total.toFixed(1) + ',' + normal + ',' + ot.toFixed(1) + '\n';
    });
    dlCSV(csv, '工時統計_' + month + '.csv');
    showToast('工時統計報表匯出成功', 'success');
  });
}

function dlCSV(content, filename) {
  var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ============================================================
// UI 工具
// ============================================================
function switchTab(tabName, el) {
  document.querySelectorAll('.tab-section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-link').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('tab-' + tabName).classList.add('active');
  el.classList.add('active');
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  if (tabName === 'dashboard')  loadDashboard();
  if (tabName === 'records')    loadRecords();
  if (tabName === 'employees')  loadEmployeeList();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

function openAddEmpModal() {
  document.getElementById('newEmpName').value  = '';
  document.getElementById('newEmpEmail').value = '';
  document.getElementById('newEmpPwd').value   = '123456';
  document.getElementById('newEmpDept').value  = '';
  document.getElementById('newEmpJoin').value  = fmtDate(new Date());
  document.getElementById('addEmpError').style.display = 'none';
  document.getElementById('addEmpModal').style.display = 'flex';
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeModalOverlay(id, e) { if (e.target.id === id) closeModal(id); }

function showToast(msg, type) {
  type = type || '';
  var c = document.getElementById('toastContainer');
  var t = document.createElement('div');
  t.className   = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
}

function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

function hideScreen(id) { document.getElementById(id).classList.remove('active'); }

function populateMonthSel(selId) {
  var sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '';
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    sel.add(new Option(d.getFullYear() + '年' + (d.getMonth() + 1) + '月', val));
  }
}

// ============================================================
// 計算工具
// ============================================================
function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function calcHoursDec(ci, co) {
  var ih = parseInt(ci.split(':')[0]), im = parseInt(ci.split(':')[1]);
  var oh = parseInt(co.split(':')[0]), om = parseInt(co.split(':')[1]);
  return ((oh * 60 + om) - (ih * 60 + im)) / 60;
}
function calcHoursStr(ci, co) {
  var h = calcHoursDec(ci, co);
  return Math.floor(h) + ' 時 ' + Math.round((h % 1) * 60) + ' 分';
}
function calcDist(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function getWorkDays(monthStr) {
  var parts = monthStr.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]);
  var count = 0;
  for (var d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    var day = new Date(y, m - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// 暴露給 HTML onclick
window.switchTab          = switchTab;
window.toggleSidebar      = toggleSidebar;
window.openAddEmpModal    = openAddEmpModal;
window.createEmployee     = createEmployee;
window.toggleEmpStatus    = toggleEmpStatus;
window.closeModal         = closeModal;
window.closeModalOverlay  = closeModalOverlay;
window.loadMyRecords      = loadMyRecords;
window.loadRecords        = loadRecords;
window.saveGPSSettings    = saveGPSSettings;
window.saveTimeSettings   = saveTimeSettings;
window.saveShiftSettings  = saveShiftSettings;
window.addShiftRow        = addShiftRow;
window.removeShiftRow     = removeShiftRow;
window.useMyLocation      = useMyLocation;
window.exportAttendanceCSV  = exportAttendanceCSV;
window.exportWorkStatsCSV   = exportWorkStatsCSV;
