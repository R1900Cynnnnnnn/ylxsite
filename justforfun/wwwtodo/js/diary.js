/* ============================================================
   WWWtodo — diary.js 日记模块（全局命名空间 window.Diary）
   渲染到 #view-diary，类名前缀 .di-。
   数据层：Store.getDiary / saveDiary / deleteDiary / getDiaryMap
   壳能力：App.modal / App.toast / App.escapeHTML / App.fmtDate
   ============================================================ */
(function () {
  'use strict';

  var MOODS = [
    { emoji: '😄', label: '开心' },
    { emoji: '🙂', label: '平静' },
    { emoji: '😐', label: '一般' },
    { emoji: '😔', label: '低落' },
    { emoji: '😴', label: '疲惫' },
  ];

  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var RECENT_COUNT = 6;
  var AUTOSAVE_DELAY = 800;

  /* ---------- 模块状态 ---------- */
  var selectedDate = null;   // 当前选中的日期 'YYYY-MM-DD'
  var calYear = null;        // 月历当前显示的年
  var calMonth = null;       // 月历当前显示的月（0-11）
  var saveTimer = null;      // 自动保存防抖计时器
  var lastSavedToast = 0;    // 上次弹「已自动保存」toast 的时间戳
  var dirty = false;         // 是否有未保存的修改
  var calRenderedToday = null; // 日历渲染时的「今天」，用于跨午夜检测

  /* ---------- 工具 ---------- */
  function el() { return document.getElementById('view-diary'); }

  function todayStr() { return Store.today(); }

  function parseDate(dateStr) {
    var parts = dateStr.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  // 判断 diary entry 是否为空（无正文且无心情）
  // 防御修复前导入的脏数据：text/mood 可能不是字符串
  function isEntryEmpty(entry) {
    if (!entry) return true;
    var text = String(entry.text || '');
    var mood = String(entry.mood || '');
    return !text.trim() && !mood;
  }

  var DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 日记数据缓存：一次取出整个 map 复用，避免每次渲染对每个日期都重新
  // JSON.parse 全量数据（O(N²)）；保存 / 删除时调用 invalidateDiaryCache 失效
  var diaryCache = null; // { dates: [...], map: { dateStr: entry } }

  function diaryData() {
    if (!diaryCache) {
      // Store.getDiaryMap 一次 parse 全量并过滤非法日期键
      var map = Store.getDiaryMap();
      diaryCache = { dates: Object.keys(map).sort(), map: map };
    }
    return diaryCache;
  }

  function invalidateDiaryCache() { diaryCache = null; }

  // 有日记的日期集合（含非空内容）
  function diaryDateSet() {
    var data = diaryData();
    var set = {};
    data.dates.forEach(function (d) {
      if (!isEntryEmpty(data.map[d])) set[d] = true;
    });
    return set;
  }

  // 连续写日记天数（以今天或昨天为终点向前数）
  function calcStreak(set) {
    var today = todayStr();
    var d = parseDate(today);
    if (!set[today]) {
      // 今天还没写，从昨天开始数
      d.setDate(d.getDate() - 1);
      if (!set[Store.toDateStr(d)]) return 0;
    }
    var streak = 0;
    while (set[Store.toDateStr(d)]) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // 日期标题：「10月14日 星期二」，今天显示「今天 · 10月14日 星期二」
  function dateTitle(dateStr) {
    var d = parseDate(dateStr);
    var base = (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEKDAYS[d.getDay()];
    return dateStr === todayStr() ? '今天 · ' + base : base;
  }

  /* ---------- 自动保存 ---------- */
  function scheduleAutosave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doAutosave, AUTOSAVE_DELAY);
  }

  function doAutosave() {
    saveTimer = null;
    if (!dirty) return;
    var ok = saveCurrent(false);
    // 仅在日记视图且保存成功时弹 toast；短暂时间内不重复弹
    if (ok && App.currentView() === 'diary') {
      var now = Date.now();
      if (now - lastSavedToast > 4000) {
        lastSavedToast = now;
        App.toast('已自动保存');
      }
    }
    refreshSide();
  }

  // 保存当前编辑器内容。manual=true 时保存成功弹「已保存」；
  // quiet=true（pagehide / 切后台）时静默。返回是否保存成功
  function saveCurrent(manual, quiet) {
    var root = el();
    var textarea = root && root.querySelector('.di-textarea');
    if (!textarea) return false;
    var moodBtn = root.querySelector('.di-mood.selected');
    var entry = {
      text: textarea.value,
      mood: moodBtn ? moodBtn.getAttribute('data-mood') : '',
    };
    if (Store.saveDiary(selectedDate, entry) === null) {
      // 存储不可用或已满：保持 dirty=true，下次还会重试；
      // 失败提示同样只在日记视图弹，后台静默
      if (!quiet && App.currentView() === 'diary') {
        App.toast('保存失败：存储不可用或已满');
      }
      return false;
    }
    dirty = false;
    invalidateDiaryCache();
    if (manual) App.toast('已保存');
    return true;
  }

  // 切换日期前若有未保存内容先落盘；quiet=true 时失败不弹提示
  function flushPending(quiet) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (dirty) saveCurrent(false, quiet);
  }

  /* ---------- 渲染：整体骨架 ---------- */
  function render() {
    flushPending();
    // 缓存在单次渲染内复用即可：每次进入视图强制失效，
    // 保证从其他视图 importAll 后切回日记时拿到新数据
    invalidateDiaryCache();
    if (!selectedDate) {
      selectedDate = todayStr();
      var today = new Date();
      calYear = today.getFullYear();
      calMonth = today.getMonth();
    }
    var root = el();
    if (!root) return;
    root.innerHTML =
      '<div class="di-layout">' +
        '<aside class="di-side">' +
          '<div class="di-cal card" id="di-cal"></div>' +
          '<div class="di-recent card" id="di-recent"></div>' +
        '</aside>' +
        '<div class="di-editor card" id="di-editor"></div>' +
      '</div>';
    renderCalendar();
    renderRecent();
    renderEditor();
  }

  /* ---------- 渲染：月历 ---------- */
  function renderCalendar() {
    var box = document.getElementById('di-cal');
    if (!box) return;
    var set = diaryDateSet();
    var today = todayStr();
    calRenderedToday = today;
    var first = new Date(calYear, calMonth, 1);
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var startWeekday = first.getDay(); // 0=周日

    var html =
      '<div class="di-cal-head">' +
        '<button type="button" class="di-cal-nav" data-nav="prev" aria-label="上一月">‹</button>' +
        '<div class="di-cal-title">' + calYear + '年' + (calMonth + 1) + '月</div>' +
        '<button type="button" class="di-cal-nav" data-nav="next" aria-label="下一月">›</button>' +
      '</div>' +
      '<div class="di-cal-grid">' +
      WEEKDAYS.map(function (w) { return '<div class="di-cal-wd">' + w + '</div>'; }).join('');

    for (var i = 0; i < startWeekday; i++) html += '<div class="di-cal-cell empty"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = Store.toDateStr(new Date(calYear, calMonth, day));
      var isFuture = ds > today; // 未来日期置灰不可点
      var cls = 'di-cal-cell';
      if (isFuture) cls += ' future';
      if (ds === today) cls += ' today';
      if (ds === selectedDate) cls += ' selected';
      if (set[ds]) cls += ' has-diary';
      html +=
        '<button type="button" class="' + cls + '" data-date="' + ds + '"' +
          (isFuture ? ' disabled' : '') + '>' +
          '<span>' + day + '</span>' +
          (set[ds] ? '<i class="di-dot"></i>' : '') +
        '</button>';
    }
    html += '</div>';

    // streak 徽章
    var streak = calcStreak(set);
    html +=
      '<div class="di-streak">' +
        (streak > 0
          ? '🌿 已连续记录 <b>' + streak + '</b> 天'
          : '🌱 从今天开始记录吧') +
        '<button type="button" class="di-today-btn" data-nav="today">回到今天</button>' +
      '</div>';

    box.innerHTML = html;
  }

  /* ---------- 渲染：最近日记概览 ---------- */
  function renderRecent() {
    var box = document.getElementById('di-recent');
    if (!box) return;
    var data = diaryData();
    var today = todayStr();
    var dates = data.dates.filter(function (d) {
      // 过滤未来日期（脏数据 / 跨午夜前导入），点击无反馈的条目不展示
      return d <= today && !isEntryEmpty(data.map[d]);
    });
    // 最近的排在前面
    dates.sort().reverse();
    var recent = dates.slice(0, RECENT_COUNT);

    var html = '<div class="di-recent-title">最近日记</div>';
    if (!recent.length) {
      html += '<div class="di-recent-empty">还没有日记，写点什么吧 ✍️</div>';
    } else {
      html += recent.map(function (d) {
        var entry = data.map[d];
        var dt = parseDate(d);
        // 防御脏数据：text/mood 可能不是字符串
        var text = String(entry && entry.text || '');
        var mood = String(entry && entry.mood || '');
        var summary = text.replace(/\s+/g, ' ').trim().slice(0, 40);
        return (
          '<button type="button" class="di-recent-item' +
            (d === selectedDate ? ' active' : '') + '" data-date="' + App.escapeHTML(d) + '">' +
            '<span class="di-recent-date">' +
              (dt.getMonth() + 1) + '月' + dt.getDate() + '日' +
            '</span>' +
            (mood ? '<span class="di-recent-mood">' + App.escapeHTML(mood) + '</span>' : '') +
            '<span class="di-recent-summary">' +
              (summary ? App.escapeHTML(summary) : '<i>（无正文）</i>') +
            '</span>' +
          '</button>'
        );
      }).join('');
    }
    box.innerHTML = html;
  }

  /* ---------- 渲染：编辑区 ---------- */
  function renderEditor() {
    var box = document.getElementById('di-editor');
    if (!box) return;
    var entry = Store.getDiary(selectedDate);
    var hasContent = !isEntryEmpty(entry);
    // 防御脏数据：text/mood 可能不是字符串
    var text = entry ? String(entry.text || '') : '';
    var mood = entry && typeof entry.mood === 'string' ? entry.mood : '';

    var html =
      '<div class="di-editor-head">' +
        '<div>' +
          '<div class="di-editor-title">' + App.escapeHTML(dateTitle(selectedDate)) + '</div>' +
          (entry && entry.updatedAt
            ? '<div class="di-editor-meta">上次保存于 ' + App.fmtTime(entry.updatedAt) + '</div>'
            : '') +
        '</div>' +
        '<div class="di-editor-actions">' +
          '<button type="button" class="btn btn-ghost di-del-btn" ' +
            (hasContent ? '' : 'disabled') + '>删除</button>' +
          '<button type="button" class="btn btn-primary di-save-btn">保存</button>' +
        '</div>' +
      '</div>' +
      '<div class="di-mood-row">' +
        '<span class="di-mood-label">今日心情</span>' +
        MOODS.map(function (m) {
          return (
            '<button type="button" class="di-mood' +
              (mood === m.emoji ? ' selected' : '') + '" data-mood="' + m.emoji +
              '" title="' + m.label + '">' + m.emoji + '</button>'
          );
        }).join('') +
      '</div>' +
      '<div class="di-paper">' +
        '<textarea class="di-textarea" rows="12" ' +
          'placeholder="写下今天的 What · How · When…&#10;或只是此刻的心情与思绪。">' +
          App.escapeHTML(text) +
        '</textarea>' +
      '</div>' +
      (!hasContent
        ? '<div class="di-empty-hint">📝 这一天还没有日记 —— 记录下今天的 What / How / When 吧</div>'
        : '');

    box.innerHTML = html;
  }

  /* ---------- 局部刷新（日历 + 概览，编辑器不重建） ---------- */
  function refreshSide() {
    renderCalendar();
    renderRecent();
    // 更新删除按钮可用态
    var delBtn = el().querySelector('.di-del-btn');
    if (delBtn) {
      delBtn.disabled = isEntryEmpty(Store.getDiary(selectedDate));
    }
  }

  /* ---------- 交互 ---------- */
  function selectDate(dateStr) {
    if (!DATE_KEY_RE.test(dateStr)) return;
    if (dateStr > todayStr()) return; // 未来日期不可写日记
    if (dateStr === selectedDate) return;
    flushPending();
    selectedDate = dateStr;
    var d = parseDate(dateStr);
    // 若选中日期不在当前显示的月份，切换月历
    if (d.getFullYear() !== calYear || d.getMonth() !== calMonth) {
      calYear = d.getFullYear();
      calMonth = d.getMonth();
    }
    renderCalendar();
    renderRecent();
    renderEditor();
  }

  function changeMonth(delta) {
    flushPending();
    var d = new Date(calYear, calMonth + delta, 1);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    renderCalendar();
  }

  function goToday() {
    flushPending();
    var t = new Date();
    calYear = t.getFullYear();
    calMonth = t.getMonth();
    selectDate(todayStr());
    renderCalendar();
  }

  // 空状态提示随内容有无双向切换：正文或心情任一非空即隐藏，全空则补回
  function syncEmptyHint() {
    var editor = document.getElementById('di-editor');
    if (!editor) return;
    var hint = editor.querySelector('.di-empty-hint');
    var textarea = editor.querySelector('.di-textarea');
    var hasContent =
      !!(textarea && textarea.value.trim()) ||
      !!editor.querySelector('.di-mood.selected');
    if (hasContent) {
      if (hint) hint.remove();
    } else if (!hint) {
      var div = document.createElement('div');
      div.className = 'di-empty-hint';
      div.textContent = '📝 这一天还没有日记 —— 记录下今天的 What / How / When 吧';
      editor.appendChild(div);
    }
  }

  function bindEvents() {
    var root = el();
    if (!root) return;

    root.addEventListener('click', function (e) {
      var navBtn = e.target.closest('.di-cal-nav, .di-today-btn');
      if (navBtn) {
        var nav = navBtn.getAttribute('data-nav');
        if (nav === 'prev') changeMonth(-1);
        else if (nav === 'next') changeMonth(1);
        else if (nav === 'today') goToday();
        return;
      }

      var cell = e.target.closest('.di-cal-cell[data-date]');
      if (cell) {
        selectDate(cell.getAttribute('data-date'));
        return;
      }

      var recentItem = e.target.closest('.di-recent-item');
      if (recentItem) {
        selectDate(recentItem.getAttribute('data-date'));
        return;
      }

      var moodBtn = e.target.closest('.di-mood');
      if (moodBtn) {
        // 单选；再次点击已选中的则取消
        var was = moodBtn.classList.contains('selected');
        root.querySelectorAll('.di-mood').forEach(function (b) {
          b.classList.remove('selected');
        });
        if (!was) moodBtn.classList.add('selected');
        scheduleAutosave();
        syncEmptyHint();
        return;
      }

      if (e.target.closest('.di-save-btn')) {
        flushPending();
        // flush 后 dirty 仍 true 说明刚才保存失败，重试；
        // 尚无 entry 且编辑器有内容时才需要新建，避免空白日写入空 entry
        var hasEntry = !isEntryEmpty(Store.getDiary(selectedDate));
        var textarea = root.querySelector('.di-textarea');
        var hasContent =
          !!(textarea && textarea.value.trim()) ||
          !!root.querySelector('.di-mood.selected');
        if (dirty || (!hasEntry && hasContent)) {
          saveCurrent(true);
        } else if (!hasEntry) {
          App.toast('没有需要保存的内容');
        } else {
          App.toast('已保存');
        }
        refreshSide();
        renderEditorMeta();
        return;
      }

      if (e.target.closest('.di-del-btn')) {
        confirmDelete();
        return;
      }
    });

    root.addEventListener('input', function (e) {
      if (!e.target.classList.contains('di-textarea')) return;
      scheduleAutosave();
      syncEmptyHint();
    });
  }

  // 保存后更新「上次保存于」时间，不重建编辑器
  function renderEditorMeta() {
    var meta = el().querySelector('.di-editor-meta');
    var entry = Store.getDiary(selectedDate);
    if (entry && entry.updatedAt) {
      var text = '上次保存于 ' + App.fmtTime(entry.updatedAt);
      if (meta) meta.textContent = text;
      else {
        var titleBox = el().querySelector('.di-editor-head > div');
        if (titleBox) {
          var div = document.createElement('div');
          div.className = 'di-editor-meta';
          div.textContent = text;
          titleBox.appendChild(div);
        }
      }
    }
  }

  function confirmDelete() {
    var entry = Store.getDiary(selectedDate);
    if (isEntryEmpty(entry)) return;
    App.modal({
      title: '删除日记',
      bodyHTML:
        '<p style="color:var(--text-muted);font-size:14px;line-height:1.7">' +
          '确定要删除 <b style="color:var(--text)">' +
          App.escapeHTML(dateTitle(selectedDate)) +
          '</b> 的日记吗？此操作不可恢复。' +
        '</p>',
      actions: [
        { label: '取消', value: null, kind: 'ghost' },
        { label: '删除', value: 'del', kind: 'danger' },
      ],
    }).then(function (v) {
      if (v !== 'del') return;
      if (Store.deleteDiary(selectedDate)) {
        invalidateDiaryCache();
        dirty = false;
        App.toast('已删除当日日记');
        // 仅成功时重渲染；失败分支保留编辑器中的未保存内容
        renderCalendar();
        renderRecent();
        renderEditor();
      } else {
        App.toast('删除失败：存储不可用或已满');
      }
    });
  }

  /* ---------- 暴露 ---------- */
  window.Diary = {
    render: render,
  };

  bindEvents();

  // 关页 / 切后台时把防抖中未落盘的内容立即保存（静默，不弹失败 toast）
  // （localStorage 写是同步的，pagehide / hidden 时机执行可靠）
  window.addEventListener('pagehide', function () { flushPending(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushPending(true);
    } else if (
      calRenderedToday &&
      todayStr() !== calRenderedToday &&
      App.currentView() === 'diary'
    ) {
      // 跨午夜回到前台：「今天」高亮与未来日期置灰已过期，重渲染日历
      renderCalendar();
    }
  });
})();
