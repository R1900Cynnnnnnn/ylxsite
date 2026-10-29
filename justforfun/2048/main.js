/* main.js —— 页面接线：输入 → game.move → scene.playMove → UI 更新 */
(function () {
  'use strict';

  var BOARD_SIZE = 4;
  var BEST_KEY = 'pastel-2048-best-score';
  var LEADERBOARD_KEY = 'pastel-2048-leaderboard';
  var PLAYER_NAME_KEY = 'pastel-2048-player-name';
  var LEADERBOARD_MAX = 10;

  // ---------- DOM ----------
  var container = document.getElementById('board-container');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best-score');
  var newGameBtn = document.getElementById('new-game-btn');
  var winOverlay = document.getElementById('win-overlay');
  var loseOverlay = document.getElementById('lose-overlay');
  var continueBtn = document.getElementById('continue-btn');
  var winNewGameBtn = document.getElementById('win-new-game-btn');
  var loseNewGameBtn = document.getElementById('lose-new-game-btn');
  var leaderboardList = document.getElementById('leaderboard-list');
  var leaderboardEmpty = document.getElementById('leaderboard-empty');

  // ---------- 状态 ----------
  var game = new Game2048(BOARD_SIZE);
  var scene = new BoardScene(container, BOARD_SIZE);
  var bestScore = loadBest();
  var inputLocked = false;   // 动画期间锁定输入
  var pendingDir = null;     // 动画期间缓存的方向输入（只保留最新一个）
  var wonShown = false;      // 本局胜利遮罩是否已显示过
  var liveActive = false;    // 本局是否仍在进行（结束后本局条目转为持久条目）

  bestEl.textContent = bestScore;

  // ---------- 工具 ----------
  function loadBest() {
    try {
      var v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) { /* 隐私模式等场景下忽略 */ }
  }

  // ---------- 排行榜 ----------
  function loadLeaderboard() {
    try {
      var raw = localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLeaderboard(list) {
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    } catch (e) { /* 隐私模式等场景下忽略 */ }
  }

  // 分数>0 且能进前 10 才算上榜
  function qualifiesForLeaderboard(score) {
    if (score <= 0) return false;
    var list = loadLeaderboard();
    return list.length < LEADERBOARD_MAX || score > list[list.length - 1].score;
  }

  function getPlayerName() {
    var name = peekPlayerName();
    if (name === null) {
      var input = window.prompt('恭喜上榜！请输入你的名字：', '无名玩家');
      name = (input && input.trim()) ? input.trim() : '无名玩家';
      try {
        localStorage.setItem(PLAYER_NAME_KEY, name);
      } catch (e) { /* ignore */ }
    }
    return name;
  }

  // 只读取已存的玩家名，不弹 prompt（玩的过程中不打断）
  function peekPlayerName() {
    try {
      return localStorage.getItem(PLAYER_NAME_KEY);
    } catch (e) {
      return null;
    }
  }

  // 记录一条成绩并返回新记录在榜内的索引；未上榜返回 -1
  function recordScore(score) {
    if (!qualifiesForLeaderboard(score)) return -1;
    var entry = {
      name: getPlayerName(),
      score: score,
      date: new Date().toISOString()
    };
    var list = loadLeaderboard();
    list.push(entry);
    list.sort(function (a, b) { return b.score - a.score; });
    list = list.slice(0, LEADERBOARD_MAX);
    saveLeaderboard(list);
    return list.indexOf(entry);
  }

  function renderLeaderboard(highlightIndex) {
    var list = loadLeaderboard();

    // 组装展示列表：持久记录 + 进行中的本局条目（分数>0 时参与实时排序）
    var display = list.slice();
    var liveEntry = null;
    if (liveActive && game.score > 0) {
      var storedName = peekPlayerName();
      liveEntry = {
        name: storedName ? storedName + '（本局）' : '本局',
        score: game.score,
        live: true
      };
      display.push(liveEntry);
      display.sort(function (a, b) { return b.score - a.score; });
    }

    leaderboardList.innerHTML = '';

    if (display.length === 0) {
      leaderboardEmpty.classList.remove('hidden');
      return;
    }
    leaderboardEmpty.classList.add('hidden');

    var persistentIndex = 0; // highlightIndex 针对持久榜单的索引
    display.forEach(function (entry, i) {
      var isLive = !!entry.live;
      var li = document.createElement('li');
      li.className = 'leaderboard-item';
      if (isLive) {
        li.className += ' live';
      } else {
        if (persistentIndex === highlightIndex) li.className += ' latest';
        persistentIndex++;
      }

      var rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = i + 1;

      var name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = entry.name;

      li.appendChild(rank);
      li.appendChild(name);

      if (isLive) {
        var badge = document.createElement('span');
        badge.className = 'live-badge';
        badge.textContent = '进行中';
        li.appendChild(badge);
      }

      var score = document.createElement('span');
      score.className = 'leaderboard-score';
      score.textContent = entry.score;

      li.appendChild(score);
      leaderboardList.appendChild(li);
    });
  }

  function bump(el) {
    el.classList.remove('bump');
    // 触发重排以重启动画
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function updateScore(result) {
    scoreEl.textContent = game.score;
    if (result && result.scoreDelta > 0) bump(scoreEl);
    if (game.score > bestScore) {
      bestScore = game.score;
      bestEl.textContent = bestScore;
      bump(bestEl);
      saveBest(bestScore);
    }
    renderLeaderboard(-1); // 本局条目随分数实时刷新
  }

  function hideOverlays() {
    winOverlay.classList.add('hidden');
    loseOverlay.classList.add('hidden');
  }

  // ---------- 新游戏 ----------
  function newGame() {
    hideOverlays();
    wonShown = false;
    inputLocked = false;
    pendingDir = null;
    liveActive = true; // 新一局开始，本局条目重新累计
    game.reset();
    updateScore(null);
    scene.syncBoard(game.board);
  }

  // ---------- 执行一次移动 ----------
  function doMove(dir) {
    if (inputLocked) {
      // 动画期间不丢弃输入，缓存最新方向，动画结束后立即执行
      pendingDir = dir;
      return;
    }

    var result = game.move(dir);
    if (!result) return; // 无效移动

    inputLocked = true;
    updateScore(result);

    Promise.resolve(scene.playMove(result, game.board)).then(function () {
      inputLocked = false;

      if (result.over) {
        liveActive = false; // 成绩写入持久榜单，本局条目不再显示
        loseOverlay.classList.remove('hidden');
        // 游戏结束时记录最终分数（胜利后继续挑战的也记最终分）
        var newIndex = recordScore(game.score);
        renderLeaderboard(newIndex);
      } else if (result.won && !wonShown) {
        wonShown = true;
        winOverlay.classList.remove('hidden');
      }

      // 排队的输入立即执行（over 时 game.move 会返回 null，自然丢弃）
      if (pendingDir) {
        var queued = pendingDir;
        pendingDir = null;
        doMove(queued);
      }
    });
  }

  // ---------- 键盘输入 ----------
  var KEY_MAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right'
  };

  document.addEventListener('keydown', function (e) {
    var dir = KEY_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    doMove(dir);
  });

  // ---------- 触摸滑动 ----------
  var touchStartX = 0;
  var touchStartY = 0;
  var touchActive = false;
  var SWIPE_MIN = 24; // 最小滑动距离(px)

  container.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchActive = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchmove', function (e) {
    // 阻止页面滚动（容器已设 touch-action:none，这里是兜底）
    if (touchActive && e.cancelable) e.preventDefault();
  }, { passive: false });

  container.addEventListener('touchend', function (e) {
    if (!touchActive) return;
    touchActive = false;

    var t = e.changedTouches[0];
    var dx = t.clientX - touchStartX;
    var dy = t.clientY - touchStartY;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);

    if (Math.max(absX, absY) < SWIPE_MIN) return;

    var dir;
    if (absX > absY) {
      dir = dx > 0 ? 'right' : 'left';
    } else {
      dir = dy > 0 ? 'down' : 'up';
    }
    doMove(dir);
  });

  // 兜底：触摸被系统取消时重置状态
  container.addEventListener('touchcancel', function () {
    touchActive = false;
  });

  // ---------- 按钮 ----------
  newGameBtn.addEventListener('click', newGame);
  winNewGameBtn.addEventListener('click', newGame);
  loseNewGameBtn.addEventListener('click', newGame);
  continueBtn.addEventListener('click', function () {
    winOverlay.classList.add('hidden');
  });

  // ---------- 窗口尺寸变化 ----------
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      scene.resize();
    }, 80);
  });

  // ---------- 启动 ----------
  renderLeaderboard(-1);
  newGame();
})();
