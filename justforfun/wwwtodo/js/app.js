/* ============================================================
   WWWtodo — app.js 路由与应用壳逻辑（全局命名空间 window.App）
   ------------------------------------------------------------
   模块对接约定（模块 agent 必须遵守）：
   - 各模块全局命名空间：window.Timer / window.History / window.Diary，
     各自暴露 render() 方法，渲染到自己的 section 容器
     （#view-timer / #view-history / #view-diary）。
   - 视图切换由 App.show(view) 负责，切换时会调用对应模块的 render()。
   - 通用能力请复用 App.modal() / App.toast() 与 base.css 的通用样式，
     不要各自造弹窗和提示。
   ============================================================ */
(function () {
  'use strict';

  var VIEWS = ['timer', 'history', 'diary'];
  // 视图名 -> 模块命名空间名
  var MODULE_OF = { timer: 'Timer', history: 'History', diary: 'Diary' };

  var currentView = null;

  /* ---------- 视图切换 ---------- */
  function show(view) {
    if (VIEWS.indexOf(view) < 0) return;
    currentView = view;

    // 切换 section 显隐
    VIEWS.forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== view);
    });

    // 导航激活态
    document.querySelectorAll('#nav .nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });

    // 防御式调用模块 render()：模块未实现时不报错
    var moduleName = MODULE_OF[view];
    var mod = window[moduleName];
    if (mod && typeof mod.render === 'function') {
      try {
        mod.render();
      } catch (e) {
        console.error('[App] ' + moduleName + '.render() 出错:', e);
      }
    }
  }

  function bindNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-item');
      if (!btn) return;
      show(btn.getAttribute('data-view'));
    });
  }

  /* ---------- 通用弹窗 ----------
     App.modal({ title, bodyHTML, actions, dismissible })
       - actions: [{ label, value, kind }] kind 可选 'primary' | 'ghost' | 'danger'，
         默认 'ghost'；value 为用户点击后 Promise resolve 的值。
       - ESC / 点击遮罩 / 右上角关闭 => resolve(null)。
       - dismissible: false 时禁用 ESC/遮罩/右上角关闭，只能点 actions 按钮。
       - 打开时聚焦弹窗内可交互元素（优先 .modal-body 内第一个，其次主按钮），
         Tab 焦点限制在弹窗内（跳过禁用/不可见元素），
         多个弹窗堆叠时 ESC 只关闭最顶层，关闭后焦点归还给打开前的元素。
     返回 Promise。 */
  function modal(options) {
    var opts = options || {};
    var actions = Array.isArray(opts.actions) ? opts.actions : [];
    var dismissible = opts.dismissible !== false;
    if (!dismissible && !actions.length) {
      // 契约隐患兜底：不可关闭又没有按钮，弹窗将永远无法关闭
      console.warn('[App] modal: dismissible:false 但未提供 actions，弹窗将无法关闭');
    }
    var root = document.getElementById('modal-root');
    var prevActive = document.activeElement;

    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      var box = document.createElement('div');
      box.className = 'modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('tabindex', '-1'); // 无其他可聚焦元素时兜底聚焦弹窗本身

      var header = document.createElement('div');
      header.className = 'modal-header';
      var title = document.createElement('div');
      title.className = 'modal-title';
      title.textContent = opts.title || '';
      header.appendChild(title);
      var closeBtn = null;
      if (dismissible) {
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-close';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.textContent = '×';
        header.appendChild(closeBtn);
      }

      var body = document.createElement('div');
      body.className = 'modal-body';
      body.innerHTML = opts.bodyHTML || '';

      var footer = document.createElement('div');
      footer.className = 'modal-actions';
      actions.forEach(function (a) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-' + (a.kind || 'ghost');
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          finish(a.value);
        });
        footer.appendChild(btn);
      });

      box.appendChild(header);
      box.appendChild(body);
      if (actions.length) box.appendChild(footer);
      overlay.appendChild(box);
      root.appendChild(overlay);

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeydown);
        overlay.classList.remove('show');
        // 等淡出动画结束后再移除节点
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          // 焦点归还给打开前的元素；若该元素已不在文档中，则归还到 body
          try {
            if (prevActive && document.contains(prevActive)) {
              prevActive.focus();
            } else if (document.body && typeof document.body.focus === 'function') {
              document.body.focus();
            }
          } catch (e) { /* 忽略焦点归还失败 */ }
          resolve(value);
        }, 220);
      }

      // 弹窗堆叠时只有最顶层的 overlay 响应 ESC / 焦点陷阱
      function isTopMost() {
        return root.lastElementChild === overlay;
      }

      var FOCUSABLE =
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), ' +
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

      // 可聚焦元素 = 匹配选择器且可见（offsetParent 为 null 视为不可见，跳过）
      function visibleFocusables(container) {
        return Array.prototype.filter.call(
          container.querySelectorAll(FOCUSABLE),
          function (el) { return el.offsetParent !== null; }
        );
      }

      function onKeydown(e) {
        if (e.key === 'Escape') {
          if (dismissible && isTopMost()) finish(null);
          return;
        }
        if (e.key !== 'Tab' || !isTopMost()) return;
        // 简单焦点陷阱：Tab 焦点跑出弹窗时拉回（禁用/不可见元素不参与）
        var focusables = visibleFocusables(box);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !box.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !box.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
      document.addEventListener('keydown', onKeydown);
      if (closeBtn) {
        closeBtn.addEventListener('click', function () { finish(null); });
      }
      if (dismissible) {
        overlay.addEventListener('mousedown', function (e) {
          if (e.target === overlay) finish(null);
        });
      }

      // 打开时聚焦：优先 .modal-body 内第一个可交互元素，其次主按钮，
      // 都没有才兜底右上角 ×，最后退到弹窗本身
      var focusTarget =
        visibleFocusables(body)[0] ||
        box.querySelector('.btn-primary:not([disabled])') ||
        closeBtn ||
        box;
      focusTarget.focus();

      // 触发淡入 + 上移动画
      requestAnimationFrame(function () {
        overlay.classList.add('show');
      });
    });
  }

  /* ---------- Toast 轻提示（2.5s 自动消失，最多同时保留 3 条） ---------- */
  var TOAST_MAX = 3;
  function toast(msg) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    // 堆积上限：超过 3 条时移除最旧的一条
    while (root.children.length >= TOAST_MAX) {
      root.removeChild(root.firstElementChild);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.add('hide');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, 2500);
  }

  /* ---------- 通用格式化工具 ---------- */
  // App.fmtDate(d) -> 'YYYY-MM-DD'（本地时区）；d 可为 Date / 时间戳，缺省为今天
  function fmtDate(d) {
    var date = d == null ? new Date() : d instanceof Date ? d : new Date(d);
    if (window.Store) return window.Store.toDateStr(date);
    // Store 未加载时的兜底：本地时区手动拼接（与 Store.toDateStr 同逻辑）
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // App.fmtTime(ts) -> 'HH:MM'（本地时区）；ts 为时间戳，缺省为现在；
  // 非法时间戳（NaN/Infinity/Invalid Date）输出 '--:--'
  function fmtTime(ts) {
    var d = ts == null ? new Date() : new Date(ts);
    if (isNaN(d.getTime())) return '--:--';
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    );
  }

  // App.fmtMinutes(min) -> '1小时25分' / '45分'
  function fmtMinutes(min) {
    var m = Math.round(Number(min) || 0);
    if (m < 60) return m + '分';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + '小时' + rest + '分' : h + '小时';
  }

  // HTML 转义（渲染用户输入时务必使用）
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- 提示音（Web Audio 合成，无外部音频文件，file:// 可用） ---------- */
  var audioCtx = null;

  // 懒创建 AudioContext 单例；无声/不支持环境返回 null
  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  // 在用户手势里调用以预热/解锁 AudioContext（浏览器自动播放策略）
  function unlockAudio() {
    try {
      var ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* 静默 */ }
  }

  // 单个音符：freq 频率，start 相对 ctx.currentTime 的偏移秒数，dur 时长
  function playNote(ctx, freq, start, dur) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var t = ctx.currentTime + start;
    osc.type = 'sine';
    osc.frequency.value = freq;
    // 快速 attack + 平滑 release 包络，避免爆音；音量适中
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.015);
    gain.gain.setValueAtTime(0.25, t + Math.max(0.015, dur - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  var CHIMES = {
    start: [[880, 0, 0.15]],
    workEnd: [[660, 0, 0.2], [880, 0.22, 0.2]],
    breakEnd: [[660, 0, 0.15], [880, 0.17, 0.15], [990, 0.34, 0.22]],
    reach: [[520, 0, 0.35]],
  };

  // App.playChime(type)：type 为 'start' | 'workEnd' | 'breakEnd' | 'reach'，未知类型按 'reach'
  function playChime(type) {
    try {
      var ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      var notes = CHIMES[type] || CHIMES.reach;
      notes.forEach(function (n) { playNote(ctx, n[0], n[1], n[2]); });
    } catch (e) { /* 无声环境静默，不影响计时流程 */ }
  }

  /* ---------- 系统通知（Notification API） ---------- */
  var notifyDenied = false;   // session 内记住用户拒绝，不再重复请求
  var notifyPending = false;  // 权限请求进行中，避免并发重复弹请求

  // 发起权限请求（仅 default 状态时），granted 后执行 onGranted
  function requestNotifyPermission(onGranted) {
    if (notifyDenied || notifyPending) return;
    notifyPending = true;
    var handled = false; // 回调与 Promise 可能都触发，只处理一次
    function onPerm(perm) {
      if (handled) return;
      handled = true;
      notifyPending = false;
      if (perm === 'granted') { if (onGranted) onGranted(); }
      else notifyDenied = true;
    }
    var p = Notification.requestPermission(onPerm);
    if (p && typeof p.then === 'function') {
      p.then(onPerm).catch(function () {});
    }
  }

  // App.prepareNotify()：在用户手势里主动预热通知权限。
  // 必须在手势上下文中请求——否则首次阶段提醒发生在后台时，浏览器可能直接拒绝。
  function prepareNotify() {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') requestNotifyPermission(null);
    } catch (e) { /* 静默 */ }
  }

  // App.notify(title, body)：页面可见时静默（交由应用内提示），隐藏时发系统通知
  function notify(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      // 页面可见时不发系统通知，避免打扰（应用内已有 toast/弹窗）
      if (typeof document !== 'undefined' && !document.hidden) return;

      function send() {
        try {
          var n = new Notification(title, { body: body || '' });
          n.onclick = function () {
            try { window.focus(); } catch (e) { /* 忽略 */ }
            n.close();
          };
        } catch (e) { /* 忽略 */ }
      }

      if (Notification.permission === 'granted') {
        send();
      } else if (Notification.permission === 'default') {
        requestNotifyPermission(send);
      }
    } catch (e) { /* 静默 */ }
  }

  /* ---------- 启动 ---------- */
  function init() {
    bindNav();
    show('timer'); // 默认显示「专注」视图
  }

  window.App = {
    show: show,
    currentView: function () { return currentView; },
    modal: modal,
    toast: toast,
    playChime: playChime,
    notify: notify,
    unlockAudio: unlockAudio,
    prepareNotify: prepareNotify,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtMinutes: fmtMinutes,
    escapeHTML: escapeHTML,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
