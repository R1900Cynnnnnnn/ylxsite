/**
 * scene.js — 2048 Three.js 渲染层
 * 暴露全局类 BoardScene（依赖全局 THREE，由 index.html 通过 CDN 引入）
 *
 * 用法：
 *   const scene = new BoardScene(containerElement, 4);
 *   scene.syncBoard(game.board);            // 无动画即时同步
 *   scene.playMove(result, game.board);     // 播放动画，返回 Promise
 *   scene.resize();                          // 容器尺寸变化时调用
 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  const CELL = 1.0;          // 单元格尺寸
  const GAP = 0.14;          // 单元格间距
  const TILE = CELL - GAP;   // 方块尺寸
  const TILE_H = 0.34;       // 方块厚度
  const STEP = CELL;         // 相邻格中心距离

  // 数值 → pastel 配色（薄荷绿 → 天空蓝 → 奶油黄 → 淡珊瑚 渐变加深）
  const TILE_COLORS = {
    2: 0xc4ecd9,
    4: 0x9fdfc0,
    8: 0xa9def2,
    16: 0x83ccef,
    32: 0xfceabb,
    64: 0xf9db8b,
    128: 0xfccbb6,
    256: 0xf9ad90,
    512: 0xf68f70,
    1024: 0xef7563,
    2048: 0xf2c14e,
  };
  const SUPER_COLOR = 0xe8a2c0; // 4096+
  const TEXT_FILL = '#ffffff';                 // 数字统一白色填充
  const TEXT_STROKE = 'rgba(45,62,55,0.85)';   // 数字粗描边（高不透明深灰绿）

  const BOARD_COLOR = 0x9fdcc3; // 棋盘底座（薄荷绿）
  const CELL_COLOR = 0x86cfb0;  // 格子凹槽（稍深同色系）

  // ---------- 缓动函数 ----------
  const Ease = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => {
      const c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    },
    outElastic: (t) => {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    },
  };

  // ---------- 工具 ----------
  function tileColor(value) {
    return TILE_COLORS[value] !== undefined ? TILE_COLORS[value] : SUPER_COLOR;
  }

  function makeNumberTexture(value) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const digits = String(value).length;
    // 字号整体放大约 6%
    const fontSize = digits <= 2 ? 134 : digits === 3 ? 104 : digits === 4 ? 81 : 64;
    ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 统一白色填充 + 深灰绿粗描边（先描边再填充），任何 pastel 底色上都清晰
    ctx.lineWidth = Math.max(3, fontSize * 0.13);
    ctx.strokeStyle = TEXT_STROKE;
    ctx.lineJoin = 'round';
    ctx.strokeText(String(value), size / 2, size / 2 + 4);
    ctx.fillStyle = TEXT_FILL;
    ctx.fillText(String(value), size / 2, size / 2 + 4);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  function makeGlowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  function roundedRectShape(size, radius) {
    const s = new THREE.Shape();
    const h = size / 2;
    const r = Math.min(radius, h);
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h);
    s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
    s.lineTo(h, h - r);
    s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
    s.lineTo(-h + r, h);
    s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-h, -h + r);
    s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  // ---------- BoardScene ----------
  class BoardScene {
    constructor(container, n) {
      this.container = container;
      this.n = n || 4;
      this.tiles = new Map(); // id → {group, body, label, value, r, c}
      this._tweens = [];
      this._particles = [];
      this._queue = Promise.resolve(); // 动画串行队列
      this._time = 0;

      this._matCache = new Map();  // value → MeshStandardMaterial
      this._texCache = new Map();  // value → CanvasTexture

      this._initRenderer();
      this._initScene();
      this._initLights();
      this._initBoard();
      this._initAmbientParticles();
      this.resize();
      this._loop();
    }

    // ---------- 初始化 ----------
    _initRenderer() {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      // 透明背景，让页面背景透过 canvas
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.container.appendChild(this.renderer.domElement);
      this.renderer.domElement.style.display = 'block';
    }

    _initScene() {
      this.scene = new THREE.Scene();
      this.scene.background = null; // 无场景背景，页面背景透出

      this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      // 接近正俯视且拉近：4.56 宽棋盘约占视野高度 86%，数字正对镜头
      this._camBase = new THREE.Vector3(0, 7.6, 1.4);
      this._camTarget = new THREE.Vector3(0, 0, 0.2);
      this.camera.position.copy(this._camBase);
      this.camera.lookAt(this._camTarget);
    }

    _initLights() {
      // 环境光：柔和整体照亮
      const ambient = new THREE.AmbientLight(0xfff6e8, 0.75);
      this.scene.add(ambient);

      // 半球光：天空蓝 / 奶油色地面反照，增加清新感
      const hemi = new THREE.HemisphereLight(0xcfe9f7, 0xf3ead6, 0.5);
      this.scene.add(hemi);

      // 平行光：投射软阴影
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(4, 9, 5);
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      const ext = this.n * STEP * 0.9 + 1;
      dir.shadow.camera.left = -ext;
      dir.shadow.camera.right = ext;
      dir.shadow.camera.top = ext;
      dir.shadow.camera.bottom = -ext;
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 25;
      dir.shadow.bias = -0.0005;
      dir.shadow.radius = 2;
      this.scene.add(dir);
    }

    _initBoard() {
      const n = this.n;
      const half = ((n - 1) / 2) * STEP;

      // 地面阴影接收层（透明，仅显示软阴影）
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.ShadowMaterial({ opacity: 0.12 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.58;
      ground.receiveShadow = true;
      this.scene.add(ground);

      // 棋盘底座：有体积感的圆角厚板（小盘子）
      const boardSize = n * STEP + 0.42;
      const baseGeo = new THREE.ExtrudeGeometry(roundedRectShape(boardSize, 0.3), {
        depth: 0.4,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 3,
      });
      baseGeo.rotateX(-Math.PI / 2);
      const base = new THREE.Mesh(
        baseGeo,
        new THREE.MeshStandardMaterial({ color: BOARD_COLOR, roughness: 0.85, metalness: 0.0 })
      );
      base.position.y = -0.45; // 顶面维持在 -0.05，凹槽与方块位置不变
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);

      // 格子凹槽
      const cellGeo = new THREE.ExtrudeGeometry(roundedRectShape(TILE + 0.02, 0.1), {
        depth: 0.03,
        bevelEnabled: false,
      });
      cellGeo.rotateX(-Math.PI / 2);
      const cellMat = new THREE.MeshStandardMaterial({ color: CELL_COLOR, roughness: 0.95 });
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const m = new THREE.Mesh(cellGeo, cellMat);
          m.position.set(c * STEP - half, 0.0, r * STEP - half);
          m.receiveShadow = true;
          this.scene.add(m);
        }
      }

      // 共享方块几何体（圆角挤出）
      this._tileGeo = new THREE.ExtrudeGeometry(roundedRectShape(TILE, 0.13), {
        depth: TILE_H,
        bevelEnabled: true,
        bevelThickness: 0.045,
        bevelSize: 0.045,
        bevelSegments: 3,
      });
      this._tileGeo.rotateX(-Math.PI / 2);

      this._labelGeo = new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92);
      this._labelGeo.rotateX(-Math.PI / 2);

      // 合并粒子共享几何体
      this._sparkGeo = new THREE.SphereGeometry(0.05, 8, 8);
    }

    _initAmbientParticles() {
      // 背景漂浮柔和光斑
      this._glowTex = makeGlowTexture();
      this._floaters = [];
      const colors = [0xaee9d1, 0xa8d8f0, 0xfbe3a9, 0xfbc9b4, 0xf3c6de];
      const count = 26;
      for (let i = 0; i < count; i++) {
        const mat = new THREE.SpriteMaterial({
          map: this._glowTex,
          color: colors[i % colors.length],
          transparent: true,
          opacity: 0.14 + Math.random() * 0.16,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const sp = new THREE.Sprite(mat);
        const s = 0.35 + Math.random() * 0.8;
        sp.scale.set(s, s, 1);
        sp.position.set(
          (Math.random() - 0.5) * 10,
          0.4 + Math.random() * 4.2,
          (Math.random() - 0.5) * 10
        );
        sp.userData = {
          speed: 0.08 + Math.random() * 0.16,
          phase: Math.random() * Math.PI * 2,
          drift: (Math.random() - 0.5) * 0.12,
        };
        this.scene.add(sp);
        this._floaters.push(sp);
      }
    }

    // ---------- 资源缓存 ----------
    _getMaterial(value) {
      if (!this._matCache.has(value)) {
        this._matCache.set(
          value,
          new THREE.MeshStandardMaterial({
            color: tileColor(value),
            roughness: 0.38,
            metalness: 0.04,
          })
        );
      }
      return this._matCache.get(value);
    }

    _getNumberTexture(value) {
      if (!this._texCache.has(value)) {
        this._texCache.set(value, makeNumberTexture(value));
      }
      return this._texCache.get(value);
    }

    // ---------- 坐标 ----------
    _cellPos(r, c) {
      const half = ((this.n - 1) / 2) * STEP;
      return { x: c * STEP - half, z: r * STEP - half };
    }

    // ---------- 方块创建 / 移除 ----------
    _createTile(id, value, r, c) {
      const group = new THREE.Group();

      const body = new THREE.Mesh(this._tileGeo, this._getMaterial(value));
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const label = new THREE.Mesh(
        this._labelGeo,
        new THREE.MeshBasicMaterial({
          map: this._getNumberTexture(value),
          transparent: true,
          depthWrite: false,
        })
      );
      label.position.y = TILE_H + 0.05;
      group.add(label);

      const p = this._cellPos(r, c);
      group.position.set(p.x, 0, p.z);
      group.userData = { id, value, r, c };
      this.scene.add(group);

      const entry = { group, body, label, value, r, c };
      this.tiles.set(id, entry);
      return entry;
    }

    _removeTile(id) {
      const entry = this.tiles.get(id);
      if (!entry) return;
      this.scene.remove(entry.group);
      if (entry.label.material) entry.label.material.dispose();
      this.tiles.delete(id);
    }

    _setTileValue(entry, value) {
      entry.value = value;
      entry.group.userData.value = value;
      entry.body.material = this._getMaterial(value);
      entry.label.material.map = this._getNumberTexture(value);
      entry.label.material.needsUpdate = true;
    }

    // ---------- 补间 ----------
    _animate(duration, ease, onUpdate, delay) {
      return new Promise((resolve) => {
        this._tweens.push({
          start: this._time + (delay || 0),
          duration,
          ease: ease || Ease.outCubic,
          onUpdate,
          resolve,
        });
      });
    }

    _stepTweens() {
      if (!this._tweens.length) return;
      const remaining = [];
      for (const tw of this._tweens) {
        if (this._time < tw.start) {
          remaining.push(tw);
          continue;
        }
        const t = Math.min(1, (this._time - tw.start) / tw.duration);
        tw.onUpdate(tw.ease(t), t);
        if (t >= 1) {
          tw.resolve();
        } else {
          remaining.push(tw);
        }
      }
      this._tweens = remaining;
    }

    // ---------- 合并粒子迸发 ----------
    _burst(r, c, value) {
      const p = this._cellPos(r, c);
      const color = new THREE.Color(tileColor(value));
      const count = 14;
      for (let i = 0; i < count; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
        });
        const m = new THREE.Mesh(this._sparkGeo, mat);
        m.position.set(p.x, TILE_H + 0.1, p.z);
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.6 + Math.random() * 2.2;
        m.userData = {
          vx: Math.cos(ang) * speed,
          vy: 2.2 + Math.random() * 2.4,
          vz: Math.sin(ang) * speed,
          life: 0,
          maxLife: 0.55 + Math.random() * 0.25,
          spin: (Math.random() - 0.5) * 8,
        };
        const s = 0.7 + Math.random() * 0.9;
        m.scale.set(s, s, s);
        this.scene.add(m);
        this._particles.push(m);
      }
    }

    _stepParticles(dt) {
      if (!this._particles.length) return;
      const remaining = [];
      for (const m of this._particles) {
        const u = m.userData;
        u.life += dt;
        if (u.life >= u.maxLife) {
          this.scene.remove(m);
          m.material.dispose();
          continue;
        }
        u.vy -= 7.5 * dt;
        m.position.x += u.vx * dt;
        m.position.y += u.vy * dt;
        m.position.z += u.vz * dt;
        m.rotation.x += u.spin * dt;
        m.rotation.z += u.spin * dt;
        const k = 1 - u.life / u.maxLife;
        m.material.opacity = 0.95 * k;
        const s = m.scale.x * (1 - dt * 1.2);
        m.scale.set(Math.max(s, 0.01), Math.max(s, 0.01), Math.max(s, 0.01));
        remaining.push(m);
      }
      this._particles = remaining;
    }

    // ---------- 公有 API ----------
    /** 无动画即时同步渲染整个棋盘 */
    syncBoard(board) {
      // 取消进行中的补间，避免动画残留
      for (const tw of this._tweens) tw.resolve();
      this._tweens = [];
      for (const id of Array.from(this.tiles.keys())) this._removeTile(id);
      for (let r = 0; r < this.n; r++) {
        for (let c = 0; c < this.n; c++) {
          const cell = board[r] && board[r][c];
          if (cell) {
            const entry = this._createTile(cell.id, cell.value, r, c);
            entry.group.scale.set(1, 1, 1);
          }
        }
      }
    }

    /** 按 game.move 的 result 播放动画，返回 Promise */
    playMove(result, board) {
      // 串行排队，避免动画重叠
      const run = () => this._playMove(result, board);
      const p = this._queue.then(run, run);
      this._queue = p.catch(() => {});
      return p;
    }

    _playMove(result, board) {
      if (!result) {
        this.syncBoard(board);
        return Promise.resolve();
      }
      const moves = result.moves || [];
      const spawns = result.spawns || [];

      // ---- 阶段 1：滑动 ----
      const slideJobs = [];
      const movedIds = new Set();
      for (const mv of moves) {
        const entry = this.tiles.get(mv.id);
        if (!entry) continue;
        movedIds.add(mv.id);
        if (mv.fromR === mv.toR && mv.fromC === mv.toC) continue;
        const from = this._cellPos(mv.fromR, mv.fromC);
        const to = this._cellPos(mv.toR, mv.toC);
        const g = entry.group;
        entry.r = mv.toR;
        entry.c = mv.toC;
        slideJobs.push(
          this._animate(0.09, Ease.inOutCubic, (e) => {
            g.position.x = from.x + (to.x - from.x) * e;
            g.position.z = from.z + (to.z - from.z) * e;
          })
        );
      }

      return Promise.all(slideJobs).then(() => {
        // ---- 阶段 2：合并（挤压拉伸 + 粒子）与新生块弹入 ----
        const jobs = [];

        // 合并目标格分组：key = "r,c"
        const mergeGroups = new Map();
        for (const mv of moves) {
          if (!mv.merged) continue;
          const key = mv.toR + ',' + mv.toC;
          if (!mergeGroups.has(key)) mergeGroups.set(key, []);
          mergeGroups.get(key).push(mv);
        }

        for (const group of mergeGroups.values()) {
          const { toR, toC } = group[0];
          const cell = board[toR] && board[toR][toC];
          const survivorMv = group.find((m) => !m.absorb) || group[0];
          const absorbedMv = group.find((m) => m.absorb);

          // 被吸收方块动画后消失
          if (absorbedMv) this._removeTile(absorbedMv.id);

          let entry = this.tiles.get(survivorMv.id);
          if (entry) {
            // 更新幸存方块的数值与配色，并按 board 中的新 id 重新登记
            this.tiles.delete(survivorMv.id);
            if (cell) {
              entry.r = toR;
              entry.c = toC;
              entry.group.userData.id = cell.id;
              entry.group.userData.r = toR;
              entry.group.userData.c = toC;
              this._setTileValue(entry, cell.value);
              this.tiles.set(cell.id, entry);
            } else {
              this.tiles.set(survivorMv.id, entry);
            }
          } else if (cell) {
            // 兜底：幸存的 mesh 不存在则直接创建
            entry = this._createTile(cell.id, cell.value, toR, toC);
          }

          // 合并挤压拉伸
          if (entry) {
            const g = entry.group;
            jobs.push(
              this._animate(0.17, Ease.linear, (e, t) => {
                const bump = Math.sin(t * Math.PI);
                g.scale.set(1 - 0.16 * bump, 1 + 0.4 * bump, 1 - 0.16 * bump);
              })
            );
          }
          // 迸发小粒子（survivorMv.value 已是合并后的新值）
          this._burst(toR, toC, cell ? cell.value : survivorMv.value);
        }

        // ---- 新生方块弹性弹入 ----
        for (const sp of spawns) {
          const cell = board[sp.r] && board[sp.r][sp.c];
          const id = cell ? cell.id : sp.id;
          const value = cell ? cell.value : sp.value;
          let entry = this.tiles.get(id);
          if (!entry) entry = this._createTile(id, value, sp.r, sp.c);
          entry.r = sp.r;
          entry.c = sp.c;
          const g = entry.group;
          g.scale.set(0.01, 0.01, 0.01);
          jobs.push(
            this._animate(0.2, Ease.outBack, (e) => {
              const s = Math.max(e, 0.01);
              g.scale.set(s, s, s);
            }, 0.03)
          );
        }

        return Promise.all(jobs).then(() => {
          // ---- 最终对账：保证与 board 完全一致 ----
          this._reconcile(board);
        });
      });
    }

    /** 与 board 对账，修正任何不一致（兜底） */
    _reconcile(board) {
      const seen = new Set();
      for (let r = 0; r < this.n; r++) {
        for (let c = 0; c < this.n; c++) {
          const cell = board[r] && board[r][c];
          if (!cell) continue;
          seen.add(cell.id);
          let entry = this.tiles.get(cell.id);
          if (!entry) {
            entry = this._createTile(cell.id, cell.value, r, c);
          } else {
            const p = this._cellPos(r, c);
            entry.group.position.set(p.x, 0, p.z);
            entry.group.scale.set(1, 1, 1);
            entry.r = r;
            entry.c = c;
            if (entry.value !== cell.value) this._setTileValue(entry, cell.value);
          }
        }
      }
      for (const id of Array.from(this.tiles.keys())) {
        if (!seen.has(id)) this._removeTile(id);
      }
    }

    /** 容器尺寸变化时调用 */
    resize() {
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    // ---------- 主循环 ----------
    _loop() {
      const clock = new THREE.Clock();
      const tick = () => {
        const dt = Math.min(clock.getDelta(), 0.05);
        this._time += dt;

        this._stepTweens();
        this._stepParticles(dt);

        // 去掉 x/z 摇摆，仅保留极轻微 y 浮动，避免数字晃动
        const t = this._time;
        this.camera.position.set(
          this._camBase.x,
          this._camBase.y + Math.sin(t * 0.21) * 0.03,
          this._camBase.z
        );
        this.camera.lookAt(this._camTarget);

        // 背景光斑缓慢漂浮
        for (const sp of this._floaters) {
          const u = sp.userData;
          sp.position.y += u.speed * dt;
          sp.position.x += Math.sin(t * 0.4 + u.phase) * u.drift * dt;
          if (sp.position.y > 5) {
            sp.position.y = 0.2;
            sp.position.x = (Math.random() - 0.5) * 10;
            sp.position.z = (Math.random() - 0.5) * 10;
          }
        }

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  window.BoardScene = BoardScene;
})();
