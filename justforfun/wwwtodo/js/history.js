/* ============================================================
   WWWtodo — history.js 「记录」模块（全局命名空间 window.History）
   ------------------------------------------------------------
   - 渲染进 #view-history，类名前缀 .hs-，样式见 css/history.css。
   - 数据全部来自 Store.getSessions()：
     session = { id, timerId, timerName, planned, actual, stars,
                 workMinutes, breakMinutes, mode, startTime, endTime, date,
                 focusMinutes }
     planned / actual 为文本（预计 / 实际完成的内容）；
     时长统计一律用 sessionMinutes()：优先 focusMinutes，缺失时按
     (endTime - startTime) 推算（与 timer.js 今日概览口径一致）。
   - 复用 App.modal / App.toast / App.escapeHTML / App.fmtTime /
     App.fmtMinutes / Store.today / Store.toDateStr / Store.exportAll /
     Store.importAll。
   - 功能：统计卡片、日/周/月视图、日历追溯面板、数据导出导入。
   ============================================================ */
(function () {
  'use strict';

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

  /* 模块内 UI 状态（不持久化） */
  var state = {
    tab: 'day',                 // 'day' | 'week' | 'month'
    day: null,                  // 日视图当前日期 'YYYY-MM-DD'
    weekOffset: 0,              // 周视图偏移（0 = 本周）
    month: null,                // 月视图 { y, m }（m 为 1~12）
    cal: { open: false, y: 0, m: 0 }, // 日历追溯面板
  };

  /* ---------- 日期工具 ---------- */
  // 'YYYY-MM-DD' -> Date（本地时区，避免 ISO 解析的时区偏移）
  function parseDate(str) {
    var p = String(str).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(str, n) {
    var d = parseDate(str);
    d.setDate(d.getDate() + n);
    return Store.toDateStr(d);
  }

  // 所在周的周一
  function weekStartOf(str) {
    var d = parseDate(str);
    var offset = (d.getDay() + 6) % 7; // 周一 = 0
    d.setDate(d.getDate() - offset);
    return d;
  }

  // '10月14日 周一'
  function dayLabel(str) {
    var d = parseDate(str);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }

  /* ---------- 数据聚合 ---------- */
  // 单次专注时长（分钟）：优先 focusMinutes，兼容缺失时用起止时间推算；
  // 防御 localStorage 里修复前导入的脏数据：非法 / 负数一律钳到 0
  function sessionMinutes(s) {
    var v =
      typeof s.focusMinutes === 'number'
        ? s.focusMinutes
        : ((s.endTime || 0) - (s.startTime || 0)) / 60000;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // 星数统计口径：统一钳到 0~10（兼容满分 15 时代的旧数据，负数钳 0）
  function starValue(s) {
    return Math.max(0, Math.min(10, Number(s.stars) || 0));
  }

  // 热力图绝对分档：0=无记录 1=<25分钟 2=25~60 3=61~120 4=>120
  // 跨月可比较；Number.isFinite 兜底，避免出现 hs-heat-NaN
  function heatLevel(minutes) {
    var m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) return 0;
    if (m < 25) return 1;
    if (m <= 60) return 2;
    if (m <= 120) return 3;
    return 4;
  }

  // sessions -> { dateStr: { count, minutes, stars, list } }
  function groupByDate(sessions) {
    var map = {};
    sessions.forEach(function (s) {
      if (!s || !s.date) return;
      var g = map[s.date];
      if (!g) g = map[s.date] = { count: 0, minutes: 0, stars: 0, list: [] };
      g.count += 1;
      g.minutes += sessionMinutes(s);
      g.stars += starValue(s);
      g.list.push(s);
    });
    Object.keys(map).forEach(function (k) {
      map[k].list.sort(function (a, b) { return (a.startTime || 0) - (b.startTime || 0); });
    });
    return map;
  }

  // 连续专注天数：今天没记录则从昨天往前数
  function calcStreak(byDate) {
    var d = Store.today();
    if (!byDate[d]) d = addDays(d, -1);
    var n = 0;
    while (byDate[d]) {
      n += 1;
      d = addDays(d, -1);
    }
    return n;
  }

  /* ---------- 星级渲染（stars 0~10，步进 0.5） ---------- */
  function starsHTML(stars) {
    // 上限 15 仅为兼容满分 15 时代的旧数据，新数据范围 0~10
    var s = Math.max(0, Math.min(15, Number(stars) || 0));
    var full = Math.floor(s);
    var half = s - full >= 0.5;
    var inner = '';
    var i;
    if (s <= 10) {
      for (i = 0; i < full; i++) inner += '<span class="hs-star">★</span>';
      if (half) inner += '<span class="hs-star hs-star-half">★</span>';
      if (!full && !half) inner = '<span class="hs-star hs-star-empty">☆</span>';
    } else {
      inner = '<span class="hs-star">★</span><span class="hs-star-num">×' + s + '</span>';
    }
    return '<span class="hs-stars" title="' + s + ' 星">' + inner + '</span>';
  }

  /* ---------- 顶部统计卡片 ---------- */
  function statsHTML(sessions, byDate) {
    var count = sessions.length;
    var minutes = 0;
    var stars = 0;
    sessions.forEach(function (s) {
      minutes += sessionMinutes(s);
      stars += starValue(s);
    });
    var avg = count ? (stars / count).toFixed(1) : '0.0';
    var streak = calcStreak(byDate);

    var cards = [
      { icon: '🍅', value: count, label: '累计专注次数' },
      { icon: '⏱️', value: App.fmtMinutes(minutes), label: '累计专注时长' },
      { icon: '⭐', value: stars, label: '总星数' },
      { icon: '✨', value: avg, label: '平均星级' },
      { icon: '🔥', value: streak + ' 天', label: '连续专注' },
    ];
    var html = cards.map(function (c) {
      return (
        '<div class="hs-stat card">' +
        '<div class="hs-stat-icon">' + c.icon + '</div>' +
        '<div class="hs-stat-value">' + c.value + '</div>' +
        '<div class="hs-stat-label">' + c.label + '</div>' +
        '</div>'
      );
    }).join('');
    return '<div class="hs-stats">' + html + '</div>';
  }

  /* ---------- 月历网格（月视图热力图 / 日历追溯面板共用） ---------- */
  // opts: { heat: bool, byDate, prefix: 'mv' | 'cal' }
  function monthGridHTML(y, m, opts) {
    var byDate = opts.byDate;
    var first = new Date(y, m - 1, 1);
    var daysInMonth = new Date(y, m, 0).getDate();
    var lead = (first.getDay() + 6) % 7; // 周一开头的留白
    var today = Store.today();

    var head = WEEKDAYS_SHORT.map(function (w) {
      return '<div class="hs-cal-wd">' + w + '</div>';
    }).join('');

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<div class="hs-cal-cell hs-cal-blank"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = Store.toDateStr(new Date(y, m - 1, d));
      var g = byDate[dateStr];
      var cls = 'hs-cal-cell hs-cal-day';
      var extra = '';
      if (dateStr === today) cls += ' hs-cal-today';
      if (opts.heat) {
        // 有记录但时长为 0 的日子按 lv 1 渲染，与无记录区分开
        var lv = g ? Math.max(1, heatLevel(g.minutes)) : 0;
        cls += ' hs-heat-' + lv;
        if (g) {
          extra = ' title="' + g.count + ' 次 · ' + App.fmtMinutes(g.minutes) + '"';
        }
      } else {
        // 未来日期：不绑定跳转，置灰展示（不可跳到未来日视图）
        if (dateStr > today) {
          cells += '<div class="' + cls + ' hs-cal-future">' + d + '</div>';
          continue;
        }
        if (g) cls += ' hs-cal-has';
        extra = g ? ' title="' + g.count + ' 次专注"' : '';
        cells +=
          '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' +
          dateStr + '"' + extra + '>' + d +
          (g ? '<i class="hs-cal-dot"></i>' : '') +
          '</button>';
        continue;
      }
      cells +=
        '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' +
        dateStr + '"' + extra + '>' + d + '</button>';
    }

    return '<div class="hs-cal-grid">' + head + cells + '</div>';
  }

  /* ---------- 日历追溯面板 ---------- */
  function calendarPanelHTML(byDate) {
    var toggle =
      '<button type="button" class="btn btn-ghost hs-cal-toggle" data-action="cal-toggle">' +
      '📅 日历追溯 ' + (state.cal.open ? '▴' : '▾') +
      '</button>';
    if (!state.cal.open) return '<div class="hs-calwrap">' + toggle + '</div>';

    // 与日/周/月视图口径一致：到达当月后禁用「下一月」
    var td = parseDate(Store.today());
    var noNext =
      state.cal.y * 12 + state.cal.m >=
      td.getFullYear() * 12 + (td.getMonth() + 1);

    var body =
      '<div class="hs-cal-panel card">' +
      '<div class="hs-cal-nav">' +
      '<button type="button" class="hs-navbtn" data-action="cal-prev" aria-label="上一月">◀</button>' +
      '<div class="hs-cal-title">' + state.cal.y + '年' + state.cal.m + '月</div>' +
      '<button type="button" class="hs-navbtn" data-action="cal-next" aria-label="下一月"' +
      (noNext ? ' disabled' : '') + '>▶</button>' +
      '</div>' +
      monthGridHTML(state.cal.y, state.cal.m, { heat: false, byDate: byDate }) +
      '<div class="hs-cal-hint">小圆点表示当天有专注记录，点击日期查看明细</div>' +
      '</div>';
    return '<div class="hs-calwrap">' + toggle + body + '</div>';
  }

  /* ---------- 空状态 ---------- */
  function emptyHTML(emoji, text, sub) {
    return (
      '<div class="hs-empty">' +
      '<div class="hs-empty-emoji">' + emoji + '</div>' +
      '<div class="hs-empty-text">' + text + '</div>' +
      (sub ? '<div class="hs-empty-sub">' + sub + '</div>' : '') +
      '</div>'
    );
  }

  /* ---------- 日视图 ---------- */
  function dayViewHTML(byDate) {
    var day = state.day;
    var today = Store.today();
    var g = byDate[day];

    var nav =
      '<div class="hs-daynav">' +
      '<button type="button" class="hs-navbtn" data-action="day-prev" aria-label="前一天">◀</button>' +
      '<div class="hs-daynav-title">' + dayLabel(day) +
      (day === today ? '<span class="hs-today-tag">今天</span>' : '') +
      '</div>' +
      '<button type="button" class="hs-navbtn" data-action="day-next" aria-label="后一天"' +
      (day >= today ? ' disabled' : '') + '>▶</button>' +
      (day !== today
        ? '<button type="button" class="btn btn-ghost hs-backtoday" data-action="day-today">回到今天</button>'
        : '') +
      '</div>';

    if (!g) {
      return (
        '<div class="card hs-pane">' + nav +
        emptyHTML('🌿', '这一天还没有专注记录', '种下一个番茄，让时间发芽吧') +
        '</div>'
      );
    }

    var avg = (g.stars / g.count).toFixed(1);
    var summary =
      '<div class="hs-daysum">' +
      '<span>完成 <b>' + g.count + '</b> 个周期</span>' +
      '<span class="hs-daysum-sep">·</span>' +
      '<span>专注 <b>' + App.fmtMinutes(g.minutes) + '</b></span>' +
      '<span class="hs-daysum-sep">·</span>' +
      '<span>共 <b>' + g.stars + '</b> 星</span>' +
      '<span class="hs-daysum-sep">·</span>' +
      '<span>平均 <b>' + avg + '</b> 星</span>' +
      '</div>';

    var items = g.list.map(function (s) {
      return (
        '<li class="hs-session">' +
        '<div class="hs-session-time">' +
        App.fmtTime(s.startTime) + ' – ' + App.fmtTime(s.endTime) +
        '</div>' +
        '<div class="hs-session-main">' +
        '<div class="hs-session-name">' + App.escapeHTML(s.timerName) + '</div>' +
        '<div class="hs-session-meta">' +
        App.fmtMinutes(sessionMinutes(s)) +
        (s.mode === 'countup' ? ' · 正计时' : '') +
        '</div>' +
        (s.planned
          ? '<div class="hs-session-meta">目标：' + App.escapeHTML(s.planned) + '</div>'
          : '') +
        (s.actual
          ? '<div class="hs-session-meta">完成：' + App.escapeHTML(s.actual) + '</div>'
          : '') +
        '</div>' +
        '<div class="hs-session-stars">' + starsHTML(s.stars) + '</div>' +
        '</li>'
      );
    }).join('');

    return (
      '<div class="card hs-pane">' + nav + summary +
      '<ul class="hs-sessions">' + items + '</ul>' +
      '</div>'
    );
  }

  /* ---------- 周视图 ---------- */
  function weekViewHTML(byDate) {
    var base = addDays(Store.today(), state.weekOffset * 7);
    var start = weekStartOf(base);
    var days = [];
    var max = 0;
    var totCount = 0;
    var totMin = 0;
    var totStars = 0;
    var best = null;
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(d.getDate() + i);
      var str = Store.toDateStr(d);
      var g = byDate[str] || { count: 0, minutes: 0, stars: 0 };
      days.push({ str: str, wd: WEEKDAYS[d.getDay()], g: g });
      if (g.minutes > max) max = g.minutes;
      totCount += g.count;
      totMin += g.minutes;
      totStars += g.stars;
      if (g.minutes > 0 && (!best || g.minutes > best.g.minutes)) {
        best = days[days.length - 1];
      }
    }

    var isCurWeek = state.weekOffset === 0;
    // 跨年区间或区间不在当前年时，标签补上年份
    var endD = parseDate(days[6].str);
    var curY = parseDate(Store.today()).getFullYear();
    var withYear =
      start.getFullYear() !== endD.getFullYear() || start.getFullYear() !== curY;
    function mdLabel(d) {
      return (
        (withYear ? d.getFullYear() + '年' : '') +
        (d.getMonth() + 1) + '月' + d.getDate() + '日'
      );
    }
    var rangeLabel = mdLabel(start) + ' – ' + mdLabel(endD);

    var nav =
      '<div class="hs-daynav">' +
      '<button type="button" class="hs-navbtn" data-action="week-prev" aria-label="上一周">◀</button>' +
      '<div class="hs-daynav-title">' + rangeLabel +
      (isCurWeek ? '<span class="hs-today-tag">本周</span>' : '') +
      '</div>' +
      '<button type="button" class="hs-navbtn" data-action="week-next" aria-label="下一周"' +
      (state.weekOffset >= 0 ? ' disabled' : '') + '>▶</button>' +
      (!isCurWeek
        ? '<button type="button" class="btn btn-ghost hs-backtoday" data-action="week-today">回到本周</button>'
        : '') +
      '</div>';

    var today = Store.today();
    var bars = days.map(function (d, idx) {
      // 仅当天有记录时才保底 4% 高度，无记录的日子高度为 0
      var pct =
        max > 0 && d.g.minutes > 0
          ? Math.max(4, Math.round((d.g.minutes / max) * 100))
          : 0;
      var tip = d.g.count > 0
        ? d.wd + ' · ' + d.g.count + ' 次 · ' + App.fmtMinutes(d.g.minutes)
        : d.wd + ' · 无记录';
      return (
        '<div class="hs-bar' + (d.str === today ? ' hs-bar-today' : '') +
        '" data-action="pick-day" data-date="' + d.str + '" data-tip="' + tip +
        '" role="button" tabindex="0" aria-label="' + tip + '">' +
        // 移动端常显的柱顶数值（桌面端由 CSS 隐藏，用 hover 气泡）
        '<div class="hs-bar-val">' +
        (d.g.minutes > 0 ? App.fmtMinutes(d.g.minutes) : '') +
        '</div>' +
        '<div class="hs-bar-track">' +
        '<div class="hs-bar-fill" style="height:' + pct + '%;animation-delay:' + idx * 60 + 'ms"></div>' +
        '</div>' +
        '<div class="hs-bar-label">' + d.wd.slice(1) + '</div>' +
        '</div>'
      );
    }).join('');

    var summary =
      '<div class="hs-weeksum">' +
      '<div class="hs-weeksum-item"><b>' + totCount + '</b><span>周期数</span></div>' +
      '<div class="hs-weeksum-item"><b>' + App.fmtMinutes(totMin) + '</b><span>专注时长</span></div>' +
      '<div class="hs-weeksum-item"><b>' + totStars + '</b><span>总星数</span></div>' +
      '<div class="hs-weeksum-item"><b>' +
      (best ? best.wd + ' · ' + App.fmtMinutes(best.g.minutes) : '—') +
      '</b><span>最专注的一天</span></div>' +
      '</div>';

    var chart = totCount > 0
      ? '<div class="hs-chart">' + bars + '</div>'
      : emptyHTML('🍃', '这一周还没有专注记录', '完成一次专注，这里就会长出小柱子');

    return '<div class="card hs-pane">' + nav + chart + summary + '</div>';
  }

  /* ---------- 月视图 ---------- */
  function monthViewHTML(byDate) {
    var y = state.month.y;
    var m = state.month.m;
    var td = parseDate(Store.today());
    var isCurMonth = y === td.getFullYear() && m === td.getMonth() + 1;
    // 不得超过当月（防御状态异常时也按年月数值比较）
    var noNext = y * 12 + m >= td.getFullYear() * 12 + (td.getMonth() + 1);

    var nav =
      '<div class="hs-daynav">' +
      '<button type="button" class="hs-navbtn" data-action="month-prev" aria-label="上一月">◀</button>' +
      '<div class="hs-daynav-title">' + y + '年' + m + '月' +
      (isCurMonth ? '<span class="hs-today-tag">本月</span>' : '') +
      '</div>' +
      '<button type="button" class="hs-navbtn" data-action="month-next" aria-label="下一月"' +
      (noNext ? ' disabled' : '') + '>▶</button>' +
      (!isCurMonth
        ? '<button type="button" class="btn btn-ghost hs-backtoday" data-action="month-today">回到本月</button>'
        : '') +
      '</div>';

    // 图例与 heatLevel() 的绝对阈值保持一致
    var legend =
      '<div class="hs-legend">' +
      '<span><i class="hs-legend-cell hs-heat-0"></i>无记录</span>' +
      '<span><i class="hs-legend-cell hs-heat-1"></i>&lt;25分钟</span>' +
      '<span><i class="hs-legend-cell hs-heat-2"></i>25~60分钟</span>' +
      '<span><i class="hs-legend-cell hs-heat-3"></i>61~120分钟</span>' +
      '<span><i class="hs-legend-cell hs-heat-4"></i>&gt;120分钟</span>' +
      '</div>';

    return (
      '<div class="card hs-pane">' + nav +
      monthGridHTML(y, m, { heat: true, byDate: byDate }) +
      legend +
      '<div class="hs-cal-hint">颜色越深代表当天专注越久，点击日期查看明细</div>' +
      '</div>'
    );
  }

  /* ---------- 整体渲染 ---------- */
  function render() {
    var container = document.getElementById('view-history');
    if (!container || !window.Store || !window.App) return;
    ensureBound(container);

    // 初始化状态里的日期
    var today = Store.today();
    if (!state.day) state.day = today;
    if (!state.month) {
      var t = parseDate(today);
      state.month = { y: t.getFullYear(), m: t.getMonth() + 1 };
    }
    if (!state.cal.y) {
      state.cal.y = state.month.y;
      state.cal.m = state.month.m;
    }

    var sessions = Store.getSessions();
    var byDate = groupByDate(sessions);

    var header =
      '<div class="hs-header">' +
      '<div class="hs-header-title">专注记录</div>' +
      '<div class="hs-header-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="export">导出数据</button>' +
      '<button type="button" class="btn btn-ghost" data-action="import">导入数据</button>' +
      '<input type="file" class="hs-file" accept=".json,application/json" hidden>' +
      '</div>' +
      '</div>';

    var tabs =
      '<div class="hs-tabs" role="tablist">' +
      ['day', 'week', 'month'].map(function (t) {
        var label = { day: '日', week: '周', month: '月' }[t];
        return (
          '<button type="button" role="tab" class="hs-tab' +
          (state.tab === t ? ' active' : '') +
          '" data-action="tab" data-tab="' + t + '">' + label + '</button>'
        );
      }).join('') +
      '</div>';

    var content =
      state.tab === 'day'
        ? dayViewHTML(byDate)
        : state.tab === 'week'
        ? weekViewHTML(byDate)
        : monthViewHTML(byDate);

    container.innerHTML =
      header +
      statsHTML(sessions, byDate) +
      calendarPanelHTML(byDate) +
      tabs +
      content;
  }

  /* ---------- 导出 / 导入 ---------- */
  function doExport() {
    var json = Store.exportAll();
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wwwtodo-backup-' + Store.today() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    App.toast('已导出全部数据');
  }

  function doImport(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      App.modal({
        title: '导入数据',
        bodyHTML:
          '<p style="line-height:1.8">将从 <b>' + App.escapeHTML(file.name) +
          '</b> 导入数据。<br><span style="color:var(--danger)">导入将覆盖当前全部数据（番茄钟、专注记录与日记），且不可撤销。</span></p>',
        actions: [
          { label: '取消', value: null, kind: 'ghost' },
          { label: '确认导入', value: 'ok', kind: 'danger' },
        ],
      }).then(function (v) {
        if (v !== 'ok') return;
        if (Store.importAll(text)) {
          App.toast('导入成功');
          render();
        } else {
          App.toast('导入失败：文件无效或存储不可用，当前数据未变更');
        }
      });
    };
    reader.onerror = function () {
      App.toast('读取文件失败');
    };
    reader.readAsText(file);
  }

  /* ---------- 事件（委托到容器，只绑定一次） ---------- */
  var bound = false;
  function ensureBound(container) {
    if (bound) return;
    bound = true;

    container.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      var action = el.getAttribute('data-action');

      switch (action) {
        case 'tab':
          state.tab = el.getAttribute('data-tab');
          render();
          break;
        case 'day-prev': state.day = addDays(state.day, -1); render(); break;
        case 'day-next':
          if (state.day >= Store.today()) return; // 不得超过今天
          state.day = addDays(state.day, 1);
          render();
          break;
        case 'day-today': state.day = Store.today(); render(); break;
        case 'week-prev': state.weekOffset -= 1; render(); break;
        case 'week-next':
          if (state.weekOffset >= 0) return; // 不得超过本周
          state.weekOffset += 1;
          render();
          break;
        case 'week-today': state.weekOffset = 0; render(); break;
        case 'month-prev':
          shiftMonth(state.month, -1);
          render();
          break;
        case 'month-next': {
          var ct = parseDate(Store.today());
          // 不得超过当月
          if (
            state.month.y * 12 + state.month.m >=
            ct.getFullYear() * 12 + (ct.getMonth() + 1)
          )
            return;
          shiftMonth(state.month, 1);
          render();
          break;
        }
        case 'month-today': {
          var t = parseDate(Store.today());
          state.month = { y: t.getFullYear(), m: t.getMonth() + 1 };
          render();
          break;
        }
        case 'cal-toggle':
          state.cal.open = !state.cal.open;
          if (state.cal.open) {
            // 展开时把面板月份同步到日视图正在浏览的日期所在月
            var d = parseDate(state.day || Store.today());
            state.cal.y = d.getFullYear();
            state.cal.m = d.getMonth() + 1;
          }
          render();
          break;
        case 'cal-prev': shiftMonth(state.cal, -1); render(); break;
        case 'cal-next': {
          var ctd = parseDate(Store.today());
          // 不得超过当月（与日/周/月视图口径一致）
          if (
            state.cal.y * 12 + state.cal.m >=
            ctd.getFullYear() * 12 + (ctd.getMonth() + 1)
          )
            return;
          shiftMonth(state.cal, 1);
          render();
          break;
        }
        case 'pick-day':
          pickDay(el.getAttribute('data-date'));
          break;
        case 'export':
          doExport();
          break;
        case 'import': {
          var input = container.querySelector('.hs-file');
          if (input) input.click();
          break;
        }
      }
    });

    // 周视图柱状条键盘可达（与点击路径共用 pickDay，行为一致）
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var el = e.target.closest('.hs-bar[data-action="pick-day"]');
      if (!el) return;
      e.preventDefault();
      pickDay(el.getAttribute('data-date'));
    });

    container.addEventListener('change', function (e) {
      var input = e.target.closest('.hs-file');
      if (!input || !input.files || !input.files.length) return;
      doImport(input.files[0]);
      input.value = ''; // 允许重复选择同一文件
    });
  }

  function shiftMonth(obj, delta) {
    var m = obj.m + delta;
    var y = obj.y;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    obj.y = y;
    obj.m = m;
  }

  // 跳转到某日视图：点击日历格子 / 周柱与键盘激活共用，行为一致
  function pickDay(dateStr) {
    if (!dateStr) return;
    state.day = dateStr;
    state.tab = 'day';
    state.cal.open = false;
    render();
  }

  /* ---------- 暴露 API ---------- */
  window.History = { render: render };
})();
