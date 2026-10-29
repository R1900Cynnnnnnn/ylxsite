/* ============================================================
   WWWtodo — timer.js 「专注」模块（全局命名空间 window.Timer）
   ------------------------------------------------------------
   - 渲染进 #view-timer，类名前缀 .tm-
   - 计时基于时间戳，setInterval 每 250ms 校准（防后台节流误差）
   - 计时状态保存在模块级变量 S 中，切换视图不丢失，回到视图继续显示
   ============================================================ */
(function () {
  'use strict';

  var TICK_MS = 250;

  /* ---------- 模块级运行状态 ---------- */
  var S = {
    selectedId: 'default', // 列表当前选中的计时器 id
    status: 'idle',        // idle | running | paused
    timer: null,           // 当前专注使用的计时器配置
    phase: 'work',         // work | break
    phaseStartTs: 0,       // 当前运行段的起点时间戳
    elapsedBase: 0,        // 当前阶段在当前运行段之前已累计的毫秒数
    workElapsedMs: 0,      // 已结束的工作阶段累计毫秒数（用于记录）
    startTime: 0,          // 本次专注开始时间戳
    planned: '',           // 预计完成的内容
    overtime: false,       // 正计时已达到目标时长
    intervalId: null,
    lastClockText: '',     // 避免不必要的 DOM 写入
    pendingSave: false,    // 专注已结束但记录未保存（评分/丢弃弹窗期间），保持关页拦截
  };

  var eventsBound = false;

  /* ---------- document.title 同步（切到其他标签页也能瞟到进度） ---------- */
  var origTitle = document.title;

  function syncTitle() {
    try {
      if (S.status === 'idle') {
        if (document.title !== origTitle) document.title = origTitle;
        return;
      }
      var elapsed = phaseElapsed();
      var total = S.phase === 'break' ? breakMs() : workMs();
      var text = S.timer.mode === 'countdown'
        ? fmtClock(Math.max(0, total - elapsed))
        : fmtClock(elapsed);
      var label = S.phase === 'break' ? '休息中' : (S.overtime ? '已达标' : '专注中');
      document.title = text + ' · ' + label + ' - WWWtodo';
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 小工具 ---------- */
  function container() { return document.getElementById('view-timer'); }
  function esc(s) { return window.App.escapeHTML(s); }

  // 毫秒 -> mm:ss（超过 1 小时显示 h:mm:ss）
  function fmtClock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = String(m).padStart(2, '0');
    var ss = String(sec).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function workMs() { return S.timer.workMinutes * 60000; }
  function breakMs() { return S.timer.breakMinutes * 60000; }

  // 当前阶段已进行的毫秒数（暂停时冻结）
  function phaseElapsed() {
    if (S.status === 'running') {
      return S.elapsedBase + (Date.now() - S.phaseStartTs);
    }
    return S.elapsedBase;
  }

  /* ============================================================
     渲染入口
     ============================================================ */
  function render() {
    var root = container();
    if (!root) return;
    bindEvents(root);
    if (S.status === 'idle') renderList(root);
    else renderFocus(root);
    syncTitle();
  }

  /* ---------- 列表视图：今日概览 + 计时器卡片 ---------- */
  function renderList(root) {
    var timers = window.Store.getTimers();
    if (!timers.some(function (t) { return t.id === S.selectedId; })) {
      S.selectedId = timers[0].id;
    }

    // 今日概览
    var sessions = window.Store.getSessionsByDate(window.Store.today());
    var totalMin = 0;
    var starSum = 0;
    var starCnt = 0;
    sessions.forEach(function (s) {
      if (typeof s.focusMinutes === 'number') totalMin += s.focusMinutes;
      else totalMin += Math.max(0, (s.endTime - s.startTime) / 60000);
      var st = Math.min(10, Math.max(0, Number(s.stars) || 0)); // 兼容旧数据里字符串/非法 stars
      if (st > 0) { starSum += st; starCnt++; }
    });
    var avgStars = starCnt ? (starSum / starCnt).toFixed(1) : '—';

    var html =
      '<div class="tm-overview card">' +
        '<div class="tm-overview-item"><div class="tm-overview-num">' + sessions.length + '</div><div class="tm-overview-label">今日周期</div></div>' +
        '<div class="tm-overview-divider"></div>' +
        '<div class="tm-overview-item"><div class="tm-overview-num">' + window.App.fmtMinutes(totalMin) + '</div><div class="tm-overview-label">累计专注</div></div>' +
        '<div class="tm-overview-divider"></div>' +
        '<div class="tm-overview-item"><div class="tm-overview-num">' + avgStars + '</div><div class="tm-overview-label">平均星级</div></div>' +
      '</div>';

    html += '<div class="tm-section-title">选择计时器</div><div class="tm-grid">';
    timers.forEach(function (t) {
      var isDefault = t.id === 'default';
      var active = t.id === S.selectedId ? ' active' : '';
      // 防御脏数据：强制数值化（非法值回退默认），避免拼接注入
      var tWork = clampInt(t.workMinutes, 1, 180, 25);
      var tBreak = clampInt(t.breakMinutes, 0, 60, 5);
      html +=
        '<div class="tm-card card card-hover' + active + '" data-action="select" data-id="' + esc(t.id) + '" role="button" tabindex="0">' +
          '<div class="tm-card-head">' +
            '<span class="tm-card-name">' + esc(t.name) + '</span>' +
            '<span class="tm-badge ' + (t.mode === 'countup' ? 'tm-badge-up' : 'tm-badge-down') + '">' +
              (t.mode === 'countup' ? '正计时' : '倒计时') + '</span>' +
          '</div>' +
          '<div class="tm-card-meta">工作 ' + tWork + ' 分 · 休息 ' + tBreak + ' 分</div>' +
          (isDefault
            ? '<div class="tm-card-foot"><span class="tm-badge tm-badge-default">内置</span></div>'
            : '<div class="tm-card-foot">' +
                '<button type="button" class="tm-mini-btn" data-action="edit" data-id="' + esc(t.id) + '">编辑</button>' +
                '<button type="button" class="tm-mini-btn tm-mini-danger" data-action="del" data-id="' + esc(t.id) + '">删除</button>' +
              '</div>') +
        '</div>';
    });
    html +=
      '<div class="tm-card tm-card-new" data-action="new" role="button" tabindex="0">' +
        '<span class="tm-card-new-plus">＋</span><span>新建计时器</span>' +
      '</div>';
    html += '</div>';

    var sel = timers.filter(function (t) { return t.id === S.selectedId; })[0];
    html +=
      '<div class="tm-start-row">' +
        '<button type="button" class="btn btn-primary tm-start-btn" data-action="start">' +
          '开始专注 · ' + esc(sel.name) +
        '</button>' +
      '</div>';

    root.innerHTML = html;
  }

  /* ---------- 专注界面 ---------- */
  var RING_R = 120;
  var RING_C = 2 * Math.PI * RING_R;

  function renderFocus(root) {
    var t = S.timer;
    var isBreak = S.phase === 'break';
    var total = isBreak ? breakMs() : workMs();
    var phaseText = isBreak ? '休息中' : (S.overtime ? '已达标 · 可继续' : '专注中');

    root.innerHTML =
      '<div class="tm-focus card ' + (isBreak ? 'tm-phase-break' : 'tm-phase-work') + '">' +
        '<div class="tm-focus-timer-name">' + esc(t.name) +
          '<span class="tm-badge ' + (t.mode === 'countup' ? 'tm-badge-up' : 'tm-badge-down') + '">' +
            (t.mode === 'countup' ? '正计时' : '倒计时') + '</span>' +
        '</div>' +
        '<div class="tm-focus-planned">目标：' + esc(S.planned) + '</div>' +

        '<div class="tm-ring-wrap' + (S.status === 'running' ? ' breathing' : '') + '">' +
          '<svg class="tm-ring" viewBox="0 0 280 280" aria-hidden="true">' +
            '<circle class="tm-ring-bg" cx="140" cy="140" r="' + RING_R + '"></circle>' +
            '<circle class="tm-ring-fg" id="tm-ring-fg" cx="140" cy="140" r="' + RING_R + '"' +
              ' stroke-dasharray="' + RING_C.toFixed(2) + '"' +
              ' stroke-dashoffset="' + RING_C.toFixed(2) + '"></circle>' +
          '</svg>' +
          '<div class="tm-clock-box">' +
            '<div class="tm-clock" id="tm-clock">--:--</div>' +
            '<div class="tm-phase-label" id="tm-phase-label">' + phaseText + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="tm-controls">' +
          '<button type="button" class="btn btn-ghost" data-action="pause" id="tm-pause-btn">' +
            (S.status === 'paused' ? '继续' : '暂停') + '</button>' +
          (isBreak
            ? '<button type="button" class="btn btn-primary" data-action="finish">跳过休息</button>'
            : '<button type="button" class="btn ' + (S.overtime ? 'btn-primary' : 'btn-ghost') + '" data-action="finish">结束专注</button>') +
          '<button type="button" class="btn btn-danger" data-action="abandon">放弃</button>' +
        '</div>' +
      '</div>';

    S.lastClockText = '';
    updateClock(true);
  }

  /* ---------- 每 tick 更新 DOM（若元素存在） ---------- */
  function updateClock(force) {
    var clockEl = document.getElementById('tm-clock');
    if (!clockEl) return;
    var elapsed = phaseElapsed();
    var isBreak = S.phase === 'break';
    var total = isBreak ? breakMs() : workMs();
    var text;
    if (S.timer.mode === 'countdown') {
      text = fmtClock(Math.max(0, total - elapsed));
    } else {
      text = fmtClock(elapsed);
    }
    if (force || text !== S.lastClockText) {
      S.lastClockText = text;
      clockEl.textContent = text;
    }

    // 进度环
    var ring = document.getElementById('tm-ring-fg');
    if (ring) {
      var ratio = total > 0 ? Math.min(1, elapsed / total) : 1;
      ring.style.strokeDashoffset = (RING_C * (1 - ratio)).toFixed(2);
    }
  }

  /* ============================================================
     计时核心
     ============================================================ */
  function ensureInterval() {
    if (S.intervalId == null) {
      S.intervalId = setInterval(tick, TICK_MS);
    }
  }

  function stopInterval() {
    if (S.intervalId != null) {
      clearInterval(S.intervalId);
      S.intervalId = null;
    }
  }

  /* ---------- 计时运行中关闭/刷新页面时给出原生确认 ---------- */
  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '';
  }

  // 按当前状态同步 beforeunload 监听（幂等）；pendingSave 表示记录未保存，也保持拦截
  function syncBeforeUnload() {
    if (S.status !== 'idle' || S.pendingSave) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function tick() {
    if (S.status !== 'running') return;
    var elapsed = phaseElapsed();

    if (S.phase === 'work' && S.timer.mode === 'countup') {
      if (!S.overtime && elapsed >= workMs()) {
        S.overtime = true;
        window.App.playChime('reach');
        window.App.notify('已达成目标时长', '可以继续专注，或结束本次');
        window.App.toast('已达到目标工作时长，可继续专注或点击「结束专注」');
        var label = document.getElementById('tm-phase-label');
        if (label) label.textContent = '已达标 · 可继续';
        var root = container();
        var finishBtn = root ? root.querySelector('[data-action="finish"]') : null;
        if (finishBtn) finishBtn.className = 'btn btn-primary';
      }
      updateClock();
      syncTitle();
      return;
    }

    var total = S.phase === 'break' ? breakMs() : workMs();
    if (elapsed >= total) {
      if (S.phase === 'work') {
        S.workElapsedMs += total;
        if (S.timer.breakMinutes > 0) {
          // 先切阶段（休息计时立即开始），再提示，不阻塞计时
          enterPhase('break');
          window.App.playChime('workEnd');
          window.App.notify('专注结束 🎉', '辛苦了，开始 ' + S.timer.breakMinutes + ' 分钟休息吧');
          window.App.toast('工作结束，休息 ' + S.timer.breakMinutes + ' 分钟');
        } else {
          finishSession();
        }
      } else {
        window.App.playChime('breakEnd');
        window.App.notify('休息结束', '回来总结一下这次专注吧');
        window.App.toast('休息结束，本次专注完成');
        finishSession();
      }
      return;
    }
    updateClock();
    syncTitle();
  }

  function enterPhase(phase) {
    S.phase = phase;
    S.elapsedBase = 0;
    S.phaseStartTs = Date.now();
    render();
  }

  /* ---------- 开始流程 ---------- */
  function askPlanned(prevText) {
    var bodyHTML =
      '<div class="tm-form-field">' +
        '<label class="tm-form-label">预计完成的内容 <span class="tm-required">*</span></label>' +
        '<textarea class="textarea" id="tm-planned-input" placeholder="例如：完成第三章习题 1~10">' +
        esc(prevText || '') + '</textarea>' +
      '</div>';
    var promise = window.App.modal({
      title: '开始专注',
      bodyHTML: bodyHTML,
      actions: [
        { label: '取消', value: null, kind: 'ghost' },
        { label: '开始', value: 'go', kind: 'primary' },
      ],
    });
    var input = document.getElementById('tm-planned-input');
    if (input) input.focus();
    promise.then(function (v) {
      if (v !== 'go') return;
      var text = input ? input.value.trim() : '';
      if (!text) {
        window.App.toast('请填写预计完成的内容');
        askPlanned(text);
        return;
      }
      startSession(text);
    });
  }

  function startSession(planned) {
    var timers = window.Store.getTimers();
    var t = timers.filter(function (x) { return x.id === S.selectedId; })[0] || timers[0];
    // 强制数值化时长（防 localStorage 被篡改后倒计时 NaN 永不结束），写入 session 也用该值
    S.timer = {
      id: t.id,
      name: t.name,
      workMinutes: clampInt(t.workMinutes, 1, 180, 25),
      breakMinutes: clampInt(t.breakMinutes, 0, 60, 5),
      mode: t.mode,
    };
    S.planned = planned;
    S.status = 'running';
    S.phase = 'work';
    S.elapsedBase = 0;
    S.phaseStartTs = Date.now();
    S.workElapsedMs = 0;
    S.startTime = Date.now();
    S.overtime = false;
    S.lastClockText = '';
    ensureInterval();
    syncBeforeUnload();
    // 用户手势链路内：预热/解锁音频 + 开始提示音
    window.App.unlockAudio();
    window.App.playChime('start');
    render();
  }

  /* ---------- 暂停 / 继续 ---------- */
  function togglePause() {
    if (S.status === 'running') {
      S.elapsedBase += Date.now() - S.phaseStartTs;
      S.status = 'paused';
    } else if (S.status === 'paused') {
      S.phaseStartTs = Date.now();
      S.status = 'running';
    }
    render();
  }

  /* ---------- 放弃 ---------- */
  function confirmAbandon() {
    // 弹窗期间冻结计时（等价暂停语义），避免计时继续走或与到期弹窗堆叠
    var wasRunning = S.status === 'running';
    if (wasRunning) {
      S.elapsedBase += Date.now() - S.phaseStartTs;
      S.status = 'paused';
      render();
    }
    window.App.modal({
      title: '放弃本次专注',
      bodyHTML: '<p class="tm-modal-text">放弃后本次专注不会被记录，确定要放弃吗？</p>',
      actions: [
        { label: '再想想', value: null, kind: 'ghost' },
        { label: '放弃', value: 'abandon', kind: 'danger' },
      ],
    }).then(function (v) {
      if (v !== 'abandon') {
        // 取消放弃：恢复冻结前的运行状态
        if (wasRunning && S.status === 'paused') {
          S.phaseStartTs = Date.now();
          S.status = 'running';
          render();
        }
        return;
      }
      resetState();
      render();
      window.App.toast('已放弃本次专注');
    });
  }

  function resetState() {
    stopInterval();
    S.status = 'idle';
    S.timer = null;
    S.planned = '';
    S.overtime = false;
    S.elapsedBase = 0;
    S.workElapsedMs = 0;
    S.pendingSave = false; // 记录已保存或已确认丢弃，解除关页拦截
    syncBeforeUnload();
  }

  /* ---------- 结束流程（含评分弹窗） ---------- */
  function finishSession() {
    // 冻结计时
    if (S.phase === 'work') S.workElapsedMs += phaseElapsed();
    stopInterval();
    S.status = 'idle';
    S.pendingSave = true; // 记录尚未保存：保存成功或确认丢弃前不解除关页拦截
    syncBeforeUnload();
    var focusMinutes = Math.round((S.workElapsedMs / 60000) * 10) / 10;
    var timer = S.timer;
    var startTime = S.startTime;
    var planned = S.planned;

    askActualAndStars({
      timer: timer,
      focusMinutes: focusMinutes,
      startTime: startTime,
      planned: planned,
      actual: '',
      stars: 0,
    });
    render();
  }

  function askActualAndStars(ctx) {
    var bodyHTML =
      '<div class="tm-end-summary">' +
        '<span class="tm-badge tm-badge-down">' + esc(ctx.timer.name) + '</span>' +
        '<span>本次专注 ' + window.App.fmtMinutes(ctx.focusMinutes) + '</span>' +
      '</div>' +
      '<div class="tm-form-field">' +
        '<label class="tm-form-label">实际完成了哪些内容 <span class="tm-required">*</span></label>' +
        '<textarea class="textarea" id="tm-actual-input" placeholder="例如：完成了习题 1~8，第 9 题待续">' +
        esc(ctx.actual) + '</textarea>' +
      '</div>' +
      '<div class="tm-form-field">' +
        '<label class="tm-form-label">为这次专注打分</label>' +
        '<div class="tm-stars" id="tm-stars">' + starsHTML(ctx.stars) + '</div>' +
        '<div class="tm-stars-score"><span id="tm-stars-score-num">' + fmtScore(ctx.stars) + '</span>' +
          '<button type="button" class="tm-stars-clear" id="tm-stars-clear">清除</button></div>' +
      '</div>';

    // dismissible:false —— 只能点按钮关闭，避免 ESC/遮罩误触丢记录
    var promise = window.App.modal({
      title: '专注完成',
      bodyHTML: bodyHTML,
      dismissible: false,
      actions: [
        { label: '丢弃记录', value: 'discard', kind: 'danger' },
        { label: '保存记录', value: 'save', kind: 'primary' },
      ],
    });

    // 绑定评分控件与输入框
    var starVal = ctx.stars;
    var wrap = document.getElementById('tm-stars');
    var input = document.getElementById('tm-actual-input');
    function setStars(v) {
      starVal = v;
      if (wrap) wrap.innerHTML = starsHTML(v);
      var score = document.getElementById('tm-stars-score-num');
      if (score) score.textContent = fmtScore(v);
    }
    if (wrap) {
      bindStars(wrap, setStars, function () { return starVal; });
    }
    var clearBtn = document.getElementById('tm-stars-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () { setStars(0); });
    }

    // 把当前表单内容快照回 ctx（用于重开弹窗时保留已填内容）
    function snapshotCtx() {
      ctx.actual = input ? input.value.trim() : '';
      ctx.stars = starVal;
    }

    promise.then(function (v) {
      if (v === 'discard') {
        snapshotCtx();
        // 二次确认后才真正丢弃
        window.App.modal({
          title: '丢弃记录',
          bodyHTML: '<p class="tm-modal-text">确定丢弃本次专注记录吗？</p>',
          actions: [
            { label: '再想想', value: null, kind: 'ghost' },
            { label: '确定丢弃', value: 'yes', kind: 'danger' },
          ],
        }).then(function (v2) {
          if (v2 !== 'yes') {
            askActualAndStars(ctx); // 返回评分弹窗，保留已填内容
            return;
          }
          resetState();
          render();
          window.App.toast('已丢弃本次专注记录');
        });
        return;
      }
      if (v !== 'save') {
        // 兜底：弹窗以非预期方式关闭时也要复位状态，避免 S.timer/S.planned 残留
        resetState();
        render();
        return;
      }
      var actual = input ? input.value.trim() : '';
      if (!actual) {
        window.App.toast('请填写实际完成的内容');
        snapshotCtx();
        askActualAndStars(ctx);
        return;
      }
      var saved = window.Store.addSession({
        timerId: ctx.timer.id,
        timerName: ctx.timer.name,
        planned: ctx.planned,
        actual: actual,
        stars: starVal,
        workMinutes: ctx.timer.workMinutes,
        breakMinutes: ctx.timer.breakMinutes,
        mode: ctx.timer.mode,
        startTime: ctx.startTime,
        endTime: Date.now(),
        date: window.Store.toDateStr(new Date(ctx.startTime)), // 跨午夜时归属到开始日
        focusMinutes: ctx.focusMinutes,
      });
      if (!saved) {
        // localStorage 写失败：不 resetState，重开弹窗让用户可重试/先去导出
        window.App.toast('保存失败：浏览器存储不可用或已满');
        snapshotCtx();
        askActualAndStars(ctx);
        return;
      }
      window.App.toast('专注记录已保存');
      resetState();
      render();
    });
  }

  /* ---------- 星级评分控件 ---------- */
  var STAR_COUNT = 10;

  function fmtScore(v) {
    var n = v % 1 ? v.toFixed(1) : String(v);
    return n + ' / 10';
  }

  function starsHTML(value) {
    var html = '';
    for (var i = 0; i < STAR_COUNT; i++) {
      var fill = Math.min(1, Math.max(0, value - i)); // 0 / 0.5 / 1
      var lit = fill > 0 ? ' lit' : '';
      html +=
        '<button type="button" class="tm-star' + lit + '" data-i="' + i + '"' +
        ' style="animation-delay:' + (i * 40) + 'ms" aria-label="' + (i + 1) + '星">' +
          '<span class="tm-star-bg">★</span>' +
          '<span class="tm-star-fill" style="width:' + fill * 100 + '%">★</span>' +
        '</button>';
    }
    return html;
  }

  // onChange(v) 设定新值；getVal() 读取当前已选值
  function bindStars(wrap, onChange, getVal) {
    // 悬停预览（鼠标）
    wrap.addEventListener('mousemove', function (e) {
      var star = e.target.closest('.tm-star');
      if (!star) return;
      var r = star.getBoundingClientRect();
      var half = e.clientX - r.left < r.width / 2;
      var i = parseInt(star.getAttribute('data-i'), 10);
      preview(wrap, i + (half ? 0.5 : 1));
    });
    wrap.addEventListener('mouseleave', function () {
      preview(wrap, getVal());
    });
    // 鼠标点击：按点击位置区分左半星 / 右半星
    wrap.addEventListener('click', function (e) {
      var star = e.target.closest('.tm-star');
      if (!star) return;
      var r = star.getBoundingClientRect();
      var half = e.clientX - r.left < r.width / 2;
      var i = parseInt(star.getAttribute('data-i'), 10);
      var v = i + (half ? 0.5 : 1);
      // 已打 0.5 分时再点第 1 颗星的左半 => 清零
      if (v === 0.5 && getVal() === 0.5) v = 0;
      onChange(v);
    });
    // 触摸设备：点按切换半星 / 整星
    wrap.addEventListener('touchend', function (e) {
      var star = e.target.closest('.tm-star');
      if (!star) return;
      e.preventDefault(); // 阻止合成 click
      var i = parseInt(star.getAttribute('data-i'), 10);
      var full = i + 1;
      onChange(getVal() === full ? full - 0.5 : full);
    });
  }

  // 只更新填充宽度，不重建 DOM（保证悬停流畅）
  function preview(wrap, value) {
    var stars = wrap.querySelectorAll('.tm-star');
    stars.forEach(function (star, i) {
      var fill = Math.min(1, Math.max(0, value - i));
      var fillEl = star.querySelector('.tm-star-fill');
      if (fillEl) fillEl.style.width = fill * 100 + '%';
      star.classList.toggle('lit', fill > 0);
    });
    var score = document.getElementById('tm-stars-score-num');
    if (score) score.textContent = fmtScore(value);
  }

  /* ============================================================
     计时器 新建 / 编辑 / 删除
     ============================================================ */
  function openTimerForm(timer, snapshot) {
    var isNew = !timer;
    var t = timer || { name: '', workMinutes: 25, breakMinutes: 5, mode: 'countdown' };
    // 校验失败重开时传入的表单快照优先，避免丢失其他已填字段
    if (snapshot) {
      t = {
        id: t.id,
        name: snapshot.name,
        workMinutes: snapshot.workMinutes,
        breakMinutes: snapshot.breakMinutes,
        mode: snapshot.mode,
      };
    }
    // 防御脏数据：回填前强制数值化（非法值回退默认）
    var tWork = clampInt(t.workMinutes, 1, 180, 25);
    var tBreak = clampInt(t.breakMinutes, 0, 60, 5);
    var bodyHTML =
      '<div class="tm-form-field">' +
        '<label class="tm-form-label">名称 <span class="tm-required">*</span></label>' +
        '<input class="input" id="tm-f-name" maxlength="20" placeholder="例如：深度工作" value="' + esc(t.name) + '">' +
      '</div>' +
      '<div class="tm-form-row">' +
        '<div class="tm-form-field">' +
          '<label class="tm-form-label">工作分钟数</label>' +
          '<input class="input" id="tm-f-work" type="number" min="1" max="180" value="' + tWork + '">' +
        '</div>' +
        '<div class="tm-form-field">' +
          '<label class="tm-form-label">休息分钟数</label>' +
          '<input class="input" id="tm-f-break" type="number" min="0" max="60" value="' + tBreak + '">' +
        '</div>' +
      '</div>' +
      '<div class="tm-form-field">' +
        '<label class="tm-form-label">计时方式</label>' +
        '<div class="tm-radio-row">' +
          '<label class="tm-radio"><input type="radio" name="tm-f-mode" value="countdown"' +
            (t.mode !== 'countup' ? ' checked' : '') + '><span>倒计时</span></label>' +
          '<label class="tm-radio"><input type="radio" name="tm-f-mode" value="countup"' +
            (t.mode === 'countup' ? ' checked' : '') + '><span>正计时</span></label>' +
        '</div>' +
      '</div>';

    var promise = window.App.modal({
      title: isNew ? '新建计时器' : '编辑计时器',
      bodyHTML: bodyHTML,
      actions: [
        { label: '取消', value: null, kind: 'ghost' },
        { label: '保存', value: 'save', kind: 'primary' },
      ],
    });

    // 弹窗节点已同步插入，先拿引用（保存时弹窗可能已关闭，节点引用仍有效）
    var nameEl = document.getElementById('tm-f-name');
    var workEl = document.getElementById('tm-f-work');
    var breakEl = document.getElementById('tm-f-break');
    var modeRadios = Array.prototype.slice.call(document.getElementsByName('tm-f-mode'));

    promise.then(function (v) {
      if (v !== 'save') return;
      var name = nameEl ? nameEl.value.trim() : '';
      var work = clampInt(workEl && workEl.value, 1, 180, 25);
      var brk = clampInt(breakEl && breakEl.value, 0, 60, 5);
      var mode = 'countdown';
      for (var i = 0; i < modeRadios.length; i++) {
        if (modeRadios[i].checked) mode = modeRadios[i].value;
      }
      if (!name) {
        window.App.toast('请填写计时器名称');
        // 重开时带上当前表单快照，保留其他已填字段
        openTimerForm(isNew ? null : timer, {
          name: name,
          workMinutes: work,
          breakMinutes: brk,
          mode: mode,
        });
        return;
      }
      var saved = window.Store.saveTimer({
        id: isNew ? undefined : t.id,
        name: name,
        workMinutes: work,
        breakMinutes: brk,
        mode: mode,
      });
      if (saved) {
        S.selectedId = saved.id;
        window.App.toast(isNew ? '计时器已创建' : '计时器已更新');
        render();
        return;
      }
      // localStorage 写失败：toast 并带当前表单快照重开弹窗，避免已填内容丢失
      window.App.toast('保存失败：浏览器存储不可用或已满');
      openTimerForm(isNew ? null : timer, {
        name: name,
        workMinutes: work,
        breakMinutes: brk,
        mode: mode,
      });
    });
  }

  function confirmDelete(id) {
    var t = window.Store.getTimers().filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    window.App.modal({
      title: '删除计时器',
      bodyHTML: '<p class="tm-modal-text">确定删除「' + esc(t.name) + '」吗？相关历史记录会保留。</p>',
      actions: [
        { label: '取消', value: null, kind: 'ghost' },
        { label: '删除', value: 'del', kind: 'danger' },
      ],
    }).then(function (v) {
      if (v !== 'del') return;
      if (window.Store.deleteTimer(id)) {
        if (S.selectedId === id) S.selectedId = 'default';
        window.App.toast('计时器已删除');
      } else {
        window.App.toast('删除失败：浏览器存储不可用或已满');
      }
      render();
    });
  }

  /* ============================================================
     事件委托
     ============================================================ */
  function bindEvents(root) {
    if (eventsBound) return;
    eventsBound = true;

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el || !root.contains(el)) return;
      var action = el.getAttribute('data-action');
      var id = el.getAttribute('data-id');

      switch (action) {
        case 'select':
          S.selectedId = id;
          render();
          break;
        case 'new':
          openTimerForm(null);
          break;
        case 'edit':
          e.stopPropagation();
          openTimerForm(window.Store.getTimers().filter(function (x) { return x.id === id; })[0]);
          break;
        case 'del':
          e.stopPropagation();
          confirmDelete(id);
          break;
        case 'start':
          window.App.unlockAudio(); // 真实点击手势内预热音频，绕过自动播放限制
          if (window.App.prepareNotify) window.App.prepareNotify(); // 手势内请求通知权限（后台阶段提醒的前提）
          askPlanned('');
          break;
        case 'pause':
          togglePause();
          break;
        case 'abandon':
          confirmAbandon();
          break;
        case 'finish':
          finishSession();
          break;
      }
    });

    // 卡片键盘可达性
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // 焦点在「编辑/删除」按钮上时放行原生点击行为，不劫持成选中卡片
      if (e.target.closest('[data-action="edit"], [data-action="del"]')) return;
      var el = e.target.closest('[data-action="select"], [data-action="new"]');
      if (!el) return;
      e.preventDefault();
      el.click();
    });
  }

  /* ---------- 暴露 ---------- */
  window.Timer = { render: render };
})();
