/**
 * game.js — 纯逻辑 2048 引擎，无 DOM 依赖。
 * 暴露全局类 Game2048（Node 环境下同时挂载到 globalThis，便于测试）。
 *
 * 契约：
 *   const game = new Game2048(4);
 *   game.reset();
 *   const result = game.move('up'|'down'|'left'|'right');
 *   // 无效移动返回 null；有效移动返回:
 *   // { score, scoreDelta, won, over,
 *   //   spawns: [{r, c, value, id}],
 *   //   moves: [{id, value, fromR, fromC, toR, toC, merged, absorb}] }
 *   game.board // size×size 二维数组，元素为 null 或 {id, value}
 *   game.score // 当前分数
 */
(function () {
  'use strict';

  var nextId = 1; // 全局递增唯一 id

  function Game2048(size) {
    this.size = size || 4;
    this.board = [];
    this.score = 0;
    this.won = false; // 是否曾合成过 2048
    this._makeEmptyBoard();
  }

  Game2048.prototype._makeEmptyBoard = function () {
    this.board = [];
    for (var r = 0; r < this.size; r++) {
      var row = [];
      for (var c = 0; c < this.size; c++) row.push(null);
      this.board.push(row);
    }
  };

  /** 清空棋盘并随机生成 2 个初始方块，分数归零。 */
  Game2048.prototype.reset = function () {
    this._makeEmptyBoard();
    this.score = 0;
    this.won = false;
    this._spawnRandom();
    this._spawnRandom();
  };

  /** 在随机空位生成新方块（90% 为 2，10% 为 4），返回 {r, c, value, id} 或 null（无空位）。 */
  Game2048.prototype._spawnRandom = function () {
    var empty = [];
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        if (this.board[r][c] === null) empty.push({ r: r, c: c });
      }
    }
    if (empty.length === 0) return null;
    var cell = empty[Math.floor(Math.random() * empty.length)];
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = { id: nextId++, value: value };
    this.board[cell.r][cell.c] = tile;
    return { r: cell.r, c: cell.c, value: value, id: tile.id };
  };

  /**
   * 对一条线（按移动方向从"最靠近目标边缘"到"最远离"排序的格位序列）执行滑动与合并。
   * line: [{r, c}, ...]，index 0 为最靠近移动方向的格子。
   * 规则：每块每回合最多合并一次（经典 2048 规则，合并后的块不再参与二次合并）。
   * moves 只记录位置发生变化或参与合并的方块。
   */
  Game2048.prototype._slideLine = function (line) {
    var n = line.length;
    var tiles = [];
    var i, pos;
    for (i = 0; i < n; i++) {
      pos = line[i];
      var cell = this.board[pos.r][pos.c];
      if (cell !== null) {
        tiles.push({ tile: cell, fromR: pos.r, fromC: pos.c });
      }
    }
    if (tiles.length === 0) return { moved: false, moves: [], scoreDelta: 0, mergedValues: [], newLineTiles: [], line: line };

    var moved = false;
    var moves = [];
    var scoreDelta = 0;
    var mergedValues = [];
    var newLineTiles = []; // 合并/滑动后，按目标格顺序排列的存活方块
    var target = 0;

    i = 0;
    while (i < tiles.length) {
      var cur = tiles[i];
      var dest = line[target];

      if (i + 1 < tiles.length && tiles[i + 1].tile.value === cur.tile.value) {
        var absorbed = tiles[i + 1];
        var newValue = cur.tile.value * 2;
        cur.tile.value = newValue;
        moves.push({
          id: cur.tile.id, value: newValue,
          fromR: cur.fromR, fromC: cur.fromC,
          toR: dest.r, toC: dest.c, merged: true, absorb: false
        });
        moves.push({
          id: absorbed.tile.id, value: absorbed.tile.value,
          fromR: absorbed.fromR, fromC: absorbed.fromC,
          toR: dest.r, toC: dest.c, merged: true, absorb: true
        });
        scoreDelta += newValue;
        mergedValues.push(newValue);
        newLineTiles.push(cur.tile);
        moved = true; // 合并本身视为位置/状态变化
        i += 2;
      } else {
        if (cur.fromR !== dest.r || cur.fromC !== dest.c) {
          moves.push({
            id: cur.tile.id, value: cur.tile.value,
            fromR: cur.fromR, fromC: cur.fromC,
            toR: dest.r, toC: dest.c, merged: false, absorb: false
          });
          moved = true;
        }
        newLineTiles.push(cur.tile);
        i += 1;
      }
      target += 1;
    }

    return { moved: moved, moves: moves, scoreDelta: scoreDelta, mergedValues: mergedValues, newLineTiles: newLineTiles, line: line };
  };

  /** 按方向构造所有需要处理的线（每条线按移动方向排序，index 0 为最先到达边缘的格子）。 */
  Game2048.prototype._buildLines = function (dir) {
    var s = this.size;
    var lines = [];
    var r, c, line, k;

    if (dir === 'left') {
      for (r = 0; r < s; r++) {
        line = [];
        for (c = 0; c < s; c++) line.push({ r: r, c: c });
        lines.push(line);
      }
    } else if (dir === 'right') {
      for (r = 0; r < s; r++) {
        line = [];
        for (c = s - 1; c >= 0; c--) line.push({ r: r, c: c });
        lines.push(line);
      }
    } else if (dir === 'up') {
      for (c = 0; c < s; c++) {
        line = [];
        for (r = 0; r < s; r++) line.push({ r: r, c: c });
        lines.push(line);
      }
    } else if (dir === 'down') {
      for (c = 0; c < s; c++) {
        line = [];
        for (r = s - 1; r >= 0; r--) line.push({ r: r, c: c });
        lines.push(line);
      }
    }
    return lines;
  };

  /**
   * 执行一次移动。方向为 'up' | 'down' | 'left' | 'right'。
   * 无效移动（棋盘无任何变化）返回 null。
   */
  Game2048.prototype.move = function (dir) {
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') return null;

    var lines = this._buildLines(dir);
    var allMoves = [];
    var scoreDelta = 0;
    var anyMoved = false;
    var lineResults = [];
    var i;

    for (i = 0; i < lines.length; i++) {
      var res = this._slideLine(lines[i]);
      lineResults.push(res);
      if (res.moved) anyMoved = true;
    }

    if (!anyMoved) return null;

    // 提交棋盘变更：先清空，再按各线结果重排
    for (i = 0; i < lineResults.length; i++) {
      var lr = lineResults[i];
      var line = lr.line;
      // 清空该线原有格子
      for (var k = 0; k < line.length; k++) {
        this.board[line[k].r][line[k].c] = null;
      }
      // 填入存活方块
      for (var t = 0; t < lr.newLineTiles.length; t++) {
        var dest = line[t];
        this.board[dest.r][dest.c] = lr.newLineTiles[t];
      }
      allMoves = allMoves.concat(lr.moves);
      scoreDelta += lr.scoreDelta;
    }

    this.score += scoreDelta;

    // won：首次合成 2048
    var justWon = false;
    if (!this.won) {
      for (i = 0; i < lineResults.length; i++) {
        var mv = lineResults[i].mergedValues;
        for (var j = 0; j < mv.length; j++) {
          if (mv[j] >= 2048) { justWon = true; break; }
        }
        if (justWon) break;
      }
      if (justWon) this.won = true;
    }

    // 生成新方块
    var spawn = this._spawnRandom();
    var spawns = spawn ? [spawn] : [];

    // over：生成后判断是否还有可行移动
    var over = !this._canMove();

    return {
      score: this.score,
      scoreDelta: scoreDelta,
      won: justWon,
      over: over,
      spawns: spawns,
      moves: allMoves
    };
  };

  /** 是否还有可行移动：存在空格，或相邻（上下左右）有相同值。 */
  Game2048.prototype._canMove = function () {
    var s = this.size;
    for (var r = 0; r < s; r++) {
      for (var c = 0; c < s; c++) {
        var cell = this.board[r][c];
        if (cell === null) return true;
        if (r + 1 < s && this.board[r + 1][c] !== null && this.board[r + 1][c].value === cell.value) return true;
        if (c + 1 < s && this.board[r][c + 1] !== null && this.board[r][c + 1].value === cell.value) return true;
      }
    }
    return false;
  };

  // 暴露为全局（浏览器 window 或 Node globalThis）
  if (typeof globalThis !== 'undefined') {
    globalThis.Game2048 = Game2048;
  }
})();
