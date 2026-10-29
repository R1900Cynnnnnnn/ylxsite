/* ============================================================
   WWWtodo — storage.js 数据层（全局命名空间 window.Store）
   所有数据持久化到 localStorage，key 统一前缀 "wwwtodo_"。
   ------------------------------------------------------------
   数据结构约定（模块 agent 必须遵守）：
   - timer   自定义番茄钟配置：
             { id, name, workMinutes, breakMinutes, mode }
             mode: 'countdown' | 'countup'
             内置默认项 { id:'default', name:'经典番茄钟', workMinutes:25,
             breakMinutes:5, mode:'countdown' } 不可删除，getTimers()
             始终把它放在第一位。
   - session 专注记录：
             { id, timerId, timerName, planned, actual, stars,
               workMinutes, breakMinutes, mode, startTime, endTime, date,
               focusMinutes }
             planned: 预计完成的内容（文本）。
             actual:  实际完成的内容（文本）。
             focusMinutes: 实际专注时长（分钟，数字），统计时长时优先使用；
               缺失时按 (endTime - startTime) 推算。
             stars: 0~10 的数字，步进 0.5。
             date: 本地时区 'YYYY-MM-DD'。
   - diary   日记：按日期存储，entry = { text, mood, updatedAt }
             mood 为 emoji 字符串，可为空。
   ============================================================ */
(function () {
  'use strict';

  var PREFIX = 'wwwtodo_';
  var KEY = {
    timers: PREFIX + 'timers',
    sessions: PREFIX + 'sessions',
    diary: PREFIX + 'diary',
  };

  var DEFAULT_TIMER = {
    id: 'default',
    name: '经典番茄钟',
    workMinutes: 25,
    breakMinutes: 5,
    mode: 'countdown',
  };

  /* ---------- 底层读写 ---------- */
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Store] 读取失败:', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[Store] 写入失败:', key, e);
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 时间工具 ---------- */
  // 日期键格式 'YYYY-MM-DD'（日记键、导入清洗等统一口径）
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 本地时区 'YYYY-MM-DD'
  function toDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /* ---------- 番茄钟配置 timers ---------- */
  // 返回全部配置；默认项始终第一位（若被篡改则自动补齐）
  function getTimers() {
    var list = read(KEY.timers, []);
    if (!Array.isArray(list)) list = [];
    var custom = list.filter(function (t) {
      return t && t.id && t.id !== DEFAULT_TIMER.id;
    });
    return [Object.assign({}, DEFAULT_TIMER)].concat(custom);
  }

  // 新增或更新（按 id）。不允许覆盖内置默认项。
  function saveTimer(timer) {
    if (!timer || typeof timer !== 'object') return null;
    var saved = Object.assign(
      {
        id: uid(),
        name: '未命名',
        workMinutes: 25,
        breakMinutes: 5,
        mode: 'countdown',
      },
      timer
    );
    // 调用方可能显式传入 id: undefined（Object.assign 会覆盖默认 id），兜底重新生成
    if (!saved.id) saved.id = uid();
    if (saved.id === DEFAULT_TIMER.id) {
      console.warn('[Store] 内置默认番茄钟不可修改');
      return null;
    }
    var list = getTimers().slice(1); // 去掉默认项
    var idx = list.findIndex(function (t) { return t.id === saved.id; });
    if (idx >= 0) list[idx] = saved;
    else list.push(saved);
    if (!write(KEY.timers, list)) return null;
    return saved;
  }

  // 删除配置。内置默认项不可删除。
  function deleteTimer(id) {
    if (!id || id === DEFAULT_TIMER.id) return false;
    var list = getTimers().slice(1);
    var next = list.filter(function (t) { return t.id !== id; });
    if (next.length === list.length) return false;
    return write(KEY.timers, next);
  }

  /* ---------- 专注记录 sessions ---------- */
  function getSessions() {
    var list = read(KEY.sessions, []);
    return Array.isArray(list) ? list : [];
  }

  function addSession(session) {
    if (!session || typeof session !== 'object') return null;
    var now = Date.now();
    var saved = Object.assign(
      {
        id: uid(),
        timerId: DEFAULT_TIMER.id,
        timerName: DEFAULT_TIMER.name,
        planned: '',         // 预计完成的内容（文本）
        actual: '',          // 实际完成的内容（文本）
        focusMinutes: null,  // 实际专注时长（分钟）；统计时优先使用
        stars: 0,            // 0~10，步进 0.5
        workMinutes: 25,
        breakMinutes: 5,
        mode: 'countdown',
        startTime: now,
        endTime: now,
        date: toDateStr(new Date(now)),
      },
      session
    );
    var list = getSessions();
    list.push(saved);
    if (!write(KEY.sessions, list)) return null;
    return saved;
  }

  // dateStr: 'YYYY-MM-DD'
  function getSessionsByDate(dateStr) {
    return getSessions().filter(function (s) { return s.date === dateStr; });
  }

  // 按 id 局部更新，返回更新后的 session（未找到返回 null）
  function updateSession(id, patch) {
    var list = getSessions();
    var idx = list.findIndex(function (s) { return s.id === id; });
    if (idx < 0) return null;
    list[idx] = Object.assign({}, list[idx], patch, { id: list[idx].id });
    if (!write(KEY.sessions, list)) return null;
    return list[idx];
  }

  /* ---------- 日记 diary ---------- */
  function readDiaryMap() {
    var map = read(KEY.diary, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  // 返回整个日记 map（过滤掉不匹配 'YYYY-MM-DD' 的非法键），
  // 供模块一次取全量，避免逐键读取
  function getDiaryMap() {
    var map = readDiaryMap();
    var out = {};
    Object.keys(map).forEach(function (k) {
      if (DATE_RE.test(k)) out[k] = map[k];
    });
    return out;
  }

  // 返回 { text, mood, updatedAt } 或 null
  function getDiary(dateStr) {
    return readDiaryMap()[dateStr] || null;
  }

  function saveDiary(dateStr, entry) {
    var map = readDiaryMap();
    map[dateStr] = {
      text: entry && typeof entry.text === 'string' ? entry.text : '',
      mood: entry && typeof entry.mood === 'string' ? entry.mood : '',
      updatedAt: Date.now(),
    };
    if (!write(KEY.diary, map)) return null;
    return map[dateStr];
  }

  // 真正删除某天的日记。write 成功返回 true，否则 false。
  function deleteDiary(dateStr) {
    var map = readDiaryMap();
    if (!Object.prototype.hasOwnProperty.call(map, dateStr)) return false;
    delete map[dateStr];
    return write(KEY.diary, map);
  }

  // 返回所有有日记的日期（升序，键过滤口径与 getDiaryMap 一致）
  function getAllDiaryDates() {
    return Object.keys(getDiaryMap()).sort();
  }

  /* ---------- 导出 / 导入 ---------- */

  // 导出全部数据为 JSON 字符串
  function exportAll() {
    return JSON.stringify(
      {
        app: 'WWWtodo',
        version: 1,
        exportedAt: new Date().toISOString(),
        timers: getTimers().slice(1), // 不含内置默认项
        sessions: getSessions(),
        diary: readDiaryMap(),
      },
      null,
      2
    );
  }

  /* ---------- 导入白名单清洗 ---------- */
  function cleanTimer(t) {
    if (!t || typeof t !== 'object' || !t.id || t.id === DEFAULT_TIMER.id) return null;
    var work = Number(t.workMinutes);
    var brk = Number(t.breakMinutes);
    if (!isFinite(work) || !isFinite(brk)) return null;
    // 数值范围钳制（与 timer.js UI 层 clampInt 口径一致）
    work = Math.min(180, Math.max(1, work));
    brk = Math.min(60, Math.max(0, brk));
    return {
      id: String(t.id),
      name: String(t.name == null ? '' : t.name),
      workMinutes: work,
      breakMinutes: brk,
      mode: t.mode === 'countup' ? 'countup' : 'countdown',
    };
  }

  function cleanSession(s) {
    if (!s || typeof s !== 'object') return null;
    var dateStr = String(s.date);
    if (!DATE_RE.test(dateStr)) return null;
    // 正则之外再验证是真日期（拒绝 '2026-13-99'、'2026-02-31' 这类伪日期）
    var dp = dateStr.split('-');
    var dv = new Date(+dp[0], +dp[1] - 1, +dp[2]);
    if (
      dv.getFullYear() !== +dp[0] ||
      dv.getMonth() !== +dp[1] - 1 ||
      dv.getDate() !== +dp[2]
    ) return null;
    var start = Number(s.startTime);
    var end = Number(s.endTime);
    if (!isFinite(start) || !isFinite(end)) return null;
    var stars = Number(s.stars);
    if (!isFinite(stars)) stars = 0;
    if (stars < 0) stars = 0; // 评分下限钳到 0
    var focus = Number(s.focusMinutes);
    var work = Number(s.workMinutes);
    var brk = Number(s.breakMinutes);
    return {
      id: String(s.id == null ? '' : s.id),
      timerId: String(s.timerId == null ? '' : s.timerId),
      timerName: String(s.timerName == null ? '' : s.timerName),
      planned: String(s.planned == null ? '' : s.planned),
      actual: String(s.actual == null ? '' : s.actual),
      stars: stars,
      workMinutes: isFinite(work) ? work : 25,
      breakMinutes: isFinite(brk) ? brk : 5,
      mode: s.mode === 'countup' ? 'countup' : 'countdown',
      startTime: start,
      endTime: end,
      date: String(s.date),
      focusMinutes: s.focusMinutes == null || !isFinite(focus) ? null : focus,
    };
  }

  function cleanDiaryEntry(e) {
    var u = Number(e && e.updatedAt);
    return {
      text: String(e && e.text != null ? e.text : ''),
      mood: String(e && e.mood != null ? e.mood : ''),
      updatedAt: isFinite(u) ? u : Date.now(),
    };
  }

  // 从 JSON 字符串导入全部数据（整体覆盖，白名单清洗 + 原子写入）。返回是否成功。
  function importAll(json) {
    var data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      console.warn('[Store] 导入失败：JSON 解析错误', e);
      return false;
    }
    if (!data || typeof data !== 'object') return false;
    // 无论是否带 app 标识，都要求 timers/sessions/diary 至少一个存在且类型正确，
    // 否则视为无效导入（防止 {"app":"WWWtodo","timers":"junk"} 旁路校验清空数据）
    var hasAny =
      Array.isArray(data.timers) ||
      Array.isArray(data.sessions) ||
      (data.diary && typeof data.diary === 'object' && !Array.isArray(data.diary));
    if (!hasAny) {
      console.warn('[Store] 导入失败：缺少可识别的数据块（timers/sessions/diary）');
      return false;
    }

    // 字段白名单清洗：非法项丢弃、数值强制 Number、文本强制 String
    var timers = Array.isArray(data.timers)
      ? data.timers.map(cleanTimer).filter(Boolean)
      : [];
    var sessions = Array.isArray(data.sessions)
      ? data.sessions.map(cleanSession).filter(Boolean)
      : [];
    var diary = {};
    if (data.diary && typeof data.diary === 'object' && !Array.isArray(data.diary)) {
      Object.keys(data.diary).forEach(function (k) {
        if (!DATE_RE.test(k)) return; // 非法日期键丢弃
        diary[k] = cleanDiaryEntry(data.diary[k]);
      });
    }

    // 原子写入：先全部序列化，再统一写入；任一失败则回滚旧值
    var payload = [
      [KEY.timers, timers],
      [KEY.sessions, sessions],
      [KEY.diary, diary],
    ];
    var serialized;
    try {
      serialized = payload.map(function (p) { return JSON.stringify(p[1]); });
    } catch (e) {
      console.warn('[Store] 导入失败：序列化错误', e);
      return false;
    }
    var backups = payload.map(function (p) {
      try { return localStorage.getItem(p[0]); } catch (e) { return null; }
    });
    for (var i = 0; i < payload.length; i++) {
      try {
        localStorage.setItem(payload[i][0], serialized[i]);
      } catch (e) {
        console.warn('[Store] 导入失败：写入错误，正在回滚', e);
        for (var j = 0; j < i; j++) {
          try {
            if (backups[j] == null) localStorage.removeItem(payload[j][0]);
            else localStorage.setItem(payload[j][0], backups[j]);
          } catch (e2) { /* 尽力回滚 */ }
        }
        return false;
      }
    }
    return true;
  }

  /* ---------- 暴露 API ---------- */
  window.Store = {
    // timers
    getTimers: getTimers,
    saveTimer: saveTimer,
    deleteTimer: deleteTimer,
    DEFAULT_TIMER: DEFAULT_TIMER,
    // sessions
    addSession: addSession,
    getSessions: getSessions,
    getSessionsByDate: getSessionsByDate,
    updateSession: updateSession,
    // diary
    getDiary: getDiary,
    getDiaryMap: getDiaryMap,
    saveDiary: saveDiary,
    deleteDiary: deleteDiary,
    getAllDiaryDates: getAllDiaryDates,
    // utils
    today: function () { return toDateStr(new Date()); },
    toDateStr: toDateStr,
    // backup
    exportAll: exportAll,
    importAll: importAll,
  };
})();
