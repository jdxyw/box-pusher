#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Directions: 0=U, 1=D, 2=L, 3=R
const DIRS = [
  { dr: -1, dc: 0, ch: 'U' },
  { dr: 1, dc: 0, ch: 'D' },
  { dr: 0, dc: -1, ch: 'L' },
  { dr: 0, dc: 1, ch: 'R' },
];

class MinHeap {
  constructor() {
    this.data = [];
  }
  push(item) {
    this.data.push(item);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      const tmp = this.data[p];
      this.data[p] = this.data[i];
      this.data[i] = tmp;
      i = p;
    }
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        let l = (i << 1) + 1;
        let r = l + 1;
        let s = i;
        if (l < n && this.data[l].f < this.data[s].f) s = l;
        if (r < n && this.data[r].f < this.data[s].f) s = r;
        if (s === i) break;
        const tmp = this.data[i];
        this.data[i] = this.data[s];
        this.data[s] = tmp;
        i = s;
      }
    }
    return top;
  }
  get size() {
    return this.data.length;
  }
}

export function parseMap(lines) {
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  const grid = lines.map((l) => l.padEnd(width, ' ').split(''));
  const walls = Array.from({ length: height }, () => new Uint8Array(width));
  const goals = [];
  const goalSet = new Set();
  const boxes = [];
  let player = null;
  let goalsWithInitialBox = 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = grid[r][c];
      const pos = r * width + c;
      if (ch === '#') {
        walls[r][c] = 1;
      } else if (ch === '.') {
        goals.push(pos);
        goalSet.add(pos);
      } else if (ch === '$') {
        boxes.push(pos);
      } else if (ch === '*') {
        goals.push(pos);
        goalSet.add(pos);
        boxes.push(pos);
        goalsWithInitialBox++;
      } else if (ch === '@') {
        player = pos;
      } else if (ch === '+') {
        goals.push(pos);
        goalSet.add(pos);
        player = pos;
      }
    }
  }

  if (player === null || boxes.length === 0 || boxes.length !== goals.length) {
    return null;
  }

  // Flood fill reachable interior from player (ignoring boxes)
  const interior = new Uint8Array(height * width);
  const q = [player];
  interior[player] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    const r = Math.floor(cur / width);
    const c = cur % width;
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr >= 0 && nr < height && nc >= 0 && nc < width && !walls[nr][nc]) {
        const np = nr * width + nc;
        if (!interior[np]) {
          interior[np] = 1;
          q.push(np);
        }
      }
    }
  }

  for (const b of boxes) if (!interior[b]) return null;
  for (const g of goals) if (!interior[g]) return null;

  // Reverse pull-reachability from each goal to find alive squares and exact push distances
  const alive = new Uint8Array(height * width);
  const distToNearestGoal = new Int16Array(height * width).fill(999);

  for (const g of goals) {
    const rq = [g];
    const dist = new Int16Array(height * width).fill(-1);
    dist[g] = 0;
    alive[g] = 1;
    if (0 < distToNearestGoal[g]) distToNearestGoal[g] = 0;

    for (let qi = 0; qi < rq.length; qi++) {
      const cur = rq[qi];
      const r = Math.floor(cur / width);
      const c = cur % width;
      for (const d of DIRS) {
        const br = r - d.dr;
        const bc = c - d.dc;
        const pr = r - 2 * d.dr;
        const pc = c - 2 * d.dc;
        if (
          br >= 0 && br < height && bc >= 0 && bc < width &&
          pr >= 0 && pr < height && pc >= 0 && pc < width &&
          !walls[br][bc] && !walls[pr][pc]
        ) {
          const bp = br * width + bc;
          if (dist[bp] === -1) {
            dist[bp] = dist[cur] + 1;
            alive[bp] = 1;
            if (dist[bp] < distToNearestGoal[bp]) {
              distToNearestGoal[bp] = dist[bp];
            }
            rq.push(bp);
          }
        }
      }
    }
  }

  boxes.sort((a, b) => a - b);

  return {
    width,
    height,
    walls,
    interior,
    alive,
    goals,
    goalSet,
    boxes,
    player,
    goalsWithInitialBox,
    distToNearestGoal,
  };
}

function isFreezeDeadlock(parsed, boxMark, br, bc) {
  const { width, walls, goalSet } = parsed;
  const isBlocked = (r, c) => walls[r][c] === 1 || boxMark[r * width + c] === 1;
  const isWall = (r, c) => walls[r][c] === 1;

  for (const dr of [-1, 0]) {
    for (const dc of [-1, 0]) {
      const r0 = br + dr;
      const c0 = bc + dc;
      if (
        isBlocked(r0, c0) &&
        isBlocked(r0 + 1, c0) &&
        isBlocked(r0, c0 + 1) &&
        isBlocked(r0 + 1, c0 + 1)
      ) {
        const coords = [
          [r0, c0],
          [r0 + 1, c0],
          [r0, c0 + 1],
          [r0 + 1, c0 + 1],
        ];
        for (const [rr, cc] of coords) {
          const p = rr * width + cc;
          if (!isWall(rr, cc) && boxMark[p] === 1 && !goalSet.has(p)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function computePlayerReachability(parsed, boxes, playerPos) {
  const { width, height, walls } = parsed;
  const total = width * height;
  const boxMark = new Uint8Array(total);
  for (const b of boxes) boxMark[b] = 1;

  const visited = new Uint8Array(total);
  const parent = new Int32Array(total).fill(-1);
  const moveChar = new Uint8Array(total);

  const q = [playerPos];
  visited[playerPos] = 1;
  let minReachable = playerPos;

  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    if (cur < minReachable) minReachable = cur;
    const r = Math.floor(cur / width);
    const c = cur % width;
    for (let di = 0; di < 4; di++) {
      const d = DIRS[di];
      const nr = r + d.dr;
      const nc = c + d.dc;
      const np = nr * width + nc;
      if (!walls[nr][nc] && !boxMark[np] && !visited[np]) {
        visited[np] = 1;
        parent[np] = cur;
        moveChar[np] = di;
        q.push(np);
      }
    }
  }

  const reconstructPath = (target) => {
    const chars = [];
    let cur = target;
    while (cur !== playerPos) {
      chars.push(DIRS[moveChar[cur]].ch);
      cur = parent[cur];
    }
    chars.reverse();
    return chars.join('');
  };

  return { visited, minReachable, boxMark, reconstructPath };
}

export function solveLevel(lines, maxExpanded = 25000) {
  const parsed = parseMap(lines);
  if (!parsed) return null;

  const { width, walls, alive, goalSet, distToNearestGoal } = parsed;

  for (const b of parsed.boxes) {
    if (!alive[b]) return null;
  }

  const hWeight = parsed.boxes >= 4 ? 2.6 : parsed.boxes === 3 ? 1.5 : 1.0;
  const heuristic = (boxes) => {
    let h = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      h += distToNearestGoal[b];
      if (hWeight > 1.0 && !goalSet.has(b)) {
        h += 1.5;
      }
    }
    return h * hWeight;
  };

  const isSolved = (boxes) => {
    for (let i = 0; i < boxes.length; i++) {
      if (!goalSet.has(boxes[i])) return false;
    }
    return true;
  };

  const initReach = computePlayerReachability(parsed, parsed.boxes, parsed.player);
  const startKey = `${initReach.minReachable}:${parsed.boxes.join(',')}`;

  const bestG = new Map();
  bestG.set(startKey, 0);

  const heap = new MinHeap();
  heap.push({
    f: heuristic(parsed.boxes),
    pushes: 0,
    moves: 0,
    boxes: parsed.boxes,
    player: parsed.player,
    lastBoxIdx: -1,
    lastPushDir: -1,
    boxSwitches: 0,
    pushTurns: 0,
    prev: null,
    stepSeq: '',
  });

  let expanded = 0;

  const totalCells = width * parsed.height;
  const stampArr = new Int32Array(totalCells);
  const bfsQueue = new Int32Array(totalCells);
  let curStamp = 0;

  const getMinReachable = (boxMark, playerPos) => {
    curStamp++;
    let head = 0;
    let tail = 0;
    bfsQueue[tail++] = playerPos;
    stampArr[playerPos] = curStamp;
    let minReach = playerPos;
    while (head < tail) {
      const cur = bfsQueue[head++];
      if (cur < minReach) minReach = cur;
      const r = Math.floor(cur / width);
      const c = cur % width;
      for (let di = 0; di < 4; di++) {
        const d = DIRS[di];
        const nr = r + d.dr;
        const nc = c + d.dc;
        const np = nr * width + nc;
        if (!walls[nr][nc] && !boxMark[np] && stampArr[np] !== curStamp) {
          stampArr[np] = curStamp;
          bfsQueue[tail++] = np;
        }
      }
    }
    return minReach;
  };

  while (heap.size > 0 && expanded < maxExpanded) {
    const node = heap.pop();
    expanded++;

    if (isSolved(node.boxes)) {
      const parts = [];
      let cur = node;
      while (cur && cur.prev !== null) {
        parts.push(cur.stepSeq);
        cur = cur.prev;
      }
      parts.reverse();
      const solution = parts.join('');
      return {
        solved: true,
        solution,
        minPushes: node.pushes,
        minMoves: solution.length,
        boxSwitches: node.boxSwitches,
        pushTurns: node.pushTurns,
        expandedNodes: expanded,
        boxes: parsed.boxes.length,
        goalsWithInitialBox: parsed.goalsWithInitialBox,
      };
    }

    const reach = computePlayerReachability(parsed, node.boxes, node.player);
    const boxMark = reach.boxMark;

    for (let bi = 0; bi < node.boxes.length; bi++) {
      const bPos = node.boxes[bi];
      const br = Math.floor(bPos / width);
      const bc = bPos % width;

      for (let di = 0; di < 4; di++) {
        const d = DIRS[di];
        const pr = br - d.dr;
        const pc = bc - d.dc;
        const pPos = pr * width + pc;
        if (!reach.visited[pPos]) continue;

        const nbr = br + d.dr;
        const nbc = bc + d.dc;
        const nbPos = nbr * width + nbc;
        if (walls[nbr][nbc] || boxMark[nbPos] || !alive[nbPos]) continue;

        boxMark[bPos] = 0;
        boxMark[nbPos] = 1;

        if (isFreezeDeadlock(parsed, boxMark, nbr, nbc)) {
          boxMark[nbPos] = 0;
          boxMark[bPos] = 1;
          continue;
        }

        const minReach = getMinReachable(boxMark, bPos);
        boxMark[nbPos] = 0;
        boxMark[bPos] = 1;

        const nextBoxes = node.boxes.slice();
        nextBoxes[bi] = nbPos;
        nextBoxes.sort((a, b) => a - b);

        const stateKey = `${minReach}:${nextBoxes.join(',')}`;
        const nextPushes = node.pushes + 1;
        const prevBest = bestG.get(stateKey);
        if (prevBest !== undefined && prevBest <= nextPushes) continue;
        bestG.set(stateKey, nextPushes);

        const walkSeq = reach.reconstructPath(pPos);
        const stepSeq = walkSeq + d.ch;
        const newBoxIdx = nextBoxes.indexOf(nbPos);
        const switched = node.lastBoxIdx !== -1 && node.lastBoxIdx !== bi ? 1 : 0;
        const turned = node.lastPushDir !== -1 && node.lastPushDir !== di ? 1 : 0;

        heap.push({
          f: nextPushes + heuristic(nextBoxes),
          pushes: nextPushes,
          moves: node.moves + stepSeq.length,
          boxes: nextBoxes,
          player: bPos,
          lastBoxIdx: newBoxIdx,
          lastPushDir: di,
          boxSwitches: node.boxSwitches + switched,
          pushTurns: node.pushTurns + turned,
          prev: node,
          stepSeq,
        });
      }
    }
  }

  return null;
}

export function verifyReplay(lines, solution) {
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  const grid = lines.map((l) => l.padEnd(width, ' ').split(''));

  let pr = -1;
  let pc = -1;
  const goals = new Set();
  const boxes = new Set();
  const walls = new Set();

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = grid[r][c];
      const key = `${r},${c}`;
      if (ch === '#') walls.add(key);
      else if (ch === '.') goals.add(key);
      else if (ch === '$') boxes.add(key);
      else if (ch === '*') {
        goals.add(key);
        boxes.add(key);
      } else if (ch === '@') {
        pr = r;
        pc = c;
      } else if (ch === '+') {
        goals.add(key);
        pr = r;
        pc = c;
      }
    }
  }

  if (pr === -1 || boxes.size === 0 || boxes.size !== goals.size) {
    return { valid: false, reason: 'Invalid initial board state' };
  }

  const dirMap = {
    U: [-1, 0],
    D: [1, 0],
    L: [0, -1],
    R: [0, 1],
  };

  let pushes = 0;
  for (let i = 0; i < solution.length; i++) {
    const ch = solution[i].toUpperCase();
    const delta = dirMap[ch];
    if (!delta) return { valid: false, reason: `Invalid move char ${ch} at step ${i}` };
    const nr = pr + delta[0];
    const nc = pc + delta[1];
    const nKey = `${nr},${nc}`;
    if (walls.has(nKey)) {
      return { valid: false, reason: `Player walked into wall at step ${i} (${nr},${nc})` };
    }
    if (boxes.has(nKey)) {
      const br = nr + delta[0];
      const bc = nc + delta[1];
      const bKey = `${br},${bc}`;
      if (walls.has(bKey) || boxes.has(bKey)) {
        return { valid: false, reason: `Invalid box push at step ${i} into (${br},${bc})` };
      }
      boxes.delete(nKey);
      boxes.add(bKey);
      pushes++;
    }
    pr = nr;
    pc = nc;
  }

  let uncoveredGoals = 0;
  for (const g of goals) {
    if (!boxes.has(g)) uncoveredGoals++;
  }
  let unmatchedBoxes = 0;
  for (const b of boxes) {
    if (!goals.has(b)) unmatchedBoxes++;
  }

  return {
    valid: uncoveredGoals === 0 && unmatchedBoxes === 0,
    uncoveredGoals,
    unmatchedBoxes,
    moves: solution.length,
    pushes,
  };
}

function normalizeMap(lines) {
  const parsed = parseMap(lines);
  if (!parsed) return null;
  const { width, height, interior } = parsed;
  const keepWall = Array.from({ length: height }, () => new Uint8Array(width));

  let minR = height, maxR = 0, minC = width, maxC = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (interior[r * width + c]) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
              keepWall[nr][nc] = 1;
              if (nr < minR) minR = nr;
              if (nr > maxR) maxR = nr;
              if (nc < minC) minC = nc;
              if (nc > maxC) maxC = nc;
            }
          }
        }
      }
    }
  }

  const out = [];
  for (let r = minR; r <= maxR; r++) {
    let rowStr = '';
    for (let c = minC; c <= maxC; c++) {
      const p = r * width + c;
      if (interior[p]) {
        const isG = parsed.goalSet.has(p);
        const isB = parsed.boxes.includes(p);
        const isP = parsed.player === p;
        if (isP && isG) rowStr += '+';
        else if (isP) rowStr += '@';
        else if (isB && isG) rowStr += '*';
        else if (isB) rowStr += '$';
        else if (isG) rowStr += '.';
        else rowStr += ' ';
      } else if (keepWall[r][c]) {
        rowStr += '#';
      } else {
        rowStr += ' ';
      }
    }
    out.push(rowStr.replace(/\s+$/, ''));
  }
  return out;
}

const ROT90_MOVE = { U: 'R', R: 'D', D: 'L', L: 'U' };
const FLIPH_MOVE = { U: 'U', D: 'D', L: 'R', R: 'L' };

function transformSolution(sol, mapFn) {
  let out = '';
  for (let i = 0; i < sol.length; i++) {
    out += mapFn[sol[i]];
  }
  return out;
}

// D4 dihedral group transformations of both map and solution
function getD4PuzzleTransformations(lines, solution) {
  const h = lines.length;
  const w = Math.max(...lines.map((l) => l.length));
  const grid = lines.map((l) => l.padEnd(w, ' ').split(''));

  const rotate90Grid = (g) => {
    const R = g.length;
    const C = g[0].length;
    const res = Array.from({ length: C }, () => Array(R).fill(' '));
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        res[c][R - 1 - r] = g[r][c];
      }
    }
    return res;
  };

  const flipHGrid = (g) => g.map((row) => row.slice().reverse());
  const gridToLines = (g) => g.map((row) => row.join('').replace(/\s+$/, ''));

  const variants = [];
  let curGrid = grid;
  let curSol = solution;

  for (let rot = 0; rot < 4; rot++) {
    variants.push({
      map: gridToLines(curGrid),
      solution: curSol,
      orientation: rot * 2,
    });
    const flippedGrid = flipHGrid(curGrid);
    const flippedSol = transformSolution(curSol, FLIPH_MOVE);
    variants.push({
      map: gridToLines(flippedGrid),
      solution: flippedSol,
      orientation: rot * 2 + 1,
    });
    curGrid = rotate90Grid(curGrid);
    curSol = transformSolution(curSol, ROT90_MOVE);
  }
  return variants;
}

// Generate exterior wall framing variations that preserve interior geometry and exact solution
function getExteriorFramingVariations(lines, solution) {
  const h = lines.length;
  const w = Math.max(...lines.map((l) => l.length));
  const padded = lines.map((l) => l.padEnd(w, ' '));
  const out = [];

  // Variation A: fill any exterior space cell with '#' (full rectangular stone block)
  const fullRect = padded.map((row) => row.replace(/ /g, '#'));
  // Wait: only replace exterior spaces! Let's use parseMap interior to identify exterior spaces.
  const parsed = parseMap(lines);
  if (!parsed) return out;

  const { interior } = parsed;
  const extSpaces = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!interior[r * w + c] && padded[r][c] === ' ') {
        extSpaces.push([r, c]);
      }
    }
  }

  if (extSpaces.length > 0) {
    const g1 = padded.map((r) => r.split(''));
    for (const [r, c] of extSpaces) g1[r][c] = '#';
    out.push({
      map: g1.map((r) => r.join('').replace(/\s+$/, '')),
      solution,
      orientation: 8,
    });
  }

  // Variation B: add a top alcove wall row or bottom fortification row
  const topWall = '#'.repeat(w);
  out.push({
    map: [topWall, ...lines],
    solution,
    orientation: 9,
  });
  out.push({
    map: [...lines, topWall],
    solution,
    orientation: 10,
  });

  return out;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatePulledVariantsFromBaseMap(rng, lines, pullStepsList = [2, 4, 7, 10, 14, 18, 24, 30]) {
  const parsed = parseMap(lines);
  if (!parsed) return [];
  const { width: w, height: h, walls, goalSet, boxes: initBoxes, player: initPlayer } = parsed;

  const getPlayerReach = (boxes, pStart) => {
    const boxMark = new Uint8Array(w * h);
    for (const b of boxes) boxMark[b] = 1;
    const vis = new Uint8Array(w * h);
    const rq = [pStart];
    vis[pStart] = 1;
    let minP = pStart;
    for (let i = 0; i < rq.length; i++) {
      const cur = rq[i];
      if (cur < minP) minP = cur;
      const r = Math.floor(cur / w);
      const c = cur % w;
      for (const d of DIRS) {
        const nr = r + d.dr;
        const nc = c + d.dc;
        const np = nr * w + nc;
        if (!walls[nr][nc] && !boxMark[np] && !vis[np]) {
          vis[np] = 1;
          rq.push(np);
        }
      }
    }
    return { vis, minP, boxMark };
  };

  const results = [];
  const { distToNearestGoal } = parsed;
  for (const targetPulls of pullStepsList) {
    let curBoxes = initBoxes.slice();
    let curPlayer = initPlayer;
    let lastBoxPos = -1;
    let lastDr = 0;
    let lastDc = 0;
    const seenSigs = new Set([curBoxes.join(',')]);

    for (let step = 0; step < targetPulls; step++) {
      const reach = getPlayerReach(curBoxes, curPlayer);
      const candidates = [];
      for (let bi = 0; bi < curBoxes.length; bi++) {
        const bPos = curBoxes[bi];
        const br = Math.floor(bPos / w);
        const bc = bPos % w;
        for (const dir of DIRS) {
          // Do not immediately undo the previous pull
          if (bPos === lastBoxPos && dir.dr === -lastDr && dir.dc === -lastDc) continue;
          const wr = br + dir.dr;
          const wc = bc + dir.dc;
          const destR = br + 2 * dir.dr;
          const destC = bc + 2 * dir.dc;
          if (
            wr < 1 || wr >= h - 1 || wc < 1 || wc >= w - 1 ||
            destR < 1 || destR >= h - 1 || destC < 1 || destC >= w - 1
          ) continue;
          const wPos = wr * w + wc;
          const destPos = destR * w + destC;
          if (!reach.vis[wPos] || walls[destR][destC] || reach.boxMark[destPos]) continue;

          const nextB = curBoxes.slice();
          nextB[bi] = wPos;
          nextB.sort((a, b) => a - b);
          const sig = nextB.join(',');
          const novel = !seenSigs.has(sig);
          let pushDistSum = 0;
          let offGoals = 0;
          for (const b of nextB) {
            if (!goalSet.has(b)) offGoals++;
            const d = distToNearestGoal[b];
            pushDistSum += d < 900 ? d : 0;
          }
          candidates.push({
            nextB,
            destPos,
            wPos,
            dr: dir.dr,
            dc: dir.dc,
            sig,
            novel,
            weight: offGoals * 6 + pushDistSum * 2 + rng() * 4,
          });
        }
      }
      if (candidates.length === 0) break;
      const novelList = candidates.filter((c) => c.novel);
      const pool = novelList.length > 0 ? novelList : candidates;
      pool.sort((a, b) => b.weight - a.weight);
      const topK = Math.min(pool.length, 3);
      const pick = pool[Math.floor(rng() * topK)];
      curBoxes = pick.nextB;
      curPlayer = pick.destPos;
      lastBoxPos = pick.wPos;
      lastDr = pick.dr;
      lastDc = pick.dc;
      seenSigs.add(pick.sig);
    }

    const boxSet = new Set(curBoxes);
    const out = [];
    for (let r = 0; r < h; r++) {
      let row = '';
      for (let c = 0; c < w; c++) {
        const p = r * w + c;
        if (walls[r][c]) row += '#';
        else if (p === curPlayer) row += goalSet.has(p) ? '+' : '@';
        else if (boxSet.has(p)) row += goalSet.has(p) ? '*' : '$';
        else if (goalSet.has(p)) row += '.';
        else row += ' ';
      }
      out.push(row);
    }
    const norm = normalizeMap(out);
    if (norm) results.push(norm);
  }
  return results;
}

// Procedural room generator with multiple snapshots per room
function generateReverseCandidatesFromRoom(rng, w, h, numBoxes, maxDepth) {
  const walls = Array.from({ length: h }, () => Array(w).fill(1));
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      walls[r][c] = 0;
    }
  }

  const innerCells = (h - 2) * (w - 2);
  const density =
    numBoxes === 1
      ? 0.22 + rng() * 0.15
      : numBoxes >= 4
        ? 0.08 + rng() * 0.12
        : 0.12 + rng() * 0.16;
  const numWallBlocks = Math.floor(innerCells * density);
  for (let k = 0; k < numWallBlocks; k++) {
    const r = 1 + Math.floor(rng() * (h - 2));
    const c = 1 + Math.floor(rng() * (w - 2));
    walls[r][c] = 1;
  }

  const floor = [];
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      if (!walls[r][c]) floor.push(r * w + c);
    }
  }
  if (floor.length < numBoxes * 3 + 3) return [];

  const comp = [];
  const seen = new Uint8Array(w * h);
  const q = [floor[0]];
  seen[floor[0]] = 1;
  while (q.length > 0) {
    const cur = q.shift();
    comp.push(cur);
    const r = Math.floor(cur / w);
    const c = cur % w;
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      const np = nr * w + nc;
      if (nr >= 1 && nr < h - 1 && nc >= 1 && nc < w - 1 && !walls[nr][nc] && !seen[np]) {
        seen[np] = 1;
        q.push(np);
      }
    }
  }
  if (comp.length < numBoxes * 3 + 2) return [];

  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      if (!seen[r * w + c]) walls[r][c] = 1;
    }
  }

  const shuffled = comp.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (rng() < 0.7) {
    const anchor = shuffled[0];
    const ar = Math.floor(anchor / w);
    const ac = anchor % w;
    shuffled.sort((a, b) => {
      const da = Math.abs(Math.floor(a / w) - ar) + Math.abs((a % w) - ac);
      const db = Math.abs(Math.floor(b / w) - ar) + Math.abs((b % w) - ac);
      return da - db;
    });
  }

  const goals = shuffled.slice(0, numBoxes).sort((a, b) => a - b);
  const goalSet = new Set(goals);
  const startPlayer = shuffled[numBoxes];

  // Compute exact single-box push distance to nearest goal (accounting for walls)
  const distToNearestGoal = new Int16Array(w * h).fill(999);
  for (const g of goals) {
    const rq = [g];
    const dist = new Int16Array(w * h).fill(-1);
    dist[g] = 0;
    distToNearestGoal[g] = 0;
    for (let qi = 0; qi < rq.length; qi++) {
      const cur = rq[qi];
      const r = Math.floor(cur / w);
      const c = cur % w;
      for (const d of DIRS) {
        const br = r - d.dr;
        const bc = c - d.dc;
        const pr = r - 2 * d.dr;
        const pc = c - 2 * d.dc;
        if (
          br >= 1 && br < h - 1 && bc >= 1 && bc < w - 1 &&
          pr >= 1 && pr < h - 1 && pc >= 1 && pc < w - 1 &&
          !walls[br][bc] && !walls[pr][pc]
        ) {
          const bp = br * w + bc;
          if (dist[bp] === -1) {
            dist[bp] = dist[cur] + 1;
            if (dist[bp] < distToNearestGoal[bp]) {
              distToNearestGoal[bp] = dist[bp];
            }
            rq.push(bp);
          }
        }
      }
    }
  }

  const getPlayerReach = (boxes, pStart) => {
    const boxMark = new Uint8Array(w * h);
    for (const b of boxes) boxMark[b] = 1;
    const vis = new Uint8Array(w * h);
    const rq = [pStart];
    vis[pStart] = 1;
    let minP = pStart;
    for (let i = 0; i < rq.length; i++) {
      const cur = rq[i];
      if (cur < minP) minP = cur;
      const r = Math.floor(cur / w);
      const c = cur % w;
      for (const d of DIRS) {
        const nr = r + d.dr;
        const nc = c + d.dc;
        const np = nr * w + nc;
        if (!walls[nr][nc] && !boxMark[np] && !vis[np]) {
          vis[np] = 1;
          rq.push(np);
        }
      }
    }
    return { vis, minP, boxMark };
  };

  const initReach = getPlayerReach(goals, startPlayer);
  const visited = new Set([`${initReach.minP}:${goals.join(',')}`]);

  let beam = [{ boxes: goals, player: startPlayer, depth: 0 }];
  const snapshots = [];

  const maxBeamWidth = 12;
  const checkDepths = new Set([
    Math.max(2, Math.floor(maxDepth * 0.65)),
    maxDepth,
  ]);

  for (let d = 1; d <= maxDepth; d++) {
    const nextBeam = [];
    for (const state of beam) {
      const reach = getPlayerReach(state.boxes, state.player);
      for (let bi = 0; bi < state.boxes.length; bi++) {
        const bPos = state.boxes[bi];
        const br = Math.floor(bPos / w);
        const bc = bPos % w;
        for (const dir of DIRS) {
          const wr = br + dir.dr;
          const wc = bc + dir.dc;
          const destR = br + 2 * dir.dr;
          const destC = bc + 2 * dir.dc;
          if (
            wr < 1 || wr >= h - 1 || wc < 1 || wc >= w - 1 ||
            destR < 1 || destR >= h - 1 || destC < 1 || destC >= w - 1
          ) {
            continue;
          }
          const wPos = wr * w + wc;
          const destPos = destR * w + destC;
          if (!reach.vis[wPos]) continue;
          if (walls[destR][destC] || reach.boxMark[destPos]) continue;

          const nextBoxes = state.boxes.slice();
          nextBoxes[bi] = wPos;
          nextBoxes.sort((a, b) => a - b);

          const nextReach = getPlayerReach(nextBoxes, destPos);
          const key = `${nextReach.minP}:${nextBoxes.join(',')}`;
          if (visited.has(key)) continue;
          visited.add(key);

          let offGoals = 0;
          let distSum = 0;
          let minBoxDist = 99;
          for (const b of nextBoxes) {
            if (!goalSet.has(b)) offGoals++;
            const dVal = distToNearestGoal[b] < 900 ? distToNearestGoal[b] : 0;
            distSum += dVal;
            if (dVal < minBoxDist) minBoxDist = dVal;
          }

          nextBeam.push({
            boxes: nextBoxes,
            player: destPos,
            depth: d,
            rank: offGoals * 20 + minBoxDist * 8 + distSum * 3 + rng() * 3,
          });
        }
      }
    }

    if (nextBeam.length === 0) break;
    nextBeam.sort((a, b) => b.rank - a.rank);
    beam = nextBeam.slice(0, maxBeamWidth);
    if (checkDepths.has(d)) {
      snapshots.push(beam[0]);
      if (beam.length > 3) snapshots.push(beam[3]);
    }
  }

  if (snapshots.length === 0 && beam[0].depth >= 1) {
    snapshots.push(beam[0]);
  }

  const maps = [];
  for (const st of snapshots) {
    const boxSet = new Set(st.boxes);
    const lines = [];
    for (let r = 0; r < h; r++) {
      let row = '';
      for (let c = 0; c < w; c++) {
        const p = r * w + c;
        if (walls[r][c]) row += '#';
        else if (p === st.player) row += goalSet.has(p) ? '+' : '@';
        else if (boxSet.has(p)) row += goalSet.has(p) ? '*' : '$';
        else if (goalSet.has(p)) row += '.';
        else row += ' ';
      }
      lines.push(row);
    }
    const norm = normalizeMap(lines);
    if (norm) maps.push(norm);
  }
  return maps;
}

// Ultra-beginner 1-box templates (1 to 4 pushes)
const ULTRA_BEGINNER_1BOX_MAPS = [
  [
    '#####',
    '#@$.#',
    '#####',
  ],
  [
    '######',
    '#@ $.#',
    '######',
  ],
  [
    '######',
    '#@$ .#',
    '######',
  ],
  [
    '#######',
    '#@ $ .#',
    '#######',
  ],
  [
    '#######',
    '#@$  .#',
    '#######',
  ],
  [
    '#####',
    '#@  #',
    '# $ #',
    '# . #',
    '#####',
  ],
  [
    '#####',
    '#@  #',
    '# $ #',
    '#  .#',
    '#####',
  ],
  [
    '######',
    '# @  #',
    '#  $ #',
    '#  . #',
    '######',
  ],
  [
    '######',
    '#@   #',
    '# $  #',
    '# .  #',
    '######',
  ],
  [
    '#####',
    '# @ #',
    '# $ #',
    '# . #',
    '#   #',
    '#####',
  ],
  [
    '######',
    '#@   #',
    '## $ #',
    ' # . #',
    ' #####',
  ],
  [
    ' #####',
    '## @ #',
    '#  $ #',
    '#  . #',
    '######',
  ],
  [
    '######',
    '# @  #',
    '# $ .#',
    '#    #',
    '######',
  ],
  [
    '#######',
    '#  @  #',
    '#  $  #',
    '#  .  #',
    '#######',
  ],
];

// Additional 1-box and 2-box beginner templates (2 to 14 pushes)
const BEGINNER_TEMPLATES = [
  [
    ' #####',
    '##   #',
    '#@$  #',
    '### .#',
    '  ####',
  ],
  [
    '######',
    '#    #',
    '#@$  #',
    '### .#',
    '  ####',
  ],
  [
    '######',
    '#  . #',
    '# #$ #',
    '# @  #',
    '######',
  ],
  [
    '#######',
    '#     #',
    '#@$ #.#',
    '#     #',
    '#######',
  ],
  [
    '######',
    '#@   #',
    '# $$ #',
    '# .. #',
    '######',
  ],
  [
    '######',
    '# .  #',
    '# $  #',
    '#@$ .#',
    '######',
  ],
  [
    '#######',
    '# . . #',
    '# $ $ #',
    '#  @  #',
    '#######',
  ],
  [
    '#######',
    '#  .  #',
    '# #.# #',
    '# $ $ #',
    '#  @  #',
    '#######',
  ],
  [
    '######',
    '# . .#',
    '# $$ #',
    '#  @ #',
    '######',
  ],
  [
    '#######',
    '# .   #',
    '# $ $ #',
    '#@  . #',
    '#######',
  ],
  [
    '  #####',
    '###   #',
    '# $ # ##',
    '# #  . #',
    '#    # #',
    '## #   #',
    ' #@  ###',
    ' #####',
  ],
];

const HANDCRAFTED_MAPS = [
  ...ULTRA_BEGINNER_1BOX_MAPS,
  ...BEGINNER_TEMPLATES,
  [
    '####',
    '# .#',
    '#  ###',
    '#*@  #',
    '#  $ #',
    '#  ###',
    '####',
  ],
  [
    '######',
    '#    #',
    '# #@ #',
    '# $* #',
    '# .* #',
    '#    #',
    '######',
  ],
  [
    '  ####',
    '###  ####',
    '#     $ #',
    '# #  #$ #',
    '# . .#@ #',
    '#########',
  ],
  [
    '########',
    '#      #',
    '# .**$@#',
    '#      #',
    '#####  #',
    '    ####',
  ],
  [
    ' #######',
    ' #     #',
    ' # .$. #',
    '## $@$ #',
    '#  .$. #',
    '#      #',
    '########',
  ],
  [
    '######  ###',
    '#..  # ##@#',
    '#..  ###  #',
    '#..     $$#',
    '#..  # # $#',
    '#..### # $#',
    '#### $ #$ #',
    '   #  $   #',
    '   #    ###',
    '   ######',
  ],
  [
    '  ######',
    '  #    #',
    '  # ## #',
    '### $ .#',
    '#@ $ . #',
    '####   #',
    '   #####',
  ],
  [
    '#####',
    '#   ##',
    '# $  #',
    '## $ ####',
    ' ###@.  #',
    '  #  .# #',
    '  #     #',
    '  #######',
  ],
  [
    '      #####',
    '#######   #',
    '#     $ @ #',
    '#  $#...  #',
    '# $  ### ##',
    '#    # ###',
    '######',
  ],
  [
    '  ####',
    ' ##  ####',
    '##  $.  #',
    '#  #$#  #',
    '#   .  ##',
    '########',
  ],
  [
    '#######',
    '#     #',
    '# .$. #',
    '# $.$ #',
    '# .$. #',
    '# $.$ #',
    '#  @  #',
    '#######',
  ],
  [
    '#####',
    '#   ##',
    '# #@ #',
    '# $$ #',
    '## . #',
    ' # . #',
    ' #####',
  ],
  [
    '   ####',
    '####  #',
    '# $   #',
    '#  .# #',
    '## #. #',
    ' # $  #',
    ' # @ ##',
    ' #####',
  ],
  [
    '#####',
    '#   ###',
    '# . . #',
    '## $  #',
    ' # $ ###',
    ' # @   #',
    ' #######',
  ],
  [
    '#######',
    '#  .  #',
    '# #.# #',
    '#  *  #',
    '###$###',
    '  # #',
    '### $ #',
    '#    @#',
    '#######',
  ],
  [
    '####',
    '#  ####',
    '#     #',
    '#  .# #',
    '###.# #',
    ' # $$ #',
    ' #  @ #',
    ' ######',
  ],
  [
    '#######',
    '#     #',
    '# . . #',
    '# $#$ #',
    '#  @  #',
    '#######',
  ],
  [
    '######',
    '#    #',
    '# .* #',
    '# *$ #',
    '#  @ #',
    '######',
  ],
  [
    '######',
    '# . .#',
    '#  $ #',
    '### $#',
    '  # @#',
    '  ####',
  ],
  [
    '########',
    '#  ....#',
    '# #  # #',
    '#  $$$ #',
    '## $@  #',
    ' #     #',
    ' #######',
  ],
  [
    '#########',
    '#   #   #',
    '# $ # . #',
    '#  $@.  #',
    '# $ # . #',
    '#   #   #',
    '#########',
  ],
  [
    '#######',
    '#..   #',
    '#..#  #',
    '#  $$ #',
    '# # $ #',
    '#  @$ #',
    '#######',
  ],
  [
    '########',
    '#...   #',
    '#.## $ #',
    '#    $ #',
    '## #$$ #',
    ' #   @ #',
    ' #######',
  ],
  [
    '#########',
    '#.. #   #',
    '#..   $ #',
    '#.# # $ #',
    '#   #$ $#',
    '##  @   #',
    ' ########',
  ],
  [
    '  ######',
    '###    #',
    '#  $$$ #',
    '# #... #',
    '#  $@# #',
    '### .  #',
    '  ######',
  ],
  [
    '########',
    '#   .  #',
    '# $ . $#',
    '### .  #',
    ' #@$$ ##',
    ' #  . #',
    ' ######',
  ],
  [
    '#########',
    '#   .   #',
    '# $ # $ #',
    '###...###',
    '# $ # $ #',
    '#   @   #',
    '#########',
  ],
  [
    ' #######',
    '##  #  #',
    '#   $  #',
    '# #$#  #',
    '#  .@. #',
    '### # ##',
    '  # . #',
    '  #####',
  ],
  [
    '  #####',
    '###   ###',
    '#  $ $  #',
    '# #...# #',
    '#   $   #',
    '### @ ###',
    '  #####',
  ],
  [
    '########',
    '#   #  #',
    '#  $   #',
    '### #. #',
    '#@ $ . #',
    '# #$# .#',
    '#      #',
    '########',
  ],
  [
    '  ####',
    '###  #',
    '#   $##',
    '# #$. #',
    '# @ . #',
    '#######',
  ],
  [
    '#######',
    '#  . .#',
    '# $ $ #',
    '### # #',
    '  # $ #',
    '  #  @#',
    '  #####',
  ],
  [
    '  #####',
    '###   #',
    '# $ $ #',
    '# #.# ###',
    '#  *  . #',
    '###  $  #',
    '  #  .@##',
    '  ######',
  ],
  [
    '########',
    '#   .. #',
    '# #..# #',
    '# $$$  #',
    '### $ ##',
    '  # @ #',
    '  #####',
  ],
  [
    '#########',
    '#   #   #',
    '# . $ . #',
    '##$###$##',
    '# . @ . #',
    '#   #   #',
    '#########',
  ],
  [
    ' #######',
    ' #     ###',
    '## #$#   #',
    '#  .*..$ #',
    '#   $ # ##',
    '### @   #',
    '  #######',
  ],
  [
    '########',
    '#  . . #',
    '# $ $  #',
    '### # ##',
    ' # $ $ #',
    ' # . . #',
    ' #  @  #',
    ' #######',
  ],
  [
    '#########',
    '#  ...  #',
    '# # # # #',
    '# $$@$$ #',
    '#   .   #',
    '#########',
  ],
  [
    '  ######',
    '### .  #',
    '# $ .  #',
    '# # .###',
    '# $$   #',
    '### @  #',
    '  ######',
  ],
  [
    '########',
    '#  ..  #',
    '# $..$ #',
    '## ## ##',
    ' # $$ #',
    ' #  @ #',
    ' ######',
  ],
  [
    '#########',
    '#  .#.  #',
    '# $   $ #',
    '#.# $ #.#',
    '# $ @ $ #',
    '#  .#.  #',
    '#########',
  ],
  [
    '########',
    '#      #',
    '# .**. #',
    '# $  $ #',
    '###  ###',
    '  #  @#',
    '  #####',
  ],
];

const TIER_DEFINITIONS = [
  {
    tierIndex: 1,
    name: '新手入门 / Beginner',
    titles: [
      '初试身手', '直道练兵', '转角遇到箱', '双箱并进', '步步为营',
      '小试牛刀', '曲径通幽', '左右逢源', '顺水推舟', '回廊初探',
      '双星归位', '借道而行', '狭路微操', '四角腾挪', '巧借东风',
      '入门考核', '轻车熟路', '首尾相顾', '静水流深', '初出茅庐',
    ],
  },
  {
    tierIndex: 2,
    name: '渐入佳境 / Easy',
    titles: [
      '渐入佳境', '三星连珠', '十字路口', '柳暗花明', '破局之钥',
      '回字迷踪', '推陈出新', '双门紧锁', '暗度陈仓', '进退维谷',
      '三足鼎立', '隔墙有眼', '环环相扣', '灵巧转身', '先礼后兵',
      '曲折前行', '四通八达', '借尸还魂', '循序渐进', '小有成就',
    ],
  },
  {
    tierIndex: 3,
    name: '巧思妙推 / Medium',
    titles: [
      '巧思妙推', '声东击西', '四方云动', '围魏救赵', '抽丝剥茧',
      '移花接木', '金蝉脱壳', '中流砥柱', '连环计策', '狭路相逢',
      '调虎离山', '虚位以待', '乾坤挪移', '四面楚歌', '釜底抽薪',
      '柳岸花明', '推波助澜', '奇门遁甲', '纵横捭阖', '炉火纯青',
    ],
  },
  {
    tierIndex: 4,
    name: '烧脑进阶 / Hard',
    titles: [
      '烧脑进阶', '五子登科', '困兽之斗', '迷宫深处', '一夫当关',
      '盘根错节', '步步惊心', '绝处逢生', '九曲回肠', '兵贵神速',
      '暗藏玄机', '寸土必争', '完璧归赵', '反客为主', '十面埋伏',
      '运筹帷幄', '破釜沉舟', '乱石穿空', '鬼斧神工', '登峰造极',
    ],
  },
  {
    tierIndex: 5,
    name: '推箱大师 / Master',
    titles: [
      '推箱大师', '群星璀璨', '天罗地网', '乾坤大挪移', '百转千回',
      '神机妙算', '玲珑棋局', '巅峰对决', '无懈可击', '万夫莫开',
      '机关算尽', '大道至简', '绝世独立', '风云际会', '星罗棋布',
      '出神入化', '独孤求败', '超凡入圣', '宗师之路', '传奇终章',
    ],
  },
];

function computeDifficultyScore(boxes, minPushes, minMoves) {
  return Number((boxes * 18 + minPushes * 2 + minMoves * 0.15).toFixed(2));
}

function main() {
  const startTime = Date.now();
  console.log('Generating and solving 2,000 Sokoban puzzles (100 levels x 20 variants)...');
  const rng = makeRng(20261020);

  const basePuzzles = [];
  const seenBaseNormKeys = new Set();
  const allExpandedPuzzles = [];
  const seenGlobalMapKeys = new Set();

  const registerExpandedFromBase = (baseObj) => {
    const d4List = getD4PuzzleTransformations(baseObj.map, baseObj.solution);

    for (const entry of d4List) {
      const normMap = normalizeMap(entry.map) || entry.map;
      const key = normMap.join('\n');
      if (seenGlobalMapKeys.has(key)) continue;
      const check = verifyReplay(normMap, entry.solution);
      if (!check.valid || check.pushes !== baseObj.minPushes) continue;

      seenGlobalMapKeys.add(key);
      const height = normMap.length;
      const width = Math.max(...normMap.map((r) => r.length));
      allExpandedPuzzles.push({
        baseId: baseObj.baseId,
        orientation: entry.orientation,
        map: normMap,
        width,
        height,
        boxes: baseObj.boxes,
        minPushes: baseObj.minPushes,
        minMoves: entry.solution.length,
        boxSwitches: baseObj.boxSwitches,
        solution: entry.solution,
        score: computeDifficultyScore(baseObj.boxes, baseObj.minPushes, entry.solution.length),
      });
    }
  };

  const solveAndAddBase = (rawLines, maxExp = 18000, minReqPushes = 5) => {
    const norm = normalizeMap(rawLines);
    if (!norm) return null;
    const normKey = norm.join('\n');
    if (seenBaseNormKeys.has(normKey)) return null;

    const solved = solveLevel(norm, maxExp);
    if (!solved || !solved.solved || solved.boxes < 1 || solved.boxes > 4) {
      return null;
    }

    if (solved.boxes === 1) {
      // Single-box levels must be genuine winding mazes (at least 2 corner turns, >=4 pushes, >=14 moves)
      if (solved.minPushes < 4 || solved.minMoves < 14 || solved.pushTurns < 2) {
        return null;
      }
    } else if (solved.boxes === 2) {
      if (solved.minPushes < Math.max(5, minReqPushes) || solved.minMoves < 18 || solved.boxSwitches < 1) {
        return null;
      }
    } else if (solved.boxes === 3) {
      if (solved.minPushes < Math.max(7, minReqPushes) || solved.minMoves < 26 || solved.boxSwitches < 1) {
        return null;
      }
    } else if (solved.boxes === 4) {
      if (solved.minPushes < Math.max(11, minReqPushes) || solved.minMoves < 36 || solved.boxSwitches < 1) {
        return null;
      }
    }

    const replay = verifyReplay(norm, solved.solution);
    if (!replay.valid) return null;

    // Mark all D4 symmetries of norm in seenBaseNormKeys so basePuzzles are genuinely distinct
    for (const d4 of getD4PuzzleTransformations(norm, solved.solution)) {
      const n2 = normalizeMap(d4.map);
      if (n2) seenBaseNormKeys.add(n2.join('\n'));
    }
    seenBaseNormKeys.add(normKey);

    const baseObj = {
      baseId: basePuzzles.length + 1,
      map: norm,
      boxes: solved.boxes,
      minPushes: solved.minPushes,
      minMoves: solved.minMoves,
      boxSwitches: solved.boxSwitches,
      pushTurns: solved.pushTurns,
      solution: solved.solution,
      score: computeDifficultyScore(solved.boxes, solved.minPushes, solved.minMoves),
    };
    basePuzzles.push(baseObj);
    registerExpandedFromBase(baseObj);
    return baseObj;
  };

  // 1. Solve handcrafted templates (only 1..4 boxes)
  for (const m of HANDCRAFTED_MAPS) {
    solveAndAddBase(m, 30000, 5);
  }

  // 2. Multi-pass reverse-pull on handcrafted maps to create rich intermediate & deep states
  const initialBases = basePuzzles.slice();
  for (let pass = 0; pass < 4; pass++) {
    for (const b of initialBases) {
      const pulls =
        b.boxes === 1
          ? [6, 9, 12, 16, 20, 26]
          : b.boxes === 2
            ? [6, 10, 14, 18, 24, 30]
            : [10, 16, 22, 30, 40, 50];
      const pulledMaps = generatePulledVariantsFromBaseMap(rng, b.map, pulls);
      for (const pm of pulledMaps) {
        solveAndAddBase(pm, 12000, 5);
      }
    }
  }
  console.log(
    `After handcrafted + pulled variants: ${basePuzzles.length} distinct base puzzles, ${allExpandedPuzzles.length} expanded variants.`
  );

  // 3. Procedural rooms across 1 to 4 boxes (with winding 1-box mazes for Tier 1, 2-3 boxes for Tiers 2-4, 3-4 boxes for Tier 5)
  const genProfiles = [
    { w: 6, h: 6, boxes: 1, depth: 18, minPushes: 4, rooms: 120, maxExp: 3000 },
    { w: 7, h: 6, boxes: 1, depth: 24, minPushes: 4, rooms: 140, maxExp: 3500 },
    { w: 7, h: 7, boxes: 1, depth: 30, minPushes: 5, rooms: 150, maxExp: 4000 },
    { w: 8, h: 7, boxes: 1, depth: 34, minPushes: 5, rooms: 150, maxExp: 4000 },
    { w: 8, h: 8, boxes: 1, depth: 38, minPushes: 6, rooms: 120, maxExp: 4000 },
    { w: 6, h: 6, boxes: 2, depth: 18, minPushes: 5, rooms: 65, maxExp: 3500 },
    { w: 7, h: 6, boxes: 2, depth: 24, minPushes: 6, rooms: 70, maxExp: 4000 },
    { w: 7, h: 7, boxes: 2, depth: 30, minPushes: 7, rooms: 70, maxExp: 4500 },
    { w: 8, h: 7, boxes: 2, depth: 36, minPushes: 8, rooms: 65, maxExp: 4500 },
    { w: 7, h: 6, boxes: 3, depth: 26, minPushes: 7, rooms: 80, maxExp: 4500 },
    { w: 7, h: 7, boxes: 3, depth: 32, minPushes: 8, rooms: 90, maxExp: 5000 },
    { w: 8, h: 7, boxes: 3, depth: 38, minPushes: 9, rooms: 85, maxExp: 5500 },
    { w: 8, h: 8, boxes: 3, depth: 44, minPushes: 11, rooms: 75, maxExp: 6000 },
    { w: 8, h: 7, boxes: 4, depth: 40, minPushes: 12, rooms: 45, maxExp: 6000 },
    { w: 8, h: 8, boxes: 4, depth: 48, minPushes: 14, rooms: 45, maxExp: 6500 },
  ];

  for (const prof of genProfiles) {
    let addedBase = 0;
    for (let r = 0; r < prof.rooms; r++) {
      const maps = generateReverseCandidatesFromRoom(rng, prof.w, prof.h, prof.boxes, prof.depth);
      for (const m of maps) {
        const added = solveAndAddBase(m, prof.maxExp, prof.minPushes);
        if (added) {
          addedBase++;
          if (addedBase <= 45) {
            const extraPulled = generatePulledVariantsFromBaseMap(rng, added.map, [8, 14, 22, 32]);
            for (const ep of extraPulled) {
              if (solveAndAddBase(ep, prof.maxExp, prof.minPushes)) addedBase++;
            }
          }
        }
      }
    }
    console.log(
      `Profile ${prof.w}x${prof.h} (${prof.boxes} boxes, depth ${prof.depth}): +${addedBase} base puzzles (total bases: ${basePuzzles.length}, expanded: ${allExpandedPuzzles.length})`
    );
  }

  console.log(
    `Total distinct base puzzles: ${basePuzzles.length}, total unique expanded puzzles: ${allExpandedPuzzles.length}`
  );

  // Select 2,000 unique puzzles matching exact tier rules and sorted by difficulty score
  const usedMapKeys = new Set();

  const pickForBucket = (predicate, count) => {
    const matching = allExpandedPuzzles.filter(
      (p) => !usedMapKeys.has(p.map.join('\n')) && predicate(p)
    );
    matching.sort(
      (a, b) =>
        a.score - b.score ||
        a.minPushes - b.minPushes ||
        a.minMoves - b.minMoves ||
        a.baseId - b.baseId ||
        a.orientation - b.orientation
    );
    if (matching.length < count) {
      throw new Error(`Not enough puzzles for bucket: needed ${count}, found ${matching.length}`);
    }

    // Group by baseId first to maximize distinct base rooms across the selection
    const byBase = new Map();
    for (const p of matching) {
      if (!byBase.has(p.baseId)) byBase.set(p.baseId, []);
      byBase.get(p.baseId).push(p);
    }

    // Round-robin across base puzzles so we don't over-sample a single base room
    const balancedPool = [];
    let round = 0;
    let addedInRound = true;
    while (addedInRound) {
      addedInRound = false;
      for (const list of byBase.values()) {
        if (round < list.length) {
          balancedPool.push(list[round]);
          addedInRound = true;
        }
      }
      round++;
    }

    // Keep the first 2.5x count from round-robin (most diverse bases), then sort by score and sample evenly across the full tier range
    const diverseSlice = balancedPool.slice(0, Math.min(balancedPool.length, Math.max(count, Math.floor(count * 2.5))));
    diverseSlice.sort(
      (a, b) =>
        a.score - b.score ||
        a.minPushes - b.minPushes ||
        a.minMoves - b.minMoves
    );

    const selected = [];
    const localPicked = new Set();
    for (let i = 0; i < count; i++) {
      let idx = Math.floor((i * (diverseSlice.length - 1)) / Math.max(1, count - 1));
      while (idx < diverseSlice.length && localPicked.has(idx)) idx++;
      if (idx >= diverseSlice.length) {
        idx = Math.floor((i * (diverseSlice.length - 1)) / Math.max(1, count - 1));
        while (idx >= 0 && localPicked.has(idx)) idx--;
      }
      localPicked.add(idx);
      const chosen = diverseSlice[idx];
      usedMapKeys.add(chosen.map.join('\n'));
      selected.push(chosen);
    }

    selected.sort(
      (a, b) =>
        a.score - b.score ||
        a.minPushes - b.minPushes ||
        a.minMoves - b.minMoves
    );
    return selected;
  };

  // Tier 1 (Levels 1-20, 400 variants): 1 box winding mazes (>= 5 pushes, >= 18 moves, >= 2 turns)
  const tier1Variants = pickForBucket((p) => p.boxes === 1, 20 * 20);

  // For Levels 21-100 (1,600 variants), pick across 2, 3, and 4 boxes:
  // - 560 variants of 2-box puzzles (Levels 21-48)
  // - 680 variants of 3-box puzzles (Levels 49-82)
  // - 360 variants of 4-box puzzles (Levels 83-100)
  const twoBoxVariants = pickForBucket((p) => p.boxes === 2, 28 * 20);
  const threeBoxVariants = pickForBucket((p) => p.boxes === 3, 34 * 20);
  const fourBoxVariants = pickForBucket((p) => p.boxes === 4, 18 * 20);

  const all2000 = [
    ...tier1Variants,
    ...twoBoxVariants,
    ...threeBoxVariants,
    ...fourBoxVariants,
  ];

  if (all2000.length !== 2000) {
    throw new Error(`Expected 2000 total variants, got ${all2000.length}`);
  }

  // Interleave each level's 20 variants deterministically so consecutive variants have different baseIds/orientations
  const interleaveBucket = (bucket20) => {
    const copy = bucket20.slice();
    copy.sort((a, b) => (a.orientation - b.orientation) || (a.baseId - b.baseId) || (a.score - b.score));
    const out = [];
    const step = 7; // coprime with 20
    for (let i = 0; i < 20; i++) {
      out.push(copy[(i * step) % 20]);
    }
    return out;
  };

  const finalLevels = [];
  for (let idx = 0; idx < 100; idx++) {
    const id = idx + 1;
    const tierIdx = Math.floor(idx / 20);
    const withinTierIdx = idx % 20;
    const tierDef = TIER_DEFINITIONS[tierIdx];
    const title = `第${id}关 · ${tierDef.titles[withinTierIdx]}`;

    const rawBucket = all2000.slice(idx * 20, (idx + 1) * 20);
    const orderedBucket = interleaveBucket(rawBucket);

    const variants = orderedBucket.map((v, vIdx) => ({
      variantId: vIdx + 1,
      boxes: v.boxes,
      width: v.width,
      height: v.height,
      parPushes: v.minPushes,
      parMoves: v.minMoves,
      map: v.map,
      solution: v.solution,
    }));

    const v0 = variants[0];
    finalLevels.push({
      id,
      title,
      tier: tierDef.name,
      tierIndex: tierDef.tierIndex,
      boxes: v0.boxes,
      width: v0.width,
      height: v0.height,
      parPushes: v0.parPushes,
      parMoves: v0.parMoves,
      minPushes: v0.parPushes,
      minMoves: v0.parMoves,
      difficultyScore: orderedBucket[0].score,
      map: v0.map,
      solution: v0.solution,
      variants,
    });
  }

  // CRITICAL VERIFICATION: Replay all 2,000 variants and assert 100% unique maps
  const globalUniqueCheck = new Set();
  let verifiedCount = 0;

  for (const level of finalLevels) {
    if (!Array.isArray(level.variants) || level.variants.length !== 20) {
      throw new Error(`Level ${level.id} does not have exactly 20 variants!`);
    }
    for (const v of level.variants) {
      const mapStr = v.map.join('\n');
      if (globalUniqueCheck.has(mapStr)) {
        throw new Error(`Duplicate map detected on Level ${level.id} Variant ${v.variantId}`);
      }
      globalUniqueCheck.add(mapStr);

      const check = verifyReplay(v.map, v.solution);
      if (!check.valid) {
        throw new Error(
          `Replay verification failed on Level ${level.id} Variant ${v.variantId}: ${check.reason}`
        );
      }
      verifiedCount++;
    }
  }

  if (verifiedCount !== 2000 || globalUniqueCheck.size !== 2000) {
    throw new Error(
      `Verification mismatch: verifiedCount=${verifiedCount}, uniqueMaps=${globalUniqueCheck.size}`
    );
  }

  const outputPath = path.join(ROOT_DIR, 'levels.js');
  const fileContent = `/**
 * Auto-generated by scripts/generate_levels.mjs
 * 100 Sokoban levels x 20 verified variants each = 2,000 unique solvable puzzles.
 */
const SOKOBAN_LEVELS = ${JSON.stringify(finalLevels, null, 2)};

if (typeof window !== 'undefined') {
  window.SOKOBAN_LEVELS = SOKOBAN_LEVELS;
}
if (typeof globalThis !== 'undefined') {
  globalThis.SOKOBAN_LEVELS = SOKOBAN_LEVELS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SOKOBAN_LEVELS;
}
`;

  fs.writeFileSync(outputPath, fileContent, 'utf8');
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `\nSuccessfully verified ${verifiedCount}/2000 unique puzzles (${globalUniqueCheck.size} distinct maps) and wrote ${outputPath} in ${elapsedSec}s.`
  );

  for (let t = 0; t < 5; t++) {
    const sub = finalLevels.slice(t * 20, (t + 1) * 20);
    const allVars = sub.flatMap((l) => l.variants);
    const minP = Math.min(...allVars.map((x) => x.parPushes));
    const maxP = Math.max(...allVars.map((x) => x.parPushes));
    const minB = Math.min(...allVars.map((x) => x.boxes));
    const maxB = Math.max(...allVars.map((x) => x.boxes));
    console.log(
      `Tier ${t + 1} (${TIER_DEFINITIONS[t].name}): variants=${allVars.length}, boxes=${minB}..${maxB}, pushes=${minP}..${maxP}`
    );
  }
}

main();
