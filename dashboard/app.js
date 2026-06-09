/* ============================================================
   Event Booking Dashboard — Vanilla JS App (FIXED)
   ============================================================ */

"use strict";

// ─── Globals ───────────────────────────────────────────────────
var today = new Date();
var API = '/api';
var allBookings = [];
var allCustomers = [];
var allTags = [];
var calDate = new Date(today.getFullYear(), today.getMonth(), 1);
var selDate = null;
var activeTagFilter = 'all';
var chatHistoryCache = {};

document.addEventListener('DOMContentLoaded', function () {
  init();
});

// ─── Init ──────────────────────────────────────────────────────

function init() {
  // Load data
  loadData();

  // Search input
  var searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', onSearchInput);
  }

  // Booking modal save
  var saveBtn = document.getElementById('saveBookingBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveBooking);

  // Chat modal send
  var sendBtn = document.getElementById('sendChatBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
  
  var sendInput = document.getElementById('sendMsgInput');
  if (sendInput) {
    sendInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // Close modals when clicking overlay
  var modalOverlay = document.getElementById('modalOverlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function(e) {
      if (e.target === modalOverlay) closeBookingModal();
    });
  }
  
  var chatModal = document.getElementById('chatModal');
  if (chatModal) {
    chatModal.addEventListener('click', function(e) {
      if (e.target === chatModal) closeChatModal();
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function dmy(d) {
  if (!d) return '';
  var dt;
  if (typeof d === 'string') {
    var parts = d.split(/[/-]/);
    if (parts.length === 3) {
      dt = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    } else {
      dt = new Date(d + 'T00:00:00');
    }
  } else {
    dt = d;
  }
  if (isNaN(dt.getTime())) return '';
  var dd = String(dt.getDate()).padStart(2, '0');
  var mm = String(dt.getMonth() + 1).padStart(2, '0');
  var y = dt.getFullYear();
  return dd + '/' + mm + '/' + y;
}

function parseDMY(s) {
  if (!s) return null;
  var parts = s.split('/');
  if (parts.length !== 3) return null;
  var dd = parseInt(parts[0], 10);
  var mm = parseInt(parts[1], 10);
  var yyyy = parseInt(parts[2], 10);
  if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return null;
  return new Date(yyyy, mm - 1, dd);
}

function formatDateYMD(date) {
  if (!date) return '';
  var d = new Date(date);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function monthKey(year, month) {
  var m = String(month + 1).padStart(2, '0');
  return year + '-' + m;
}

function escapeHtml(s) {
  if (typeof s !== 'string') return String(s || '');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getTagColor(tagName) {
  var colors = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ];
  if (!tagName) return colors[0];
  var hash = 0;
  for (var i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function showToast(msg, type) {
  type = type || 'info';
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  if (type === 'success') el.classList.add('success');
  if (type === 'error') el.classList.add('error');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function() {
      el.className = 'toast';
    }, 300);
  }, 3000);
}

// ─── Data Loading ──────────────────────────────────────────────

async function loadData() {
  try {
    var [bRes, cRes, tRes] = await Promise.all([
      fetch(API + '/bookings'),
      fetch(API + '/chat/customers'),
      fetch(API + '/tags')
    ]);
    if (bRes.ok) { var bData = await bRes.json(); allBookings = bData.bookings || []; }
    if (cRes.ok) { var cData = await cRes.json(); allCustomers = cData.customers || []; }
    if (tRes.ok) { var tData = await tRes.json(); allTags = tData.tags || []; }
  } catch (e) {
    console.error('loadData error:', e);
    showToast('無法連線到伺服器', 'error');
  }
  renderAll();
}

async function refreshAll(btn) {
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }
  await loadData();
  if (btn) {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
  showToast('資料已更新', 'success');
}

// ─── Render All ────────────────────────────────────────────────

function renderAll() {
  renderKPI();
  renderTodayAndUpcoming();
  renderCalendar();
  renderBookingTable();
  renderAnalytics();
  renderCustomerList();
  renderTagFilter();
}

// ─── KPI Cards ────────────────────────────────────────────────

function renderKPI() {
  var todayStr = dmy(today);
  var thisMonth = allBookings.filter(function (b) {
    var d = parseDMY(b.date);
    return d && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }).length;
  var todayCount = allBookings.filter(function (b) { return b.date === todayStr; }).length;
  
  var futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  var futureStr = dmy(futureDate);
  var upcomingCount = allBookings.filter(function (b) { 
    return b.date && b.date > todayStr && b.date <= futureStr;
  }).length;
  
  var cancelledCount = allBookings.filter(function (b) {
    return (b.status || '').toLowerCase() === 'cancelled';
  }).length;

  var monthCountEl = document.getElementById('kpiMonthCount');
  var todayCountEl = document.getElementById('kpiTodayCount');
  var upcomingCountEl = document.getElementById('kpiUpcomingCount');
  var cancelledCountEl = document.getElementById('kpiCancelledCount');
  
  if (monthCountEl) monthCountEl.textContent = thisMonth;
  if (todayCountEl) todayCountEl.textContent = todayCount;
  if (upcomingCountEl) upcomingCountEl.textContent = upcomingCount;
  if (cancelledCountEl) cancelledCountEl.textContent = cancelledCount;
}

// ─── Today & Upcoming ─────────────────────────────────────────

function renderTodayAndUpcoming() {
  var container = document.getElementById('upcomingList');
  if (!container) return;

  var todayStr = dmy(today);
  var todayBookings = allBookings.filter(function (b) { return b.date === todayStr; });
  
  var futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  var futureStr = dmy(futureDate);
  var upcoming = allBookings
    .filter(function (b) { return b.date && b.date > todayStr && b.date <= futureStr; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); });

  var badge = document.getElementById('upcomingCountBadge');
  if (badge) badge.textContent = '(' + (todayBookings.length + upcoming.length) + ')';

  var html = '';
  
  if (todayBookings.length > 0) {
    html += '<div style="margin-bottom:12px"><strong>📅 今日 (' + todayStr + ')</strong></div>';
    todayBookings.forEach(function (b) { html += bookingRowHtml(b); });
  } else {
    html += '<div style="margin-bottom:12px; color:var(--text-secondary)">📅 今日 (' + todayStr + ') — 無預約</div>';
  }

  if (upcoming.length > 0) {
    html += '<div style="margin:16px 0 12px"><strong>⏳ 未來 7 天</strong></div>';
    upcoming.forEach(function (b) { html += bookingRowHtml(b); });
  } else if (todayBookings.length === 0) {
    html += '<div class="empty-state" style="margin-top:16px"><div class="big-icon">🎉</div><p>暫無即將到來的預約</p></div>';
  }

  container.innerHTML = html;
}

function bookingRowHtml(b) {
  var status = (b.status || 'confirmed').toLowerCase();
  var statusClass = status === 'cancelled' ? 'cancelled' : 'confirmed';
  var statusText = status === 'cancelled' ? '已取消' : '已確認';
  
  return '<div class="c-row" onclick="editBooking(\'' + escapeHtml(b.bookingId || '') + '\')">' +
    '<div class="c-avatar" style="background:' + getTagColor(b.eventType) + '">' + (b.eventType ? b.eventType.charAt(0) : 'E') + '</div>' +
    '<div class="c-info">' +
      '<div class="c-name">' + escapeHtml(b.eventType || '活動') + ' <span class="c-platform">' + escapeHtml(b.name || '未填寫') + '</span></div>' +
      '<div class="c-preview">' + escapeHtml(b.date || '') + ' ' + escapeHtml(b.timeFrom || '') + (b.timeTo ? ' - ' + escapeHtml(b.timeTo) : '') + ' · ' + (b.guests || 0) + '人 · ' + escapeHtml(b.location || '') + '</div>' +
    '</div>' +
    '<div class="c-meta">' +
      '<div class="c-status ' + statusClass + '"></div>' +
      '<div class="c-booking">' + statusText + '</div>' +
    '</div>' +
  '</div>';
}

// ─── Calendar ──────────────────────────────────────────────────

function renderCalendar() {
  var grid = document.getElementById('calGrid');
  var label = document.getElementById('monthLabel');
  if (!grid) return;

  var year = calDate.getFullYear();
  var month = calDate.getMonth();
  var monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  if (label) label.textContent = monthNames[month] + ' ' + year;

  var bookingMap = {};
  allBookings.forEach(function (b) {
    if (b.date) {
      if (!bookingMap[b.date]) bookingMap[b.date] = [];
      bookingMap[b.date].push(b);
    }
  });

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var todayStr = dmy(today);

  var html = '';
  var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  for (var i = 0; i < 7; i++) {
    html += '<div class="d-header">' + weekDays[i] + '</div>';
  }

  for (var i = 0; i < firstDay; i++) {
    html += '<div class="day other-month"></div>';
  }

  for (var day = 1; day <= daysInMonth; day++) {
    var dateObj = new Date(year, month, day);
    var dateStr = dmy(dateObj);
    var bookings = bookingMap[dateStr] || [];
    var isToday = dateStr === todayStr;
    var isSelected = selDate === dateStr;
    
    var cls = 'day';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';
    
    html += '<div class="' + cls + '" data-date="' + dateStr + '">' +
      '<span class="day-num">' + day + '</span>';
    if (bookings.length > 0) {
      html += '<div class="dot"></div>';
      if (bookings.length > 1) {
        html += '<div class="count-badge">' + bookings.length + '</div>';
      }
    }
    html += '</div>';
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.day:not(.other-month)').forEach(function (el) {
    el.addEventListener('click', function () {
      selDate = this.dataset.date;
      renderCalendar();
      showSelectedDayBookings(selDate);
    });
  });
}

function showSelectedDayBookings(dateStr) {
  var container = document.getElementById('selectedDayBookings');
  if (!container) return;

  var bookings = allBookings.filter(function (b) { return b.date === dateStr; });
  
  if (bookings.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  var html = '<div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border)">' +
    '<strong>📋 ' + escapeHtml(dateStr) + ' 的預約</strong>';
  bookings.forEach(function (b) { html += bookingRowHtml(b); });
  html += '</div>';
  container.innerHTML = html;
}

function prevMonth() {
  calDate.setMonth(calDate.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  calDate.setMonth(calDate.getMonth() + 1);
  renderCalendar();
}

// ─── Booking Table ─────────────────────────────────────────────

function renderBookingTable(filterText) {
  var tbody = document.getElementById('bookingTableBody');
  if (!tbody) return;

  var list = allBookings.slice();
  if (filterText) {
    var q = filterText.toLowerCase();
    list = list.filter(function (b) {
      return (b.eventType || '').toLowerCase().indexOf(q) !== -1 ||
        (b.location || '').toLowerCase().indexOf(q) !== -1 ||
        (b.name || '').toLowerCase().indexOf(q) !== -1 ||
        (b.phone || '').indexOf(q) !== -1 ||
        (b.date || '').indexOf(q) !== -1 ||
        (b.bookingId || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  list.sort(function (a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state" style="text-align:center; padding:40px">📭 找不到預約</td></tr>';
    return;
  }

  var html = '';
  list.forEach(function (b) {
    var status = (b.status || 'confirmed').toLowerCase();
    var statusClass = status === 'cancelled' ? 'cancelled' : 'confirmed';
    var statusText = status === 'cancelled' ? '已取消' : '已確認';
    
    html += '<tr>' +
      '<td>' + escapeHtml(b.bookingId || '-') + '</td>' +
      '<td>' + escapeHtml(b.date || '-') + '</td>' +
      '<td>' + escapeHtml(b.timeFrom || '') + (b.timeTo ? '-' + escapeHtml(b.timeTo) : '') + '</td>' +
      '<td><span class="event-tag ' + (b.eventType || '').toLowerCase() + '">' + escapeHtml(b.eventType || '其他') + '</span></td>' +
      '<td>' + escapeHtml(b.guests || '-') + '</td>' +
      '<td>' + escapeHtml(b.location || '-') + '</td>' +
      '<td>' + escapeHtml(b.remark || '-') + '</td>' +
      '<td>' + escapeHtml(b.name || '-') + '</td>' +
      '<td>' + escapeHtml(b.phone || '-') + '</td>' +
      '<td><span class="badge-st ' + statusClass + '">' + statusText + '</span></td>' +
      '<td><button class="btn btn-ghost btn-sm" onclick="editBooking(\'' + escapeHtml(b.bookingId) + '\')">✏️ 編輯</button></td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
}

function filterBookings() {
  var input = document.getElementById('searchInput');
  if (input) renderBookingTable(input.value);
}

function onSearchInput() {
  filterBookings();
}

// ─── Analytics Charts ──────────────────────────────────────────

function renderAnalytics() {
  renderEventTypeChart();
  renderMonthlyTrendChart();
}

function renderEventTypeChart() {
  var container = document.getElementById('eventTypeChart');
  if (!container) return;

  var counts = {};
  allBookings.forEach(function (b) {
    var type = (b.eventType || '其他').trim();
    counts[type] = (counts[type] || 0) + 1;
  });

  var entries = Object.entries(counts).sort(function (a, b) { return b[1] - a[1]; });
  var maxVal = Math.max.apply(null, entries.map(function (e) { return e[1]; }).concat([1]));

  if (!entries.length) {
    container.innerHTML = '<div class="empty-state"><div class="big-icon">📊</div><p>暫無資料</p></div>';
    return;
  }

  var html = '<div class="bar-chart">';
  entries.forEach(function (entry, idx) {
    var type = entry[0], count = entry[1];
    var pct = (count / maxVal) * 100;
    html += '<div class="bar-row">' +
      '<div class="bar-label">' + escapeHtml(type) + '</div>' +
      '<div class="bar-track"><div class="bar-fill i' + (idx % 6) + '" style="width:' + pct + '%">' + count + '</div></div>' +
    '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderMonthlyTrendChart() {
  var container = document.getElementById('monthlyTrendChart');
  if (!container) return;

  var counts = {};
  allBookings.forEach(function (b) {
    var d = parseDMY(b.date);
    if (!d) return;
    var mk = monthKey(d.getFullYear(), d.getMonth());
    counts[mk] = (counts[mk] || 0) + 1;
  });

  var sorted = Object.entries(counts).sort(function (a, b) { return a[0].localeCompare(b[0]); });
  var maxVal = Math.max.apply(null, sorted.map(function (e) { return e[1]; }).concat([1]));
  var monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state"><div class="big-icon">📈</div><p>暫無資料</p></div>';
    return;
  }

  var html = '<div class="bar-chart">';
  sorted.forEach(function (entry, idx) {
    var mk = entry[0], count = entry[1];
    var pct = (count / maxVal) * 100;
    var parts = mk.split('-');
    var label = (parts[1] ? monthNames[parseInt(parts[1], 10) - 1] : '') + ' ' + parts[0];
    html += '<div class="bar-row">' +
      '<div class="bar-label">' + escapeHtml(label) + '</div>' +
      '<div class="bar-track"><div class="bar-fill i' + (idx % 6) + '" style="width:' + pct + '%">' + count + '</div></div>' +
    '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

// ─── Booking Modal ─────────────────────────────────────────────

function openBookingModal(bookingId) {
  var overlay = document.getElementById('modalOverlay');
  if (!overlay) return;

  // Reset form
  var fields = ['Date', 'TimeFrom', 'TimeTo', 'EventType', 'Guests', 'Location', 'Remark', 'Name', 'Phone', 'Status'];
  fields.forEach(function (f) {
    var el = document.getElementById('form' + f);
    if (el) el.value = '';
  });
  
  // Set default date to today
  var dateInput = document.getElementById('formDate');
  if (dateInput) dateInput.value = formatDateYMD(today);

  if (bookingId) {
    var b = allBookings.find(function (x) { return x.bookingId === bookingId; });
    if (b) {
      var dateField = document.getElementById('formDate');
      if (dateField && b.date) dateField.value = formatDateYMD(parseDMY(b.date));
      var timeFromField = document.getElementById('formTimeFrom');
      if (timeFromField) timeFromField.value = b.timeFrom || '';
      var timeToField = document.getElementById('formTimeTo');
      if (timeToField) timeToField.value = b.timeTo || '';
      var eventTypeField = document.getElementById('formEventType');
      if (eventTypeField) eventTypeField.value = b.eventType || 'Birthday';
      var guestsField = document.getElementById('formGuests');
      if (guestsField) guestsField.value = b.guests || '';
      var locationField = document.getElementById('formLocation');
      if (locationField) locationField.value = b.location || '';
      var remarkField = document.getElementById('formRemark');
      if (remarkField) remarkField.value = b.remark || '';
      var nameField = document.getElementById('formName');
      if (nameField) nameField.value = b.name || '';
      var phoneField = document.getElementById('formPhone');
      if (phoneField) phoneField.value = b.phone || '';
      var statusField = document.getElementById('formStatus');
      if (statusField) statusField.value = (b.status || 'confirmed').toLowerCase();
      
      overlay.dataset.editId = bookingId;
    } else {
      showToast('找不到預約', 'error');
      return;
    }
  } else {
    overlay.dataset.editId = '';
  }

  overlay.classList.add('show');
}

function closeBookingModal() {
  var overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function saveBooking() {
  var overlay = document.getElementById('modalOverlay');
  var editId = overlay ? overlay.dataset.editId : '';

  var data = {
    date: document.getElementById('formDate').value,
    timeFrom: document.getElementById('formTimeFrom').value,
    timeTo: document.getElementById('formTimeTo').value,
    eventType: document.getElementById('formEventType').value,
    guests: parseInt(document.getElementById('formGuests').value, 10) || 0,
    location: document.getElementById('formLocation').value,
    remark: document.getElementById('formRemark').value,
    name: document.getElementById('formName').value,
    phone: document.getElementById('formPhone').value,
    status: document.getElementById('formStatus').value
  };

  if (!data.date || !data.eventType) {
    showToast('請填寫日期和活動類型', 'error');
    return;
  }

  // Format date to DD/MM/YYYY
  var formattedDate = dmy(new Date(data.date));
  var timeRange = data.timeFrom;
  if (data.timeTo) timeRange += '-' + data.timeTo;

  try {
    var res = await fetch(API + '/bookings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editId || null,
        data: {
          date: formattedDate,
          time: timeRange,
          eventType: data.eventType,
          guests: data.guests,
          location: data.location,
          remark: data.remark || '',
          name: data.name || '',
          phone: data.phone || '',
          status: data.status
        }
      })
    });
    var result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Save failed');
    
    showToast(editId ? '預約已更新' : '預約已新增', 'success');
    closeBookingModal();
    await loadData();
  } catch (e) {
    console.error('saveBooking error:', e);
    showToast('儲存失敗', 'error');
  }
}

function editBooking(bookingId) {
  openBookingModal(bookingId);
}

// ─── Sub-tab switching ─────────────────────────────────────────

function switchSubTab(el, tabName) {
  var parent = el.closest('.sub-tabs');
  if (parent) {
    var tabs = parent.querySelectorAll('.sub-tab');
    tabs.forEach(function (t) { t.classList.remove('active'); });
  }
  el.classList.add('active');
  
  var panels = document.querySelectorAll('.sub-tab-content');
  panels.forEach(function (p) { p.style.display = 'none'; });
  
  var panelId = 'sub' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  var panel = document.getElementById(panelId);
  if (panel) panel.style.display = 'block';
}

// ─── Export ────────────────────────────────────────────────────

function exportData() {
  if (!allBookings || allBookings.length === 0) {
    showToast('沒有資料可匯出', 'error');
    return;
  }
  
  var csvRows = [['預約ID', '日期', '時間', '活動類型', '人數', '地點', '備註', '客戶', '電話', '狀態']];
  allBookings.forEach(function (b) {
    csvRows.push([
      b.bookingId || '',
      b.date || '',
      (b.timeFrom || '') + (b.timeTo ? '-' + b.timeTo : ''),
      b.eventType || '',
      b.guests || '',
      b.location || '',
      b.remark || '',
      b.name || '',
      b.phone || '',
      b.status || 'confirmed'
    ]);
  });
  
  var csvContent = csvRows.map(row => row.join(',')).join('\n');
  var blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'bookings-export.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('匯出完成', 'success');
}

// ─── Tag Functions ────────────────────────────────────────────

function getCustomerTags(customer) {
  if (!customer || !allTags.length) return [];
  // Match by tab (sheet tab name) or customerId
  var matchKey = customer.tab || customer.customerId || customer.phone || '';
  if (!matchKey) return [];
  var entry = allTags.find(function (t) {
    return String(t.customerId) === String(matchKey) || String(t.customerName) === String(customer.name || '');
  });
  if (entry && entry.tags) {
    return entry.tags.map(function (tag) { return { tag: tag, customerId: entry.customerId, customerName: entry.customerName }; });
  }
  return [];
}

function getAllUniqueTags() {
  var set = {};
  allTags.forEach(function (t) {
    if (t.tags && Array.isArray(t.tags)) {
      t.tags.forEach(function (tag) { set[tag] = true; });
    }
  });
  return Object.keys(set).sort();
}

function setCustomerTags(customerId, customerName, tags) {
  var existing = allTags.filter(function (t) { return String(t.customerId) !== String(customerId); });
  existing.push({
    customerId: String(customerId),
    customerName: String(customerName || ''),
    tags: tags
  });
  allTags = existing;
  
  // Save to server (send as tagEntries array)
  var tagEntries = allTags.filter(function (t) { return t.customerId && t.customerName; }).map(function (t) {
    return { customerId: t.customerId, customerName: t.customerName, tags: t.tags };
  });
  fetch(API + '/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagEntries: tagEntries })
  }).catch(function(e) { console.error('saveTags error:', e); });
}

// ─── Customer List ────────────────────────────────────────────

function renderCustomerList() {
  var container = document.getElementById('chatCustomerList');
  if (!container) return;

  var list = allCustomers.slice();
  
  var chatTotal = document.getElementById('kpiChatTotal');
  var chatActive = document.getElementById('kpiChatActive');
  var chatToday = document.getElementById('kpiChatToday');
  var chatFollowup = document.getElementById('kpiChatFollowup');
  
  if (chatTotal) chatTotal.textContent = list.length;
  if (chatActive) chatActive.textContent = list.filter(function(c) { return c.lastActive; }).length || 0;
  if (chatToday) chatToday.textContent = list.filter(function(c) { return c.todayMessages; }).length || 0;
  if (chatFollowup) chatFollowup.textContent = list.filter(function(c) { return c.needsFollowup; }).length || 0;

  if (activeTagFilter !== 'all') {
    list = list.filter(function (c) {
      var tags = getCustomerTags(c);
      return tags.some(function (t) { return t.tag === activeTagFilter; });
    });
  }

  var badge = document.getElementById('chatCountBadge');
  if (badge) badge.textContent = '(' + list.length + ')';

  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><div class="big-icon">💬</div><p>暫無對話記錄</p></div>';
    return;
  }

  var html = '';
  list.forEach(function (c) {
    var tags = getCustomerTags(c);
    var tagHtml = tags.map(function (t) {
      var color = getTagColor(t.tag);
      return '<span class="tag-chip" style="background:' + color + '20;color:' + color + '">' + escapeHtml(t.tag) + '</span>';
    }).join('');

    html += '<div class="c-row" data-phone="' + escapeHtml(c.phone || c.tab || '') + '" data-name="' + escapeHtml(c.name || '') + '">' +
      '<div class="c-avatar" style="background:' + getTagColor(c.name) + '">' + escapeHtml((c.name || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="c-info">' +
        '<div class="c-name">' + escapeHtml(c.name || '未知客戶') + '</div>' +
        '<div class="c-preview">' + escapeHtml(c.phone || c.tab || '') + '</div>' +
        '<div class="c-intent">' + (c.lastMessage ? escapeHtml(c.lastMessage.substring(0, 50)) : '尚無訊息') + '</div>' +
        '<div style="margin-top:4px">' + tagHtml + '</div>' +
      '</div>' +
      '<div class="c-meta">' +
        '<div class="c-time">' + (c.lastActive ? escapeHtml(c.lastActive) : '') + '</div>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.c-row').forEach(function (row) {
    row.addEventListener('click', function () {
      var phone = this.dataset.phone;
      var name = this.dataset.name;
      openChatModal(phone, name);
    });
  });
}

// ─── Tag Filter Bar ───────────────────────────────────────────

function renderTagFilter() {
  var bar = document.getElementById('tagFilterBar');
  if (!bar) return;

  var tags = getAllUniqueTags();
  var html = '<span class="tag-chip' + (activeTagFilter === 'all' ? ' active' : '') + '" data-tag="all" onclick="filterChats(\'all\', this)">全部</span>';
  
  tags.forEach(function (t) {
    var color = getTagColor(t);
    html += '<span class="tag-chip' + (activeTagFilter === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '" style="border-color:' + color + ';color:' + color + '" onclick="filterChats(\'' + escapeHtml(t) + '\', this)">' + escapeHtml(t) + '</span>';
  });

  bar.innerHTML = html;
}

function filterChats(tag, el) {
  activeTagFilter = tag;
  var bar = document.getElementById('tagFilterBar');
  if (bar) {
    var chips = bar.querySelectorAll('.tag-chip');
    chips.forEach(function (chip) { chip.classList.remove('active'); });
  }
  if (el) el.classList.add('active');
  renderCustomerList();
}

// ─── Chat Modal ───────────────────────────────────────────────

async function openChatModal(phone, name) {
  var modal = document.getElementById('chatModal');
  if (!modal) return;
  
  modal.dataset.chatPhone = phone;
  modal.dataset.chatName = name;

  var titleEl = document.getElementById('chatModalTitle');
  var infoEl = document.getElementById('chatModalInfo');
  var msgContainer = document.getElementById('chatMessages');
  var phoneInput = document.getElementById('sendPhoneInput');
  var tagsContainer = document.getElementById('chatModalTags');

  if (titleEl) titleEl.textContent = name || '對話';
  if (phoneInput) phoneInput.value = phone;

  if (infoEl && phone) {
    var customerBookings = allBookings.filter(function (b) { return b.phone === phone || b.name === name; });
    if (customerBookings.length) {
      var lastBooking = customerBookings[customerBookings.length - 1];
      infoEl.innerHTML = '<span>📅 最後預約: ' + escapeHtml(lastBooking.date || '無') + ' · ' + escapeHtml(lastBooking.eventType || '') + '</span>';
    } else {
      infoEl.innerHTML = '<span>📅 尚無預約記錄</span>';
    }
  }

  // Render tags
  if (tagsContainer && phone) {
    var customerTags = getCustomerTags({ phone: phone, tab: phone, name: name });
    var customerId = phone;
    var tagHtml = '<div style="margin-bottom:8px"><strong>🏷️ 標籤</strong></div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
    customerTags.forEach(function (t) {
      var color = getTagColor(t.tag);
      tagHtml += '<span class="tag-chip" style="background:' + color + '20;color:' + color + '">' + escapeHtml(t.tag) + ' <span class="tag-remove" data-tag="' + escapeHtml(t.tag) + '">✕</span></span>';
    });
    tagHtml += '</div><div><strong>➕ 新增標籤</strong></div><div class="tag-palette">';
    var presetTags = ['VIP', '新客戶', '常客', '取消過', '有興趣', '需要追蹤', '已預約', '未預約'];
    presetTags.forEach(function (tag) {
      var hasTag = customerTags.some(function (t) { return t.tag === tag; });
      if (!hasTag) {
        tagHtml += '<span class="tag-chip tag-add" data-tag="' + escapeHtml(tag) + '">+' + escapeHtml(tag) + '</span>';
      }
    });
    tagHtml += '</div>';
    tagsContainer.innerHTML = tagHtml;
    
    // Attach event listeners for add/remove (inline onclick breaks with special chars)
    tagsContainer.querySelectorAll('.tag-remove').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var tag = this.dataset.tag;
        removeTag(phone, tag);
      });
    });
    tagsContainer.querySelectorAll('.tag-add').forEach(function (el) {
      el.addEventListener('click', function () {
        var tag = this.dataset.tag;
        addTag(phone, name, tag);
      });
    });
  }

  // Load chat history
  if (msgContainer) {
    msgContainer.innerHTML = '<div class="empty-state"><div class="big-icon">💬</div><p>載入中...</p></div>';
  }
  
  modal.classList.add('show');

  try {
    // Find the tab name from phone
    var cust = allCustomers.find(function (c) { return c.phone === phone || c.tab === phone; });
    var tab = (cust && cust.tab) || phone;
    var res = await fetch(API + '/chat/history?tab=' + encodeURIComponent(tab));
    if (res.ok) {
      var history = await res.json();
      chatHistoryCache[phone] = history.history || [];
      renderChatMessages(phone);
    } else {
      renderChatMessages(phone, []);
    }
  } catch (e) {
    console.error('loadHistory error:', e);
    renderChatMessages(phone, []);
  }
}

function closeChatModal() {
  var modal = document.getElementById('chatModal');
  if (modal) modal.classList.remove('show');
}

function renderChatMessages(phone) {
  var container = document.getElementById('chatMessages');
  if (!container) return;

  var msgs = chatHistoryCache[phone] || [];
  var modal = document.getElementById('chatModal');
  var phoneVal = phone || (modal ? modal.dataset.chatPhone : '');

  if (!msgs.length) {
    container.innerHTML = '<div class="empty-state"><div class="big-icon">💬</div><p>尚無對話記錄</p></div>';
    return;
  }

  var html = '';
  msgs.forEach(function (m) {
    // Customer message is the 'message' field, our reply is the 'reply' field
    var time = m.timestamp ? '<div class="msg-meta">' + escapeHtml(m.timestamp) + '</div>' : '';
    if (m.message && m.message.trim()) {
      html += '<div class="msg-row left">' +
        '<div class="msg-bubble customer">' +
          '<div>' + escapeHtml(m.message) + '</div>' +
          time +
        '</div>' +
      '</div>';
    }
    if (m.reply && m.reply.trim()) {
      html += '<div class="msg-row right">' +
        '<div class="msg-bubble admin">' +
          '<div>' + escapeHtml(m.reply) + '</div>' +
          time +
        '</div>' +
      '</div>';
    }
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  var modal = document.getElementById('chatModal');
  if (!modal) return;
  
  var phone = modal.dataset.chatPhone;
  var name = modal.dataset.chatName;
  var input = document.getElementById('sendMsgInput');
  var msg = input ? input.value.trim() : '';
  var phoneInput = document.getElementById('sendPhoneInput');
  var targetPhone = phoneInput ? phoneInput.value.trim() : phone;

  if (!msg) {
    showToast('請輸入訊息', 'error');
    return;
  }

  try {
    var res = await fetch(API + '/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: targetPhone, 
        message: msg, 
        customerName: name || targetPhone,
        intent: 'followup' 
      })
    });
    
    if (!res.ok) throw new Error('Send failed');
    
    if (input) input.value = '';
    
    // Refresh history
    var cust = allCustomers.find(function (c) { return c.phone === targetPhone || c.tab === targetPhone; });
    var tab = (cust && cust.tab) || targetPhone;
    var histRes = await fetch(API + '/chat/history?tab=' + encodeURIComponent(tab));
    if (histRes.ok) {
      var history = await histRes.json();
      chatHistoryCache[targetPhone] = history.history || [];
      renderChatMessages(targetPhone);
    }
    
    showToast('訊息已發送', 'success');
    
    // Refresh customer list to show updated last message
    await loadData();
  } catch (e) {
    console.error('sendChatMessage error:', e);
    showToast('發送失敗', 'error');
  }
}

async function addTag(phone, name, tag) {
  var customerEntry = allTags.find(function (t) { return String(t.customerId) === String(phone) || t.customerName === name; });
  if (customerEntry) {
    if (customerEntry.tags.indexOf(tag) === -1) {
      customerEntry.tags.push(tag);
      setCustomerTags(customerEntry.customerId, customerEntry.customerName, customerEntry.tags);
    }
  } else {
    setCustomerTags(phone, name || phone, [tag]);
  }
  renderCustomerList();
  renderTagFilter();
  var modal = document.getElementById('chatModal');
  if (modal && modal.classList.contains('show')) {
    openChatModal(phone, document.getElementById('chatModal').dataset.chatName || name);
  }
}

async function removeTag(phone, tag) {
  var customerEntry = allTags.find(function (t) { return String(t.customerId) === String(phone); });
  if (customerEntry && customerEntry.tags) {
    customerEntry.tags = customerEntry.tags.filter(function (t) { return t !== tag; });
    setCustomerTags(customerEntry.customerId, customerEntry.customerName, customerEntry.tags);
  }
  renderCustomerList();
  renderTagFilter();
  var modal = document.getElementById('chatModal');
  if (modal && modal.classList.contains('show')) {
    openChatModal(phone, document.getElementById('chatModal').dataset.chatName);
  }
}

// ─── Page Navigation ──────────────────────────────────────────

function switchPage(page, navEl) {
  var pages = document.querySelectorAll('.page');
  pages.forEach(function (el) {
    el.classList.remove('active');
  });
  
  var targetId = 'page' + page.charAt(0).toUpperCase() + page.slice(1);
  var target = document.getElementById(targetId);
  if (target) target.classList.add('active');
  
  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function (el) {
    el.classList.remove('active');
  });
  if (navEl) navEl.classList.add('active');
  
  var sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth <= 768) {
    sidebar.classList.remove('open');
  }
}

function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// ============================================================
// 暴露所有需要在 HTML onclick 中调用的函数到全局作用域
// ============================================================

window.switchPage = switchPage;
window.toggleSidebar = toggleSidebar;
window.openBookingModal = openBookingModal;
window.closeBookingModal = closeBookingModal;
window.editBooking = editBooking;
window.saveBooking = saveBooking;
window.filterBookings = filterBookings;
window.exportData = exportData;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.switchSubTab = switchSubTab;
window.filterChats = filterChats;
window.sendChatMessage = sendChatMessage;
window.closeChatModal = closeChatModal;
window.refreshAll = refreshAll;
window.addTag = addTag;
window.removeTag = removeTag;