/**
 * 推箱子大师 · 100关挑战 (Sokoban Master - 100 Levels)
 * Pure HTML5 Canvas + Web Audio + Smart Pathfinding & Solution Assistant
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'sokoban_master_save_v1';

  const DIRS = {
    U: { dx: 0, dy: -1, code: 'U' },
    D: { dx: 0, dy: 1, code: 'D' },
    L: { dx: -1, dy: 0, code: 'L' },
    R: { dx: 1, dy: 0, code: 'R' }
  };

  const TIER_NAMES = [
    '新手入门',
    '渐入佳境',
    '巧思妙推',
    '烧脑进阶',
    '推箱大师'
  ];

  // ==========================================
  // Synthesized Web Audio Sound Engine
  // ==========================================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    playTone(freq, type, duration, vol = 0.12, slideTo = null, delay = 0) {
      if (this.muted) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    }

    step() {
      this.playTone(190, 'triangle', 0.055, 0.07, 130);
    }

    push() {
      this.playTone(125, 'sawtooth', 0.09, 0.09, 90);
      this.playTone(220, 'triangle', 0.08, 0.06, 175, 0.02);
    }

    lockTarget() {
      this.playTone(523.25, 'sine', 0.14, 0.13); // C5
      this.playTone(659.25, 'sine', 0.22, 0.15, null, 0.07); // E5
      this.playTone(783.99, 'triangle', 0.28, 0.12, null, 0.14); // G5
    }

    bump() {
      this.playTone(90, 'square', 0.07, 0.06, 65);
    }

    undo() {
      this.playTone(340, 'sine', 0.08, 0.08, 220);
    }

    deadlock() {
      this.playTone(210, 'sawtooth', 0.14, 0.08, 165);
      this.playTone(165, 'sawtooth', 0.18, 0.08, 130, 0.12);
    }

    victory() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((n, idx) => {
        this.playTone(n, 'triangle', 0.28, 0.16, null, idx * 0.09);
      });
      this.playTone(1318.5, 'sine', 0.45, 0.14, null, 0.38);
    }
  }

  // ==========================================
  // Main Game Controller
  // ==========================================
  class SokobanGame {
    constructor(levels) {
      this.levels = levels;
      this.sound = new SoundEngine();

      // Persistent save data
      this.saveData = {
        currentLevelIndex: 0,
        muted: false,
        records: {}, // levelId -> { stars, bestMoves, bestPushes }
        lastVariantByLevel: {} // levelId -> last played variantIndex (0..19)
      };
      this.loadProgress();
      this.sound.muted = !!this.saveData.muted;

      // Current Level & Active Variant State
      this.levelIndex = Math.min(
        Math.max(0, this.saveData.currentLevelIndex || 0),
        this.levels.length - 1
      );
      this.variantIndex = 0;
      this.activeVariant = null;
      this.bannerTimer = null;
      this.rows = 0;
      this.cols = 0;
      this.walls = [];       // 2D boolean
      this.goals = [];       // 2D boolean
      this.insideFloor = []; // 2D boolean (distinguishes interior floor vs outside void)
      this.boxes = [];       // 2D boolean
      this.player = { x: 0, y: 0, dir: 'D' };

      // Smooth visual interpolation
      this.visualPlayer = { x: 0, y: 0 };
      this.boxVisualOffsets = new Map(); // "x,y" -> { ox, oy }
      this.lastMoveTime = 0;
      this.stepAnimDuration = 85; // ms

      // Move History
      this.undoStack = [];
      this.redoStack = [];
      this.moveHistoryDirs = []; // array of 'U'|'D'|'L'|'R' from initial state
      this.moves = 0;
      this.pushes = 0;
      this.isWon = false;

      // Deadlock tracking
      this.deadlockedBoxes = new Set(); // "x,y"

      // Auto-walk / Demo / Hint Queue
      this.moveQueue = [];
      this.queueTimer = null;
      this.isDemoMode = false;
      this.demoSpeedMultiplier = 1;
      this.demoTotalSteps = 0;
      this.demoCurrentStep = 0;
      this.usedDemoInRun = false;

      // Hover cell for path preview
      this.hoverCell = null;
      this.hoverPath = [];

      // Visual Particles & Confetti
      this.particles = [];
      this.confetti = [];

      // Layout metrics
      this.tileSize = 48;
      this.offsetX = 0;
      this.offsetY = 0;
      this.selectedTierTab = 0;

      this.cacheDOM();
      this.bindEvents();
      this.updateSoundUI();
      this.loadLevel(this.levelIndex);
      this.startRenderLoop();
    }

    cacheDOM() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.canvasStage = document.getElementById('canvasStage');

      // Header
      this.elTierBadge = document.getElementById('currentTierBadge');
      this.elLevelLabel = document.getElementById('currentLevelLabel');
      this.elLevelTitle = document.getElementById('currentLevelTitle');
      this.elVariantBadge = document.getElementById('currentVariantBadge');
      this.elLevelStars = document.getElementById('currentLevelStars');
      this.elTotalCleared = document.getElementById('totalClearedCount');
      this.elTotalStars = document.getElementById('totalStarsCount');
      this.elSoundIcon = document.getElementById('soundIcon');

      // Stats
      this.elStatMoves = document.getElementById('statMoves');
      this.elStatPushes = document.getElementById('statPushes');
      this.elStatPar = document.getElementById('statPar');
      this.elStatBest = document.getElementById('statBest');
      this.elStatBoxProgress = document.getElementById('statBoxProgress');
      this.elBoxProgressFill = document.getElementById('boxProgressFill');

      // Buttons
      this.btnPrevLevel = document.getElementById('btnPrevLevel');
      this.btnNextLevel = document.getElementById('btnNextLevel');
      this.btnUndo = document.getElementById('btnUndo');
      this.btnRedo = document.getElementById('btnRedo');
      this.btnRestart = document.getElementById('btnRestart');
      this.btnRandomVariant = document.getElementById('btnRandomVariant');
      this.btnHint = document.getElementById('btnHint');
      this.btnDemo = document.getElementById('btnDemo');
      this.elDemoBtnIcon = document.getElementById('demoBtnIcon');
      this.elDemoBtnText = document.getElementById('demoBtnText');

      // Banners
      this.elStatusBanner = document.getElementById('statusBanner');
      this.elBannerIcon = document.getElementById('bannerIcon');
      this.elBannerText = document.getElementById('bannerText');
      this.btnBannerAction = document.getElementById('bannerActionBtn');

      this.elDemoBar = document.getElementById('demoControlBar');
      this.elDemoStepCounter = document.getElementById('demoStepCounter');
      this.btnDemoSpeed = document.getElementById('btnDemoSpeed');
      this.btnStopDemo = document.getElementById('btnStopDemo');

      // Modals
      this.elVictoryModal = document.getElementById('victoryModal');
      this.elVictoryTitle = document.getElementById('victoryLevelTitle');
      this.elVictoryStars = document.getElementById('victoryStars');
      this.elVictoryRatingText = document.getElementById('victoryRatingText');
      this.elVictoryMoves = document.getElementById('victoryMoves');
      this.elVictoryPushes = document.getElementById('victoryPushes');
      this.elVictoryPar = document.getElementById('victoryPar');
      this.btnVictoryNext = document.getElementById('btnVictoryNext');

      this.elLevelModal = document.getElementById('levelModal');
      this.elLevelGrid = document.getElementById('levelGrid');
      this.elTierTabs = document.getElementById('tierTabs');
      this.elModalClearedText = document.getElementById('modalClearedText');
      this.elModalStarsText = document.getElementById('modalStarsText');
      this.elModalProgressFill = document.getElementById('modalProgressFill');

      this.elHelpModal = document.getElementById('helpModal');
    }

    bindEvents() {
      window.addEventListener('resize', () => this.resizeCanvas());

      // Keyboard Controls
      window.addEventListener('keydown', (e) => {
        if (!this.elLevelModal.classList.contains('hidden')) {
          if (e.key === 'Escape') this.closeLevelModal();
          return;
        }
        if (!this.elHelpModal.classList.contains('hidden')) {
          if (e.key === 'Escape') this.elHelpModal.classList.add('hidden');
          return;
        }
        if (!this.elVictoryModal.classList.contains('hidden')) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.goToNextLevel();
          } else if (e.key === 'Escape') {
            this.elVictoryModal.classList.add('hidden');
          }
          return;
        }

        const key = e.key.toLowerCase();
        if (['arrowup', 'w'].includes(key)) {
          e.preventDefault();
          this.stopAutoQueue();
          this.step('U');
        } else if (['arrowdown', 's'].includes(key)) {
          e.preventDefault();
          this.stopAutoQueue();
          this.step('D');
        } else if (['arrowleft', 'a'].includes(key)) {
          e.preventDefault();
          this.stopAutoQueue();
          this.step('L');
        } else if (['arrowright', 'd'].includes(key)) {
          e.preventDefault();
          this.stopAutoQueue();
          this.step('R');
        } else if (key === 'z' || e.key === 'Backspace') {
          e.preventDefault();
          this.stopAutoQueue();
          this.undo();
        } else if (key === 'y') {
          e.preventDefault();
          this.stopAutoQueue();
          this.redo();
        } else if (key === 'r') {
          e.preventDefault();
          this.stopAutoQueue();
          this.loadLevel(this.levelIndex, this.variantIndex);
        } else if (key === 'v') {
          e.preventDefault();
          this.switchRandomVariant();
        } else if (key === 'h') {
          e.preventDefault();
          this.triggerHint();
        } else if (key === 'n') {
          e.preventDefault();
          if (this.levelIndex < this.levels.length - 1) {
            this.loadLevel(this.levelIndex + 1);
          }
        } else if (key === 'p') {
          e.preventDefault();
          if (this.levelIndex > 0) {
            this.loadLevel(this.levelIndex - 1);
          }
        } else if (key === 'm') {
          e.preventDefault();
          this.toggleSound();
        }
      });

      // Top bar buttons
      this.btnPrevLevel.addEventListener('click', () => {
        if (this.levelIndex > 0) this.loadLevel(this.levelIndex - 1);
      });
      this.btnNextLevel.addEventListener('click', () => {
        if (this.levelIndex < this.levels.length - 1) this.loadLevel(this.levelIndex + 1);
      });
      document.getElementById('btnOpenLevels').addEventListener('click', () => this.openLevelModal());
      document.getElementById('btnOpenLevelsStats').addEventListener('click', () => this.openLevelModal());
      document.getElementById('btnToggleSound').addEventListener('click', () => this.toggleSound());
      document.getElementById('btnOpenHelp').addEventListener('click', () => {
        this.elHelpModal.classList.remove('hidden');
      });

      // Control buttons
      this.btnUndo.addEventListener('click', () => {
        this.stopAutoQueue();
        this.undo();
      });
      this.btnRedo.addEventListener('click', () => {
        this.stopAutoQueue();
        this.redo();
      });
      this.btnRestart.addEventListener('click', () => {
        this.stopAutoQueue();
        this.loadLevel(this.levelIndex, this.variantIndex);
      });
      if (this.btnRandomVariant) {
        this.btnRandomVariant.addEventListener('click', () => {
          this.switchRandomVariant();
        });
      }
      this.btnHint.addEventListener('click', () => this.triggerHint());
      this.btnDemo.addEventListener('click', () => this.toggleDemo());

      // D-Pad buttons
      document.querySelectorAll('.dpad-btn[data-dir]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.stopAutoQueue();
          this.step(btn.getAttribute('data-dir'));
        });
      });
      document.getElementById('btnCenterUndo').addEventListener('click', () => {
        this.stopAutoQueue();
        this.undo();
      });

      // Status banner action
      this.btnBannerAction.addEventListener('click', () => {
        this.stopAutoQueue();
        this.undo();
      });

      // Demo bar controls
      this.btnDemoSpeed.addEventListener('click', () => {
        const speeds = [1, 2, 4];
        const nextIdx = (speeds.indexOf(this.demoSpeedMultiplier) + 1) % speeds.length;
        this.demoSpeedMultiplier = speeds[nextIdx];
        this.btnDemoSpeed.textContent = `${this.demoSpeedMultiplier}x`;
      });
      this.btnStopDemo.addEventListener('click', () => this.stopAutoQueue());

      // Canvas Mouse & Touch Interaction
      let touchStartX = 0;
      let touchStartY = 0;
      let isSwiping = false;

      this.canvas.addEventListener('mousemove', (e) => {
        const cell = this.getGridCellFromEvent(e);
        if (!cell) {
          this.hoverCell = null;
          this.hoverPath = [];
          return;
        }
        if (!this.hoverCell || this.hoverCell.x !== cell.x || this.hoverCell.y !== cell.y) {
          this.hoverCell = cell;
          this.updateHoverPreview();
        }
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.hoverCell = null;
        this.hoverPath = [];
      });

      this.canvas.addEventListener('click', (e) => {
        if (this.isWon) return;
        const cell = this.getGridCellFromEvent(e);
        if (cell) {
          this.handleCellTap(cell.x, cell.y);
        }
      });

      this.canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          isSwiping = false;
        }
      }, { passive: true });

      this.canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
          const dx = e.touches[0].clientX - touchStartX;
          const dy = e.touches[0].clientY - touchStartY;
          if (Math.hypot(dx, dy) > 28) {
            isSwiping = true;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            this.stopAutoQueue();
            if (Math.abs(dx) > Math.abs(dy)) {
              this.step(dx > 0 ? 'R' : 'L');
            } else {
              this.step(dy > 0 ? 'D' : 'U');
            }
          }
        }
      }, { passive: true });

      this.canvas.addEventListener('touchend', (e) => {
        if (!isSwiping && e.changedTouches.length === 1) {
          const cell = this.getGridCellFromEvent(e.changedTouches[0]);
          if (cell) {
            this.handleCellTap(cell.x, cell.y);
          }
        }
      });

      // Victory Modal buttons
      document.getElementById('btnVictoryReplay').addEventListener('click', () => {
        this.elVictoryModal.classList.add('hidden');
        this.loadLevel(this.levelIndex);
      });
      document.getElementById('btnVictoryLevels').addEventListener('click', () => {
        this.elVictoryModal.classList.add('hidden');
        this.openLevelModal();
      });
      this.btnVictoryNext.addEventListener('click', () => this.goToNextLevel());

      // Level Modal
      document.getElementById('btnCloseLevelModal').addEventListener('click', () => this.closeLevelModal());
      this.elLevelModal.addEventListener('click', (e) => {
        if (e.target === this.elLevelModal) this.closeLevelModal();
      });

      this.elTierTabs.querySelectorAll('.tier-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          this.selectedTierTab = parseInt(tab.getAttribute('data-tier'), 10);
          this.renderLevelSelectorGrid();
        });
      });

      // Help Modal
      document.getElementById('btnCloseHelpModal').addEventListener('click', () => {
        this.elHelpModal.classList.add('hidden');
      });
      document.getElementById('btnGotItHelp').addEventListener('click', () => {
        this.elHelpModal.classList.add('hidden');
      });
      this.elHelpModal.addEventListener('click', (e) => {
        if (e.target === this.elHelpModal) this.elHelpModal.classList.add('hidden');
      });
    }

    // ==========================================
    // Level & Variant Selection, Parsing & Flood-Fill
    // ==========================================
    pickRandomVariantIndex(level, excludeIndex = null) {
      const variants = Array.isArray(level && level.variants) ? level.variants : [];
      const count = variants.length;
      if (count <= 1) return 0;

      const candidates = [];
      for (let i = 0; i < count; i++) {
        if (i !== excludeIndex) {
          candidates.push(i);
        }
      }
      const pool = candidates.length > 0 ? candidates : Array.from({ length: count }, (_, i) => i);
      return pool[Math.floor(Math.random() * pool.length)];
    }

    switchRandomVariant() {
      this.stopAutoQueue();
      const level = this.levels[this.levelIndex];
      const variants = Array.isArray(level && level.variants) ? level.variants : [];
      const totalVariants = variants.length > 0 ? variants.length : 20;
      const nextVariantIndex = variants.length > 0
        ? this.pickRandomVariantIndex(level, this.variantIndex)
        : ((this.variantIndex + 1) % totalVariants);

      this.loadLevel(this.levelIndex, nextVariantIndex);
      this.showStatusBanner(
        '🎲',
        `已切换至本关随机题库 #${this.variantIndex + 1}/${totalVariants}`,
        false,
        2600
      );
    }

    loadLevel(index, variantIndex = null) {
      this.stopAutoQueue();
      this.levelIndex = Math.max(0, Math.min(index, this.levels.length - 1));
      this.saveData.currentLevelIndex = this.levelIndex;
      if (!this.saveData.lastVariantByLevel || typeof this.saveData.lastVariantByLevel !== 'object') {
        this.saveData.lastVariantByLevel = {};
      }

      const level = this.levels[this.levelIndex];
      const variants = Array.isArray(level && level.variants) ? level.variants : [];

      if (variants.length > 0) {
        if (
          typeof variantIndex === 'number' &&
          Number.isInteger(variantIndex) &&
          variantIndex >= 0 &&
          variantIndex < variants.length
        ) {
          this.variantIndex = variantIndex;
        } else {
          const lastPlayed = this.saveData.lastVariantByLevel[level.id];
          const excludeIdx = typeof lastPlayed === 'number' ? lastPlayed : null;
          this.variantIndex = this.pickRandomVariantIndex(level, excludeIdx);
        }
        this.activeVariant = variants[this.variantIndex] || level;
      } else {
        if (typeof variantIndex === 'number' && Number.isInteger(variantIndex) && variantIndex >= 0) {
          this.variantIndex = variantIndex;
        } else {
          const lastPlayed = this.saveData.lastVariantByLevel[level.id];
          const candidates = [];
          for (let i = 0; i < 20; i++) {
            if (i !== lastPlayed) candidates.push(i);
          }
          this.variantIndex = candidates[Math.floor(Math.random() * candidates.length)];
        }
        this.activeVariant = level;
      }

      this.saveData.lastVariantByLevel[level.id] = this.variantIndex;
      this.saveProgress();

      const active = this.activeVariant || level;
      const mapLines = active.map || level.map || [];

      this.rows = mapLines.length;
      this.cols = Math.max(...mapLines.map((r) => r.length), 1);

      this.walls = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
      this.goals = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
      this.boxes = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
      this.insideFloor = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));

      const seeds = [];

      for (let y = 0; y < this.rows; y++) {
        const rowStr = mapLines[y] || '';
        for (let x = 0; x < this.cols; x++) {
          const ch = rowStr[x] || ' ';
          if (ch === '#') {
            this.walls[y][x] = true;
          } else if (ch === '.') {
            this.goals[y][x] = true;
            seeds.push({ x, y });
          } else if (ch === '$') {
            this.boxes[y][x] = true;
            seeds.push({ x, y });
          } else if (ch === '*') {
            this.boxes[y][x] = true;
            this.goals[y][x] = true;
            seeds.push({ x, y });
          } else if (ch === '@') {
            this.player = { x, y, dir: 'D' };
            seeds.push({ x, y });
          } else if (ch === '+') {
            this.player = { x, y, dir: 'D' };
            this.goals[y][x] = true;
            seeds.push({ x, y });
          }
        }
      }

      // Flood-fill from player, boxes, and goals to identify interior floor tiles
      const q = [...seeds];
      seeds.forEach(({ x, y }) => {
        this.insideFloor[y][x] = true;
      });

      while (q.length > 0) {
        const cur = q.shift();
        for (const d of Object.values(DIRS)) {
          const nx = cur.x + d.dx;
          const ny = cur.y + d.dy;
          if (
            ny >= 0 && ny < this.rows &&
            nx >= 0 && nx < this.cols &&
            !this.walls[ny][nx] &&
            !this.insideFloor[ny][nx]
          ) {
            this.insideFloor[ny][nx] = true;
            q.push({ x: nx, y: ny });
          }
        }
      }

      this.visualPlayer = { x: this.player.x, y: this.player.y };
      this.boxVisualOffsets.clear();
      this.undoStack = [];
      this.redoStack = [];
      this.moveHistoryDirs = [];
      this.moves = 0;
      this.pushes = 0;
      this.isWon = false;
      this.usedDemoInRun = false;
      this.deadlockedBoxes.clear();
      this.particles = [];
      this.confetti = [];
      this.hoverCell = null;
      this.hoverPath = [];

      this.elVictoryModal.classList.add('hidden');
      this.hideStatusBanner();

      this.resizeCanvas();
      this.updateHUD();
      this.draw(performance.now());
    }

    resizeCanvas() {
      const frame = this.canvas.parentElement;
      if (!frame) return;

      const availW = Math.max(240, frame.clientWidth - 28);
      const availH = Math.max(240, frame.clientHeight - 28);

      const maxTileW = Math.floor(availW / Math.max(this.cols, 1));
      const maxTileH = Math.floor(availH / Math.max(this.rows, 1));
      this.tileSize = Math.max(22, Math.min(84, maxTileW, maxTileH));

      const logicalW = this.cols * this.tileSize + 16;
      const logicalH = this.rows * this.tileSize + 16;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = logicalW * dpr;
      this.canvas.height = logicalH * dpr;
      this.canvas.style.width = `${logicalW}px`;
      this.canvas.style.height = `${logicalH}px`;

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.offsetX = 8;
      this.offsetY = 8;
      this.draw(performance.now());
    }

    // ==========================================
    // Core Movement, Push, Undo & Redo
    // ==========================================
    getCleanTitle(level) {
      if (!level || !level.title) return '';
      return String(level.title).replace(/^第\s*\d+\s*关\s*[·•\-:：]\s*/, '').trim();
    }

    getCleanTier(level, index) {
      if (level && level.tier) {
        return String(level.tier).split('/')[0].trim();
      }
      return TIER_NAMES[Math.floor(index / 20)] || TIER_NAMES[0];
    }

    step(dirCode, isFromRedo = false) {
      if (this.isWon) return false;
      const dir = DIRS[dirCode.toUpperCase()];
      if (!dir) return false;

      const prevDir = this.player.dir;
      const nx = this.player.x + dir.dx;
      const ny = this.player.y + dir.dy;
      this.player.dir = dir.code;

      if (ny < 0 || ny >= this.rows || nx < 0 || nx >= this.cols || this.walls[ny][nx]) {
        this.sound.bump();
        return false;
      }

      let pushed = false;
      let bx = nx + dir.dx;
      let by = ny + dir.dy;

      if (this.boxes[ny][nx]) {
        // Check if space behind the box is free
        if (
          by < 0 || by >= this.rows ||
          bx < 0 || bx >= this.cols ||
          this.walls[by][bx] ||
          this.boxes[by][bx]
        ) {
          this.sound.bump();
          return false;
        }
        pushed = true;
      }

      // Record undo snapshot
      this.undoStack.push({
        px: this.player.x,
        py: this.player.y,
        prevDir,
        moveDir: dir.code,
        pDir: dir.code,
        pushed,
        fromBx: pushed ? nx : -1,
        fromBy: pushed ? ny : -1,
        toBx: pushed ? bx : -1,
        toBy: pushed ? by : -1
      });

      if (!isFromRedo) {
        this.redoStack = [];
      }

      // Execute move
      const prevPx = this.player.x;
      const prevPy = this.player.y;
      this.player.x = nx;
      this.player.y = ny;
      this.moves++;
      this.moveHistoryDirs.push(dir.code);

      // Smooth visual interpolation setup
      this.visualPlayer.x = prevPx;
      this.visualPlayer.y = prevPy;
      this.lastMoveTime = performance.now();

      if (pushed) {
        this.boxes[ny][nx] = false;
        this.boxes[by][bx] = true;
        this.pushes++;
        this.boxVisualOffsets.set(`${bx},${by}`, {
          ox: -dir.dx,
          oy: -dir.dy
        });

        if (this.goals[by][bx]) {
          this.sound.lockTarget();
          this.spawnTargetBurst(bx, by);
        } else {
          this.sound.push();
        }
      } else {
        this.sound.step();
      }

      this.hoverPath = [];
      this.checkDeadlocks();
      this.updateHUD();
      this.checkWinCondition();
      this.draw(performance.now());
      setTimeout(() => this.draw(performance.now()), this.stepAnimDuration + 16);
      return true;
    }

    undo() {
      if (this.undoStack.length === 0 || this.isWon) return;
      const last = this.undoStack.pop();
      this.redoStack.push(last);

      const curPx = this.player.x;
      const curPy = this.player.y;

      this.player.x = last.px;
      this.player.y = last.py;
      this.player.dir = last.prevDir || last.pDir;
      this.moves = Math.max(0, this.moves - 1);
      this.moveHistoryDirs.pop();

      if (last.pushed) {
        this.boxes[last.toBy][last.toBx] = false;
        this.boxes[last.fromBy][last.fromBx] = true;
        this.pushes = Math.max(0, this.pushes - 1);
      }

      this.visualPlayer = { x: curPx, y: curPy };
      this.lastMoveTime = performance.now();
      this.boxVisualOffsets.clear();

      this.sound.undo();
      this.checkDeadlocks();
      this.updateHUD();
      this.draw(performance.now());
      setTimeout(() => this.draw(performance.now()), this.stepAnimDuration + 16);
    }

    redo() {
      if (this.redoStack.length === 0 || this.isWon) return;
      const next = this.redoStack.pop();
      const dirCode = next.moveDir || next.pDir;
      this.step(dirCode, true);
    }

    // ==========================================
    // Deadlock Detection (Corner & 2x2 Freeze)
    // ==========================================
    checkDeadlocks() {
      this.deadlockedBoxes.clear();
      let foundDeadlock = false;

      const isWall = (x, y) => {
        if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return true;
        return this.walls[y][x];
      };

      const isSolid = (x, y) => {
        if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return true;
        return this.walls[y][x] || this.boxes[y][x];
      };

      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (!this.boxes[y][x] || this.goals[y][x]) continue;

          // 1. Simple Corner Deadlock (walled horizontally AND vertically)
          const blockedH = isWall(x - 1, y) || isWall(x + 1, y);
          const blockedV = isWall(x, y - 1) || isWall(x, y + 1);

          if (blockedH && blockedV) {
            this.deadlockedBoxes.add(`${x},${y}`);
            foundDeadlock = true;
            continue;
          }

          // 2. 2x2 Block Freeze Deadlock
          const quads = [
            [[0, 0], [1, 0], [0, 1], [1, 1]],
            [[-1, 0], [0, 0], [-1, 1], [0, 1]],
            [[0, -1], [1, -1], [0, 0], [1, 0]],
            [[-1, -1], [0, -1], [-1, 0], [0, 0]]
          ];

          for (const quad of quads) {
            if (quad.every(([ox, oy]) => isSolid(x + ox, y + oy))) {
              this.deadlockedBoxes.add(`${x},${y}`);
              foundDeadlock = true;
              break;
            }
          }
        }
      }

      if (foundDeadlock && !this.isDemoMode) {
        this.showStatusBanner('⚠️', '箱子可能卡在死角了，按 Z 撤销', true);
        this.sound.deadlock();
      } else {
        this.hideStatusBanner();
      }
    }

    showStatusBanner(icon, text, showUndoBtn = true, autoHideMs = 0) {
      if (this.bannerTimer) {
        clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
      }
      this.elBannerIcon.textContent = icon;
      this.elBannerText.textContent = text;
      this.btnBannerAction.style.display = showUndoBtn ? 'inline-block' : 'none';
      this.elStatusBanner.classList.remove('hidden');

      if (autoHideMs > 0) {
        this.bannerTimer = setTimeout(() => {
          this.hideStatusBanner();
        }, autoHideMs);
      }
    }

    hideStatusBanner() {
      if (this.bannerTimer) {
        clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
      }
      this.elStatusBanner.classList.add('hidden');
    }

    // ==========================================
    // Smart Click Pathfinding (BFS) & Direct Push
    // ==========================================
    getGridCellFromEvent(e) {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - this.offsetX;
      const py = e.clientY - rect.top - this.offsetY;
      const gx = Math.floor(px / this.tileSize);
      const gy = Math.floor(py / this.tileSize);
      if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return null;
      return { x: gx, y: gy };
    }

    findPlayerPath(targetX, targetY) {
      if (
        targetX < 0 || targetX >= this.cols ||
        targetY < 0 || targetY >= this.rows ||
        this.walls[targetY][targetX] ||
        this.boxes[targetY][targetX] ||
        !this.insideFloor[targetY][targetX]
      ) {
        return null;
      }

      if (targetX === this.player.x && targetY === this.player.y) return [];

      const visited = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
      const queue = [{ x: this.player.x, y: this.player.y, path: [] }];
      visited[this.player.y][this.player.x] = true;

      while (queue.length > 0) {
        const cur = queue.shift();
        for (const d of Object.values(DIRS)) {
          const nx = cur.x + d.dx;
          const ny = cur.y + d.dy;
          if (
            ny >= 0 && ny < this.rows &&
            nx >= 0 && nx < this.cols &&
            !visited[ny][nx] &&
            !this.walls[ny][nx] &&
            !this.boxes[ny][nx]
          ) {
            const nextPath = [...cur.path, { x: nx, y: ny, dir: d.code }];
            if (nx === targetX && ny === targetY) {
              return nextPath;
            }
            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny, path: nextPath });
          }
        }
      }
      return null;
    }

    updateHoverPreview() {
      if (!this.hoverCell || this.isWon || this.moveQueue.length > 0) {
        this.hoverPath = [];
        return;
      }
      const { x, y } = this.hoverCell;
      // If hovering an adjacent box, check if pushable
      const dx = x - this.player.x;
      const dy = y - this.player.y;
      if (Math.abs(dx) + Math.abs(dy) === 1 && this.boxes[y][x]) {
        const bx = x + dx;
        const by = y + dy;
        if (
          by >= 0 && by < this.rows &&
          bx >= 0 && bx < this.cols &&
          !this.walls[by][bx] &&
          !this.boxes[by][bx]
        ) {
          this.hoverPath = [{ x, y, isPush: true }, { x: bx, y: by, isPushTarget: true }];
          return;
        }
      }

      const path = this.findPlayerPath(x, y);
      this.hoverPath = path || [];
    }

    handleCellTap(tx, ty) {
      this.stopAutoQueue();

      const dx = tx - this.player.x;
      const dy = ty - this.player.y;

      // Adjacent tap (empty floor or pushable box)
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        if (dx === 1) this.step('R');
        else if (dx === -1) this.step('L');
        else if (dy === 1) this.step('D');
        else if (dy === -1) this.step('U');
        return;
      }

      // If tapped a non-adjacentempty floor tile, BFS walk there
      if (!this.walls[ty][tx] && !this.boxes[ty][tx]) {
        const path = this.findPlayerPath(tx, ty);
        if (path && path.length > 0) {
          this.enqueueMoves(path.map((p) => p.dir), false, 52);
        }
      }
    }

    // ==========================================
    // AI Hint & Solution Replay Assistant
    // ==========================================
    getStateSignature(px, py, boxesGrid) {
      const coords = [];
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (boxesGrid[y][x]) coords.push(`${x},${y}`);
        }
      }
      return `${px},${py}|${coords.join(';')}`;
    }

    /**
     * Simulates level.solution from the start and builds a map of
     * stateSignature -> stepIndex so we know if the player's current board
     * is anywhere on the golden solution path!
     */
    findCurrentStateInSolution() {
      const level = this.levels[this.levelIndex];
      const active = this.activeVariant || level;
      const sol = ((active && active.solution) || level.solution || '').toUpperCase();
      if (!sol) return null;

      // Parse initial state of active variant
      const mapLines = (active && active.map) || level.map || [];
      const simBoxes = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
      let spx = 0;
      let spy = 0;

      for (let y = 0; y < this.rows; y++) {
        const rowStr = mapLines[y] || '';
        for (let x = 0; x < this.cols; x++) {
          const ch = rowStr[x] || ' ';
          if (ch === '$' || ch === '*') simBoxes[y][x] = true;
          if (ch === '@' || ch === '+') {
            spx = x;
            spy = y;
          }
        }
      }

      const currentSig = this.getStateSignature(this.player.x, this.player.y, this.boxes);
      if (this.getStateSignature(spx, spy, simBoxes) === currentSig) {
        return { index: 0, solution: sol };
      }

      let matchedIndex = -1;
      for (let i = 0; i < sol.length; i++) {
        const d = DIRS[sol[i]];
        if (!d) continue;
        const nx = spx + d.dx;
        const ny = spy + d.dy;
        if (this.walls[ny][nx]) continue;
        if (simBoxes[ny][nx]) {
          const bx = nx + d.dx;
          const by = ny + d.dy;
          simBoxes[ny][nx] = false;
          simBoxes[by][bx] = true;
        }
        spx = nx;
        spy = ny;

        if (this.getStateSignature(spx, spy, simBoxes) === currentSig) {
          matchedIndex = i + 1;
        }
      }

      if (matchedIndex !== -1) {
        return { index: matchedIndex, solution: sol };
      }
      return null;
    }

    triggerHint() {
      if (this.isWon) return;
      this.stopAutoQueue();

      const level = this.levels[this.levelIndex];
      const active = this.activeVariant || level;
      const sol = ((active && active.solution) || level.solution || '').toUpperCase();
      if (!sol) return;

      let match = this.findCurrentStateInSolution();

      // If the player diverged from the standard solution, undo back to the last state on the solution path
      if (!match) {
        while (this.undoStack.length > 0 && !match) {
          const last = this.undoStack.pop();
          this.player.x = last.px;
          this.player.y = last.py;
          this.player.dir = last.prevDir || last.pDir;
          this.moves = Math.max(0, this.moves - 1);
          this.moveHistoryDirs.pop();
          if (last.pushed) {
            this.boxes[last.toBy][last.toBx] = false;
            this.boxes[last.fromBy][last.fromBx] = true;
            this.pushes = Math.max(0, this.pushes - 1);
          }
          match = this.findCurrentStateInSolution();
        }
        this.redoStack = [];
        this.visualPlayer = { x: this.player.x, y: this.player.y };
        this.checkDeadlocks();
        this.updateHUD();
        this.showStatusBanner('💡', '已自动回退至正确路线并提示下一步推箱', false);
      } else {
        this.showStatusBanner('💡', 'AI 智能提示：已为您演示下一步关键推箱', false);
      }

      if (!match || match.index >= sol.length) return;

      // Extract steps from match.index up to and including the next box push
      const hintSteps = [];
      let simPx = this.player.x;
      let simPy = this.player.y;

      for (let i = match.index; i < sol.length; i++) {
        const dirCode = sol[i];
        const d = DIRS[dirCode];
        if (!d) continue;
        hintSteps.push(dirCode);
        const nx = simPx + d.dx;
        const ny = simPy + d.dy;
        const isBoxPush = this.boxes[ny] && this.boxes[ny][nx];
        simPx = nx;
        simPy = ny;
        if (isBoxPush) {
          break;
        }
      }

      this.enqueueMoves(hintSteps, false, 85);
    }

    toggleDemo() {
      if (this.isDemoMode) {
        this.stopAutoQueue();
        return;
      }

      const level = this.levels[this.levelIndex];
      const active = this.activeVariant || level;
      const sol = ((active && active.solution) || level.solution || '').toUpperCase();
      if (!sol) return;

      // Reset to initial active variant state and play full solution
      this.loadLevel(this.levelIndex, this.variantIndex);
      this.usedDemoInRun = true;
      const steps = sol.split('').filter((c) => DIRS[c]);
      this.demoTotalSteps = steps.length;
      this.demoCurrentStep = 0;

      this.enqueueMoves(steps, true, 120);
    }

    enqueueMoves(dirArray, isDemo = false, baseInterval = 90) {
      this.stopAutoQueue();
      if (!dirArray || dirArray.length === 0) return;

      this.moveQueue = [...dirArray];
      this.isDemoMode = isDemo;

      if (isDemo) {
        this.elDemoBar.classList.remove('hidden');
        this.btnDemo.classList.add('playing');
        this.elDemoBtnIcon.textContent = '⏹️';
        this.elDemoBtnText.textContent = '停止演示';
        this.elDemoStepCounter.textContent = `0 / ${this.demoTotalSteps}`;
      }

      const runNext = () => {
        if (this.moveQueue.length === 0 || this.isWon) {
          this.stopAutoQueue();
          return;
        }
        const nextDir = this.moveQueue.shift();
        this.step(nextDir);

        if (this.isDemoMode) {
          this.demoCurrentStep++;
          this.elDemoStepCounter.textContent = `${this.demoCurrentStep} / ${this.demoTotalSteps}`;
        }

        const interval = this.isDemoMode
          ? Math.max(25, Math.round(baseInterval / this.demoSpeedMultiplier))
          : baseInterval;

        this.queueTimer = setTimeout(runNext, interval);
      };

      runNext();
    }

    stopAutoQueue() {
      if (this.queueTimer) {
        clearTimeout(this.queueTimer);
        this.queueTimer = null;
      }
      this.moveQueue = [];
      if (this.isDemoMode) {
        this.isDemoMode = false;
        this.elDemoBar.classList.add('hidden');
        this.btnDemo.classList.remove('playing');
        this.elDemoBtnIcon.textContent = '▶️';
        this.elDemoBtnText.textContent = '通关演示';
      }
    }

    // ==========================================
    // Win Condition, Star Rating & Persistence
    // ==========================================
    countLockedBoxes() {
      let totalGoals = 0;
      let locked = 0;
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (this.goals[y][x]) {
            totalGoals++;
            if (this.boxes[y][x]) locked++;
          }
        }
      }
      return { locked, totalGoals };
    }

    checkWinCondition() {
      const { locked, totalGoals } = this.countLockedBoxes();
      if (totalGoals > 0 && locked === totalGoals) {
        this.isWon = true;
        this.visualPlayer.x = this.player.x;
        this.visualPlayer.y = this.player.y;
        this.boxVisualOffsets.clear();
        this.stopAutoQueue();
        this.hideStatusBanner();
        this.sound.victory();
        this.spawnVictoryConfetti();
        this.handleLevelVictory();
      }
    }

    calculateStars(pushes, parPushes) {
      const par = Math.max(1, parPushes || 10);
      if (pushes <= par) return 3;
      if (pushes <= Math.ceil(par * 1.35)) return 2;
      return 1;
    }

    handleLevelVictory() {
      const level = this.levels[this.levelIndex];
      const active = this.activeVariant || level;
      const parPushes = (active && active.parPushes) || level.parPushes;
      const earnedStars = this.calculateStars(this.pushes, parPushes);

      // Save record
      const prev = this.saveData.records[level.id] || {
        stars: 0,
        bestMoves: Infinity,
        bestPushes: Infinity
      };

      this.saveData.records[level.id] = {
        stars: Math.max(prev.stars || 0, earnedStars),
        bestMoves: Math.min(prev.bestMoves || Infinity, this.moves),
        bestPushes: Math.min(prev.bestPushes || Infinity, this.pushes)
      };

      this.saveProgress();
      this.updateHUD();

      // Populate Victory Modal after brief celebration delay
      setTimeout(() => {
        if (!this.isWon) return;
        const cleanTitle = this.getCleanTitle(level);
        const totalVariants = Array.isArray(level.variants) && level.variants.length > 0 ? level.variants.length : 20;
        this.elVictoryTitle.textContent = cleanTitle
          ? `第 ${level.id} 关 · ${cleanTitle} (题库 #${this.variantIndex + 1}/${totalVariants})`
          : `第 ${level.id} 关 (题库 #${this.variantIndex + 1}/${totalVariants})`;
        this.elVictoryMoves.textContent = `${this.moves}`;
        this.elVictoryPushes.textContent = `${this.pushes}`;
        this.elVictoryPar.textContent = `≤ ${parPushes} 推`;

        const starSpans = this.elVictoryStars.querySelectorAll('.star-big');
        starSpans.forEach((s, idx) => {
          s.classList.toggle('earned', idx < earnedStars);
        });

        if (earnedStars === 3) {
          this.elVictoryRatingText.textContent = '🌟 完美三星通关！推箱路线堪称教科书！';
        } else if (earnedStars === 2) {
          this.elVictoryRatingText.textContent = `👏 表现出色！距离三星目标仅差 ${this.pushes - parPushes} 次推动。`;
        } else {
          this.elVictoryRatingText.textContent = `🎉 恭喜过关！尝试减少推箱次数挑战三星（≤${parPushes}推）吧！`;
        }

        this.btnVictoryNext.style.display =
          this.levelIndex < this.levels.length - 1 ? 'inline-block' : 'none';

        this.elVictoryModal.classList.remove('hidden');
      }, 450);
    }

    goToNextLevel() {
      this.elVictoryModal.classList.add('hidden');
      if (this.levelIndex < this.levels.length - 1) {
        this.loadLevel(this.levelIndex + 1);
      }
    }

    // ==========================================
    // HUD & Level Selector Modal
    // ==========================================
    updateHUD() {
      const level = this.levels[this.levelIndex];
      const active = this.activeVariant || level;
      const parPushes = (active && active.parPushes) || level.parPushes;
      const rec = this.saveData.records[level.id];

      this.elTierBadge.textContent = this.getCleanTier(level, this.levelIndex);
      this.elLevelLabel.textContent = `第 ${level.id} 关`;
      this.elLevelTitle.textContent = this.getCleanTitle(level);
      if (this.elVariantBadge) {
        const totalVariants = Array.isArray(level.variants) && level.variants.length > 0 ? level.variants.length : 20;
        this.elVariantBadge.textContent = `🎲 题库 #${this.variantIndex + 1}/${totalVariants}`;
      }

      const stars = rec ? rec.stars : 0;
      this.elLevelStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);

      this.btnPrevLevel.disabled = this.levelIndex <= 0;
      this.btnNextLevel.disabled = this.levelIndex >= this.levels.length - 1;

      this.elStatMoves.textContent = `${this.moves}`;
      this.elStatPushes.textContent = `${this.pushes}`;
      this.elStatPar.textContent = `≤ ${parPushes} 推`;
      this.elStatBest.textContent = rec
        ? `${rec.bestPushes}推 / ${rec.bestMoves}步`
        : '未通关';

      const { locked, totalGoals } = this.countLockedBoxes();
      this.elStatBoxProgress.textContent = `${locked} / ${totalGoals}`;
      const pct = totalGoals > 0 ? Math.round((locked / totalGoals) * 100) : 0;
      this.elBoxProgressFill.style.width = `${pct}%`;

      this.btnUndo.disabled = this.undoStack.length === 0;
      this.btnRedo.disabled = this.redoStack.length === 0;

      // Global Totals
      let clearedCount = 0;
      let totalStars = 0;
      for (const lv of this.levels) {
        const r = this.saveData.records[lv.id];
        if (r && r.stars > 0) {
          clearedCount++;
          totalStars += r.stars;
        }
      }
      this.elTotalCleared.textContent = `${clearedCount}`;
      this.elTotalStars.textContent = `${totalStars}`;
    }

    openLevelModal() {
      this.selectedTierTab = Math.floor(this.levelIndex / 20);
      this.renderLevelSelectorGrid();
      this.elLevelModal.classList.remove('hidden');
    }

    closeLevelModal() {
      this.elLevelModal.classList.add('hidden');
    }

    renderLevelSelectorGrid() {
      // Update active tier tab
      this.elTierTabs.querySelectorAll('.tier-tab').forEach((tab) => {
        const t = parseInt(tab.getAttribute('data-tier'), 10);
        tab.classList.toggle('active', t === this.selectedTierTab);
      });

      // Overall progress bar
      let clearedCount = 0;
      let totalStars = 0;
      for (const lv of this.levels) {
        const r = this.saveData.records[lv.id];
        if (r && r.stars > 0) {
          clearedCount++;
          totalStars += r.stars;
        }
      }
      this.elModalClearedText.textContent = `${clearedCount} / ${this.levels.length}`;
      this.elModalStarsText.textContent = `${totalStars} / ${this.levels.length * 3} ⭐`;
      this.elModalProgressFill.style.width = `${Math.round((clearedCount / this.levels.length) * 100)}%`;

      // Render 20 levels of selected tier
      const startIdx = this.selectedTierTab * 20;
      const endIdx = Math.min(startIdx + 20, this.levels.length);
      this.elLevelGrid.innerHTML = '';

      for (let i = startIdx; i < endIdx; i++) {
        const lv = this.levels[i];
        const rec = this.saveData.records[lv.id];
        const stars = rec ? rec.stars : 0;

        const cell = document.createElement('button');
        cell.className = 'level-cell';
        if (i === this.levelIndex) cell.classList.add('current');
        if (stars > 0) cell.classList.add('cleared');

        let starsHTML = '';
        for (let s = 1; s <= 3; s++) {
          starsHTML += `<span class="${s <= stars ? 'earned' : ''}">★</span>`;
        }

        cell.innerHTML = `
          <span class="cell-num">第 ${lv.id} 关</span>
          <span class="cell-title">${this.getCleanTitle(lv)}</span>
          <div class="cell-stars">${starsHTML}</div>
          <span class="cell-best">${rec ? `最佳 ${rec.bestPushes} 推` : `目标 ≤${lv.parPushes}推`}</span>
        `;

        cell.addEventListener('click', () => {
          this.closeLevelModal();
          this.loadLevel(i);
        });

        this.elLevelGrid.appendChild(cell);
      }
    }

    // ==========================================
    // LocalStorage & Sound State
    // ==========================================
    loadProgress() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            this.saveData = {
              currentLevelIndex: parsed.currentLevelIndex || 0,
              muted: !!parsed.muted,
              records: parsed.records || {},
              lastVariantByLevel:
                parsed.lastVariantByLevel && typeof parsed.lastVariantByLevel === 'object'
                  ? parsed.lastVariantByLevel
                  : {}
            };
          }
        }
      } catch (e) {
        // Ignore storage errors in sandboxed frames
      }
    }

    saveProgress() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saveData));
      } catch (e) {
        // Ignore storage errors
      }
    }

    toggleSound() {
      this.sound.muted = !this.sound.muted;
      this.saveData.muted = this.sound.muted;
      this.saveProgress();
      this.updateSoundUI();
    }

    updateSoundUI() {
      this.elSoundIcon.textContent = this.sound.muted ? '🔇' : '🔊';
    }

    // ==========================================
    // Particle & Confetti Effects
    // ==========================================
    spawnTargetBurst(gx, gy) {
      const cx = this.offsetX + (gx + 0.5) * this.tileSize;
      const cy = this.offsetY + (gy + 0.5) * this.tileSize;
      const colors = ['#34d399', '#fbbf24', '#a7f3d0', '#fef08a'];

      for (let i = 0; i < 18; i++) {
        const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.25;
        const speed = 1.5 + Math.random() * 2.8;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 2.5 + Math.random() * 2.5,
          alpha: 1,
          color: colors[i % colors.length]
        });
      }
    }

    spawnVictoryConfetti() {
      const w = this.cols * this.tileSize;
      const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#a855f7', '#fde047'];
      for (let i = 0; i < 55; i++) {
        this.confetti.push({
          x: this.offsetX + Math.random() * w,
          y: -10 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 2.5,
          vy: 1.8 + Math.random() * 2.6,
          size: 5 + Math.random() * 5,
          rot: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.16,
          color: colors[i % colors.length],
          alpha: 1
        });
      }
    }

    // ==========================================
    // High-DPI Canvas Render Loop
    // ==========================================
    startRenderLoop() {
      const render = (now) => {
        this.draw(now);
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    draw(now) {
      const ctx = this.ctx;
      const ts = this.tileSize;
      const w = this.cols * ts + 16;
      const h = this.rows * ts + 16;

      ctx.clearRect(0, 0, w, h);

      // Interpolation progress for smooth movement
      const elapsed = now - this.lastMoveTime;
      const t = Math.min(1, elapsed / this.stepAnimDuration);
      const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

      const drawPx = this.visualPlayer.x + (this.player.x - this.visualPlayer.x) * ease;
      const drawPy = this.visualPlayer.y + (this.player.y - this.visualPlayer.y) * ease;
      if (t >= 1) {
        this.visualPlayer.x = this.player.x;
        this.visualPlayer.y = this.player.y;
        this.boxVisualOffsets.clear();
      }

      // 1. Draw Floor Tiles & Goals
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const px = this.offsetX + x * ts;
          const py = this.offsetY + y * ts;

          if (this.insideFloor[y][x]) {
            // Checkerboard warm slate floor
            const isAlt = (x + y) % 2 === 0;
            ctx.fillStyle = isAlt ? '#2c3240' : '#282d3a';
            ctx.fillRect(px, py, ts, ts);

            // Subtle floor tile inner groove
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
          }

          if (this.goals[y][x]) {
            this.drawGoalPad(ctx, px, py, ts, now, this.boxes[y][x]);
          }
        }
      }

      // 2. Draw Walls with 3D Bevel & Brick Texture
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (this.walls[y][x]) {
            // Only draw walls that are adjacent to insideFloor or part of the level structure
            const px = this.offsetX + x * ts;
            const py = this.offsetY + y * ts;
            this.drawWallTile(ctx, px, py, ts, x, y);
          }
        }
      }

      // 3. Draw Hover Path Preview
      if (this.hoverPath && this.hoverPath.length > 0 && !this.isWon) {
        for (let i = 0; i < this.hoverPath.length; i++) {
          const step = this.hoverPath[i];
          const cx = this.offsetX + (step.x + 0.5) * ts;
          const cy = this.offsetY + (step.y + 0.5) * ts;

          if (step.isPushTarget) {
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
            ctx.lineWidth = 2;
            ctx.strokeRect(
              this.offsetX + step.x * ts + 5,
              this.offsetY + step.y * ts + 5,
              ts - 10,
              ts - 10
            );
          } else {
            ctx.fillStyle = i === this.hoverPath.length - 1
              ? 'rgba(59, 130, 246, 0.55)'
              : 'rgba(59, 130, 246, 0.28)';
            ctx.beginPath();
            ctx.arc(cx, cy, i === this.hoverPath.length - 1 ? ts * 0.16 : ts * 0.09, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 4. Draw Crates (Boxes)
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (this.boxes[y][x]) {
            const key = `${x},${y}`;
            const off = this.boxVisualOffsets.get(key);
            const ox = off ? off.ox * (1 - ease) : 0;
            const oy = off ? off.oy * (1 - ease) : 0;

            const px = this.offsetX + (x + ox) * ts;
            const py = this.offsetY + (y + oy) * ts;
            const onGoal = this.goals[y][x];
            const isDeadlocked = this.deadlockedBoxes.has(key);

            this.drawCrate(ctx, px, py, ts, onGoal, isDeadlocked, now);
          }
        }
      }

      // 5. Draw Warehouse Worker Character
      const playerPx = this.offsetX + drawPx * ts;
      const playerPy = this.offsetY + drawPy * ts;
      this.drawPlayer(ctx, playerPx, playerPy, ts, this.player.dir, t < 1, now);

      // 6. Update & Draw Particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.032;
        if (p.alpha <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 7. Update & Draw Victory Confetti
      for (let i = this.confetti.length - 1; i >= 0; i--) {
        const c = this.confetti[i];
        c.x += c.vx;
        c.y += c.vy;
        c.rot += c.vRot;
        if (c.y > h + 20) {
          this.confetti.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
        ctx.restore();
      }
    }

    drawWallTile(ctx, px, py, ts, gx, gy) {
      // Base stone block
      ctx.fillStyle = '#3b4254';
      ctx.fillRect(px, py, ts, ts);

      // Top/Left highlight bevel
      ctx.fillStyle = '#4f586e';
      ctx.fillRect(px, py, ts, Math.max(2, ts * 0.1));
      ctx.fillRect(px, py, Math.max(2, ts * 0.08), ts);

      // Bottom dark ledge for 3D depth
      const hasWallBelow = gy + 1 < this.rows && this.walls[gy + 1][gx];
      if (!hasWallBelow) {
        ctx.fillStyle = '#20242f';
        ctx.fillRect(px, py + ts - Math.max(4, ts * 0.16), ts, Math.max(4, ts * 0.16));
      } else {
        ctx.fillStyle = '#2d3342';
        ctx.fillRect(px, py + ts - 2, ts, 2);
      }

      // Subtle brick seam
      ctx.strokeStyle = 'rgba(17, 20, 28, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);

      ctx.beginPath();
      ctx.moveTo(px, py + ts * 0.5);
      ctx.lineTo(px + ts, py + ts * 0.5);
      const midX = (gx + gy) % 2 === 0 ? ts * 0.5 : ts * 0.35;
      ctx.moveTo(px + midX, py);
      ctx.lineTo(px + midX, py + ts * 0.5);
      ctx.stroke();
    }

    drawGoalPad(ctx, px, py, ts, now, isOccupied) {
      const cx = px + ts * 0.5;
      const cy = py + ts * 0.5;
      const pulse = 0.88 + 0.12 * Math.sin(now * 0.004);

      // Outer target recess
      ctx.save();
      ctx.fillStyle = isOccupied
        ? 'rgba(16, 185, 129, 0.25)'
        : 'rgba(245, 158, 11, 0.14)';
      this.roundRect(ctx, px + ts * 0.16, py + ts * 0.16, ts * 0.68, ts * 0.68, ts * 0.14);
      ctx.fill();

      // Glowing diamond / ring marker
      ctx.strokeStyle = isOccupied
        ? 'rgba(52, 211, 153, 0.8)'
        : `rgba(251, 191, 36, ${0.65 * pulse})`;
      ctx.lineWidth = Math.max(1.5, ts * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.22 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Center core dot
      ctx.fillStyle = isOccupied ? '#34d399' : '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawCrate(ctx, px, py, ts, onGoal, isDeadlocked, now) {
      const pad = Math.max(3, ts * 0.09);
      const x = px + pad;
      const y = py + pad;
      const size = ts - pad * 2;
      const r = Math.max(4, ts * 0.12);

      ctx.save();

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      this.roundRect(ctx, x + 1, y + 3, size, size, r);
      ctx.fill();

      // Main crate body
      if (onGoal) {
        const grad = ctx.createLinearGradient(x, y, x, y + size);
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(1, '#047857');
        ctx.fillStyle = grad;
      } else {
        const grad = ctx.createLinearGradient(x, y, x, y + size);
        grad.addColorStop(0, '#d99041');
        grad.addColorStop(1, '#9a581c');
        ctx.fillStyle = grad;
      }

      this.roundRect(ctx, x, y, size, size, r);
      ctx.fill();

      // Outer border
      ctx.strokeStyle = onGoal ? '#6ee7b7' : '#f3ba73';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner recessed panel
      const inset = Math.max(4, size * 0.16);
      ctx.fillStyle = onGoal ? '#065f46' : '#7c4312';
      this.roundRect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, r * 0.5);
      ctx.fill();

      // Diagonal wooden planks
      ctx.strokeStyle = onGoal ? 'rgba(110, 231, 183, 0.45)' : 'rgba(227, 160, 86, 0.45)';
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.beginPath();
      ctx.moveTo(x + inset + 2, y + inset + 2);
      ctx.lineTo(x + size - inset - 2, y + size - inset - 2);
      ctx.moveTo(x + size - inset - 2, y + inset + 2);
      ctx.lineTo(x + inset + 2, y + size - inset - 2);
      ctx.stroke();

      // Corner rivets
      ctx.fillStyle = onGoal ? '#a7f3d0' : '#fcd34d';
      const rivetOff = inset * 0.55;
      const rivets = [
        [x + rivetOff, y + rivetOff],
        [x + size - rivetOff, y + rivetOff],
        [x + rivetOff, y + size - rivetOff],
        [x + size - rivetOff, y + size - rivetOff]
      ];
      for (const [rx, ry] of rivets) {
        ctx.beginPath();
        ctx.arc(rx, ry, Math.max(1.2, ts * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }

      // Glowing emblem when locked on goal
      if (onGoal) {
        ctx.fillStyle = '#ecfdf5';
        ctx.beginPath();
        ctx.arc(x + size * 0.5, y + size * 0.5, size * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }

      // Deadlock warning outline
      if (isDeadlocked && !onGoal) {
        const pulse = 0.45 + 0.45 * Math.sin(now * 0.008);
        ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
        ctx.lineWidth = 2.5;
        this.roundRect(ctx, x - 1, y - 1, size + 2, size + 2, r);
        ctx.stroke();
      }

      ctx.restore();
    }

    drawPlayer(ctx, px, py, ts, dir, isMoving, now) {
      const cx = px + ts * 0.5;
      const cy = py + ts * 0.5;
      const bounce = isMoving ? Math.sin(now * 0.035) * (ts * 0.04) : Math.sin(now * 0.004) * (ts * 0.015);

      ctx.save();
      ctx.translate(cx, cy + bounce);

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
      ctx.beginPath();
      ctx.ellipse(0, ts * 0.3, ts * 0.28, ts * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Shoulders / Overalls body
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(0, ts * 0.08, ts * 0.27, 0, Math.PI * 2);
      ctx.fill();

      // Hands reaching in movement direction
      const dVec = DIRS[dir] || DIRS.D;
      const handForward = ts * 0.22;
      const handSpread = ts * 0.19;
      ctx.fillStyle = '#fde68a';
      if (dVec.dx !== 0) {
        ctx.beginPath();
        ctx.arc(dVec.dx * handForward, -handSpread, ts * 0.075, 0, Math.PI * 2);
        ctx.arc(dVec.dx * handForward, handSpread, ts * 0.075, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(-handSpread, dVec.dy * handForward, ts * 0.075, 0, Math.PI * 2);
        ctx.arc(handSpread, dVec.dy * handForward, ts * 0.075, 0, Math.PI * 2);
        ctx.fill();
      }

      // Head / Hardhat
      const headGrad = ctx.createRadialGradient(-ts * 0.06, -ts * 0.1, ts * 0.04, 0, -ts * 0.04, ts * 0.26);
      headGrad.addColorStop(0, '#fef08a');
      headGrad.addColorStop(0.55, '#f59e0b');
      headGrad.addColorStop(1, '#b45309');
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(0, -ts * 0.04, ts * 0.24, 0, Math.PI * 2);
      ctx.fill();

      // Helmet stripe
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = Math.max(1.5, ts * 0.04);
      ctx.beginPath();
      ctx.arc(0, -ts * 0.04, ts * 0.14, 0, Math.PI * 2);
      ctx.stroke();

      // Expressive eyes looking in facing direction
      const eyeOffsetX = dVec.dx * (ts * 0.08);
      const eyeOffsetY = dVec.dy * (ts * 0.07) - ts * 0.03;
      ctx.fillStyle = '#111827';
      if (dir !== 'U') {
        ctx.beginPath();
        ctx.arc(eyeOffsetX - ts * 0.065, eyeOffsetY, Math.max(1.5, ts * 0.038), 0, Math.PI * 2);
        ctx.arc(eyeOffsetX + ts * 0.065, eyeOffsetY, Math.max(1.5, ts * 0.038), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }
  }

  // ==========================================
  // Bootstrap when DOM and SOKOBAN_LEVELS ready
  // ==========================================
  function initApp() {
    if (Array.isArray(window.SOKOBAN_LEVELS) && window.SOKOBAN_LEVELS.length > 0) {
      window.sokobanGame = new SokobanGame(window.SOKOBAN_LEVELS);
    } else {
      // Retry briefly in case levels.js is still loading
      let retries = 0;
      const timer = setInterval(() => {
        retries++;
        if (Array.isArray(window.SOKOBAN_LEVELS) && window.SOKOBAN_LEVELS.length > 0) {
          clearInterval(timer);
          window.sokobanGame = new SokobanGame(window.SOKOBAN_LEVELS);
        } else if (retries > 40) {
          clearInterval(timer);
          console.error('SOKOBAN_LEVELS failed to load.');
        }
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
