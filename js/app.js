'use strict';

(function () {

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    fieldSize:   'large',
    orientation: 'portrait',
    formationA:  '3-3-1',
    formationB:  '3-3-1',
    players:     [],
    ball:        { x: 25, y: 34 },
    drawings:    [],
    curDraw:     null,   // path being drawn
    frames:      [],
    tool:        'move',
    drawColor:   '#ffffff',
    drawStyle:   'solid',
    drawWidth:   'medium',
    animSpeed:   1.5,    // seconds per transition
    colorA:      '#e53935',
    colorB:      '#1e88e5',
  };

  // ── View (CSS-pixel space) ─────────────────────────────────────────────────
  const view = { scale: 1, offsetX: 0, offsetY: 0 };
  let dpr = 1;

  function fieldDims() {
    const s = FIELD_SIZES[state.fieldSize];
    return state.orientation === 'landscape'
      ? { fw: s.length, fl: s.width }
      : { fw: s.width,  fl: s.length };
  }

  function resetView() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const TOPPAD = 64; // toolbar (56px) + gap
    const PAD    = 14;
    const { fw, fl } = fieldDims();
    const availH = H - TOPPAD - PAD;
    const availW = W - PAD * 2;
    const s = Math.min(availW / fw, availH / fl);
    view.scale   = s;
    view.offsetX = (W - fw * s) / 2;
    view.offsetY = TOPPAD + (availH - fl * s) / 2;
    document.getElementById('zoom-reset').classList.remove('visible');
  }

  const mToC = (mx, my) => ({ x: view.offsetX + mx * view.scale, y: view.offsetY + my * view.scale });
  const cToM = (cx, cy) => ({ x: (cx - view.offsetX) / view.scale, y: (cy - view.offsetY) / view.scale });

  function zoomAt(cx, cy, factor) {
    const m = cToM(cx, cy);
    view.scale  *= factor;
    view.offsetX = cx - m.x * view.scale;
    view.offsetY = cy - m.y * view.scale;
    document.getElementById('zoom-reset').classList.add('visible');
  }

  // ── Canvas ─────────────────────────────────────────────────────────────────
  let canvas, ctx;

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    resetView();
    render();
  }

  function render(ovr) {
    const s = ovr || state;
    const { fw, fl } = fieldDims();
    const W = window.innerWidth;
    const H = window.innerHeight;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    // Field: in landscape mode apply portrait→landscape matrix so goals appear left/right
    ctx.save();
    if (state.orientation === 'landscape') {
      const sz = FIELD_SIZES[state.fieldSize];
      // Transform: new_x = portrait_y, new_y = W - portrait_x  →  matrix(0,-1,1,0,0,W)
      ctx.transform(0, -1, 1, 0, 0, sz.width);
      drawField(ctx, sz.width, sz.length);
    } else {
      drawField(ctx, fw, fl);
    }
    ctx.restore();

    drawDrawings(ctx, s.drawings);
    if (s.curDraw) _drawPath(ctx, s.curDraw);
    drawPlayers(ctx, s.players, s.ball);

    ctx.restore();
  }

  // inline version of _drawPath (needed here since drawing.js may not expose it)
  function _drawPath(ctx, d) {
    if (!d || d.points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = d.lineWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash(d.lineDash || []);
    ctx.beginPath();
    ctx.moveTo(d.points[0].x, d.points[0].y);
    for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  const BALL_HIT_R   = 1.3;
  const PLAYER_HIT_R = PLAYER_R * 1.4;

  function findAt(mx, my) {
    if (Math.hypot(state.ball.x - mx, state.ball.y - my) < BALL_HIT_R)
      return { type: 'ball', obj: state.ball };
    for (const p of state.players)
      if (Math.hypot(p.x - mx, p.y - my) < PLAYER_HIT_R)
        return { type: 'player', obj: p };
    return null;
  }

  // ── Pointer events ─────────────────────────────────────────────────────────
  let dragTarget   = null;
  let isPanning    = false;
  let panAnchor    = null;
  let pinchStart   = null;
  const pointers   = new Map();
  let longTimer    = null;
  let editTarget   = null;

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width  / r.width  / dpr),
      y: (e.clientY - r.top ) * (canvas.height / r.height / dpr),
    };
  }

  function onDown(e) {
    e.preventDefault();
    const cp = canvasXY(e);
    pointers.set(e.pointerId, cp);
    canvas.setPointerCapture(e.pointerId);

    if (anim.isPlaying) return;

    if (pointers.size === 2) {
      dragTarget = null; isPanning = false; clearLP();
      const pts = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        scale: view.scale,
        ox: view.offsetX,
        oy: view.offsetY,
      };
      return;
    }

    const mp = cToM(cp.x, cp.y);

    if (state.tool === 'draw') {
      state.curDraw = {
        points: [{ x: mp.x, y: mp.y }],
        color:    state.drawColor,
        lineWidth: LINE_WIDTHS[state.drawWidth],
        lineDash:  LINE_STYLES[state.drawStyle],
      };
      return;
    }

    if (state.tool === 'erase') {
      pushHistory();
      eraseNear(state.drawings, mp.x, mp.y, 2.0);
      render(); return;
    }

    // move mode
    const hit = findAt(mp.x, mp.y);
    if (hit) {
      pushHistory();
      dragTarget = hit;
      if (hit.type === 'player') {
        editTarget = hit.obj;
        longTimer  = setTimeout(() => { openPlayerDlg(hit.obj); dragTarget = null; clearLP(); }, 550);
      }
    } else {
      isPanning = true;
      panAnchor = { x: cp.x - view.offsetX, y: cp.y - view.offsetY };
    }
  }

  function onMove(e) {
    e.preventDefault();
    const cp = canvasXY(e);
    pointers.set(e.pointerId, cp);

    if (anim.isPlaying) return;

    if (pointers.size === 2 && pinchStart) {
      const pts  = [...pointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const newScale = pinchStart.scale * (dist / pinchStart.dist);
      const fmx  = (pinchStart.midX - pinchStart.ox) / pinchStart.scale;
      const fmy  = (pinchStart.midY - pinchStart.oy) / pinchStart.scale;
      view.scale   = newScale;
      view.offsetX = midX - fmx * newScale;
      view.offsetY = midY - fmy * newScale;
      document.getElementById('zoom-reset').classList.add('visible');
      render(); return;
    }

    const mp = cToM(cp.x, cp.y);

    if (state.tool === 'draw' && state.curDraw) {
      const last = state.curDraw.points[state.curDraw.points.length - 1];
      if (Math.hypot(mp.x - last.x, mp.y - last.y) > 0.1) {
        state.curDraw.points.push({ x: mp.x, y: mp.y });
        render();
      }
      return;
    }

    if (state.tool === 'erase') {
      eraseNear(state.drawings, mp.x, mp.y, 2.0);
      render(); return;
    }

    if (dragTarget) {
      clearLP();
      dragTarget.obj.x = mp.x;
      dragTarget.obj.y = mp.y;
      render(); return;
    }

    if (isPanning) {
      view.offsetX = cp.x - panAnchor.x;
      view.offsetY = cp.y - panAnchor.y;
      document.getElementById('zoom-reset').classList.add('visible');
      render();
    }
  }

  function onUp(e) {
    e.preventDefault();
    pointers.delete(e.pointerId);
    clearLP();

    if (state.tool === 'draw' && state.curDraw) {
      if (state.curDraw.points.length >= 2) {
        pushHistory();
        state.drawings.push(state.curDraw);
      }
      state.curDraw = null;
      render(); return;
    }

    if (dragTarget) { dragTarget = null; saveToStorage(); }
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { isPanning = false; panAnchor = null; }
  }

  function clearLP() {
    if (longTimer) { clearTimeout(longTimer); longTimer = null; }
    editTarget = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const cp     = canvasXY(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(cp.x, cp.y, factor);
    render();
  }

  // ── Frame management ───────────────────────────────────────────────────────
  function saveFrame() {
    state.frames.push({
      id:       Date.now(),
      players:  deepClone(state.players),
      ball:     { ...state.ball },
      drawings: deepClone(state.drawings),
    });
    renderFrameList();
    saveToStorage();
    // Flash inversion effect
    const flash = document.getElementById('save-flash');
    if (flash) {
      flash.classList.remove('flash');
      void flash.offsetWidth; // force reflow
      flash.classList.add('flash');
    }
  }

  function deleteFrame(id) {
    const idx = state.frames.findIndex(f => f.id === id);
    if (idx >= 0) state.frames.splice(idx, 1);
    renderFrameList();
    saveToStorage();
  }

  function loadFrame(frame) {
    state.players  = deepClone(frame.players);
    state.ball     = { ...frame.ball };
    state.drawings = deepClone(frame.drawings);
    render();
  }

  function renderFrameList() {
    const list = document.getElementById('frame-list');
    list.innerHTML = '';

    state.frames.forEach((frame, i) => {
      const item = document.createElement('div');
      item.className = 'frame-item';

      const mc  = document.createElement('canvas');
      mc.width  = 88;
      mc.height = 108;
      renderMini(mc.getContext('2d'), mc.width, mc.height, frame);
      item.appendChild(mc);

      const lbl  = document.createElement('div');
      lbl.className = 'frame-label';
      lbl.textContent = `${i + 1}`;
      item.appendChild(lbl);

      const del  = document.createElement('button');
      del.className = 'frame-del';
      del.textContent = '×';
      del.onclick = ev => { ev.stopPropagation(); deleteFrame(frame.id); };
      item.appendChild(del);

      item.onclick = () => loadFrame(frame);
      list.appendChild(item);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'frame-add';
    addBtn.textContent = '+';
    addBtn.onclick = saveFrame;
    list.appendChild(addBtn);
  }

  function renderMini(mCtx, w, h, frame) {
    const { fw, fl } = fieldDims();
    const s  = Math.min((w - 2) / fw, (h - 2) / fl);
    const ox = (w - fw * s) / 2;
    const oy = (h - fl * s) / 2;
    mCtx.save();
    mCtx.translate(ox, oy);
    mCtx.scale(s, s);
    mCtx.save();
    if (state.orientation === 'landscape') {
      const sz = FIELD_SIZES[state.fieldSize];
      mCtx.transform(0, -1, 1, 0, 0, sz.width);
      drawField(mCtx, sz.width, sz.length);
    } else {
      drawField(mCtx, fw, fl);
    }
    mCtx.restore();
    drawDrawings(mCtx, frame.drawings);
    drawPlayers(mCtx, frame.players, frame.ball);
    mCtx.restore();
  }

  // ── Animation ──────────────────────────────────────────────────────────────
  function togglePlay() {
    if (anim.isPlaying) {
      anim.stop();
      setPlayUI(false);
      render();
    } else {
      if (state.frames.length < 2) {
        alert('アニメーションには2枚以上のフレームが必要です。');
        return;
      }
      anim.duration = state.animSpeed;
      setPlayUI(true);
      anim.start(
        state.frames,
        s => render(s),
        () => { setPlayUI(false); render(); }
      );
    }
  }

  function setPlayUI(on) {
    document.getElementById('btn-play').classList.toggle('playing', on);
    document.getElementById('btn-play').textContent = on ? '⏹' : '▶';
    document.getElementById('play-ind').classList.toggle('visible', on);
  }

  // ── Player dialog ──────────────────────────────────────────────────────────
  let dlgPlayer = null;

  function openPlayerDlg(p) {
    dlgPlayer = p;
    document.getElementById('edit-num').value  = p.number;
    document.getElementById('edit-name').value = p.name;
    document.getElementById('player-dlg').classList.add('open');
    setTimeout(() => document.getElementById('edit-name').focus(), 100);
  }

  function closePlayerDlg() {
    document.getElementById('player-dlg').classList.remove('open');
    dlgPlayer = null;
  }

  // ── Menu / UI ──────────────────────────────────────────────────────────────
  let framePanelOpen = false;

  function openMenu() {
    document.getElementById('menu-panel').classList.add('open');
    document.getElementById('overlay').classList.add('active');
  }
  function closeMenu() {
    document.getElementById('menu-panel').classList.remove('open');
    document.getElementById('overlay').classList.remove('active');
  }

  function setTool(t) {
    state.tool = t;
    ['move', 'draw', 'erase'].forEach(id =>
      document.getElementById(`btn-${id}`).classList.toggle('active', id === t)
    );
    const dt = document.getElementById('draw-toolbar');
    dt.classList.toggle('visible', t === 'draw');
    if (t !== 'move' && framePanelOpen) toggleFramePanel();
  }

  function toggleFramePanel() {
    framePanelOpen = !framePanelOpen;
    document.getElementById('frame-panel').classList.toggle('visible', framePanelOpen);
    document.getElementById('btn-frames').classList.toggle('active', framePanelOpen);
    if (framePanelOpen) { renderFrameList(); setTool('move'); }
  }

  function rebuildTeams() {
    pushHistory();
    const { fw, fl } = fieldDims();
    applyFormation(state.players.filter(p => p.team === 'A'), state.formationA, fw, fl);
    applyFormation(state.players.filter(p => p.team === 'B'), state.formationB, fw, fl);
    state.ball = { x: fw / 2, y: fl / 2 };
    resetView();
    render();
    saveToStorage();
  }

  // ── Orientation transform ──────────────────────────────────────────────────
  // Portrait→Landscape: X=y, Y=W-x  (90° CW rotation, W = portrait field width)
  // Landscape→Portrait: X=W-y, Y=x  (inverse)

  function _transformPt(x, y, fromOri, W) {
    return fromOri === 'portrait'
      ? { x: y,     y: W - x }   // portrait → landscape
      : { x: W - y, y: x     };  // landscape → portrait
  }

  function _transformSnapshot(snapshot, fromOri, W) {
    snapshot.players.forEach(p => {
      const t = _transformPt(p.x, p.y, fromOri, W);
      p.x = t.x; p.y = t.y;
    });
    const tb = _transformPt(snapshot.ball.x, snapshot.ball.y, fromOri, W);
    snapshot.ball.x = tb.x; snapshot.ball.y = tb.y;
    snapshot.drawings.forEach(d => {
      d.points = d.points.map(pt => _transformPt(pt.x, pt.y, fromOri, W));
    });
  }

  function transformAllElements(fromOri, toOri) {
    if (fromOri === toOri) return;
    const W = FIELD_SIZES[state.fieldSize].width; // portrait width (50 or 40)
    _transformSnapshot(state, fromOri, W);
    state.frames.forEach(f => _transformSnapshot(f, fromOri, W));
  }

  // ── LocalStorage ───────────────────────────────────────────────────────────
  const STORE_KEY = 'football_board_v1';

  function saveToStorage() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        fieldSize:   state.fieldSize,
        orientation: state.orientation,
        formationA:  state.formationA,
        formationB:  state.formationB,
        players:     state.players,
        ball:        state.ball,
        drawings:    state.drawings,
        frames:      state.frames,
        animSpeed:   state.animSpeed,
        colorA:      state.colorA,
        colorB:      state.colorB,
      }));
    } catch (_) {}
  }

  function loadFromStorage() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!d) return false;
      Object.assign(state, {
        fieldSize:   d.fieldSize   || 'large',
        orientation: d.orientation || 'portrait',
        formationA:  d.formationA  || '3-3-1',
        formationB:  d.formationB  || '3-3-1',
        players:     d.players     || [],
        ball:        d.ball        || { x: 25, y: 34 },
        drawings:    d.drawings    || [],
        frames:      d.frames      || [],
        animSpeed:   d.animSpeed   || 1.5,
        colorA:      d.colorA      || '#e53935',
        colorB:      d.colorB      || '#1e88e5',
      });
      return state.players.length > 0;
    } catch (_) { return false; }
  }

  // ── History (Undo / Redo) ─────────────────────────────────────────────────
  const _undoStack = [];
  const _redoStack = [];
  const UNDO_LIMIT = 50;

  function _snapshot() {
    return {
      players:  deepClone(state.players),
      ball:     { ...state.ball },
      drawings: deepClone(state.drawings),
    };
  }

  function pushHistory() {
    _undoStack.push(_snapshot());
    if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
    _redoStack.length = 0;
    _syncUndoUI();
  }

  function clearHistory() {
    _undoStack.length = 0;
    _redoStack.length = 0;
    _syncUndoUI();
  }

  function undo() {
    if (!_undoStack.length) { showToast('これ以上元に戻せません'); return; }
    _redoStack.push(_snapshot());
    const prev = _undoStack.pop();
    state.players  = prev.players;
    state.ball     = prev.ball;
    state.drawings = prev.drawings;
    render(); saveToStorage(); _syncUndoUI();
  }

  function redo() {
    if (!_redoStack.length) { showToast('やり直す操作がありません'); return; }
    _undoStack.push(_snapshot());
    const next = _redoStack.pop();
    state.players  = next.players;
    state.ball     = next.ball;
    state.drawings = next.drawings;
    render(); saveToStorage(); _syncUndoUI();
  }

  function _syncUndoUI() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = _undoStack.length === 0;
    if (r) r.disabled = _redoStack.length === 0;
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── Team colors ───────────────────────────────────────────────────────────
  function applyTeamColors() {
    Object.assign(TEAM_COLORS.A, deriveTeamColors(state.colorA));
    Object.assign(TEAM_COLORS.B, deriveTeamColors(state.colorB));
  }

  // ── AI Consultation ────────────────────────────────────────────────────────

  const AI_URLS = {
    claude:  'https://claude.ai/new',
    chatgpt: 'https://chatgpt.com/',
    gemini:  'https://gemini.google.com/app',
  };

  function buildPrompt() {
    const { fw, fl } = fieldDims();
    const fmtTeam = (team) =>
      state.players
        .filter(p => p.team === team)
        .map(p => {
          const name = p.name ? ` ${p.name}` : '';
          return `  ${p.role} #${p.number}${name}: (${Math.round(p.x)}m, ${Math.round(p.y)}m)`;
        })
        .join('\n');

    return `## 8人制サッカー 作戦ボード — 戦術相談

フィールド: ${fw}m × ${fl}m

### チームA（赤）フォーメーション ${state.formationA}
${fmtTeam('A')}

### チームB（青）フォーメーション ${state.formationB}
${fmtTeam('B')}

ボール位置: (${Math.round(state.ball.x)}m, ${Math.round(state.ball.y)}m)

---
この配置について教えてください：
1. 現在の配置の強みと弱点
2. 改善すべき選手の移動提案
3. 攻撃・守備のポイント

選手の移動提案は必ず以下の形式で記述してください（作戦ボードに自動適用されます）：
A1: (25, 62)
A3: (38, 45)
B2: (12, 20)
※ フィールド座標の範囲: x = 0〜${fw}m、y = 0〜${fl}m（チームA のゴールは y=${fl}m 側）`;
  }

  function openAIDlg() {
    document.getElementById('ai-prompt').value = buildPrompt();
    document.getElementById('ai-response').value = '';
    document.getElementById('ai-dlg').classList.add('open');
  }

  function closeAIDlg() {
    document.getElementById('ai-dlg').classList.remove('open');
  }

  async function copyPromptToClipboard() {
    const text = document.getElementById('ai-prompt').value;
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 プロンプトをコピーしました');
      return true;
    } catch (_) {
      // Fallback: select the textarea
      const ta = document.getElementById('ai-prompt');
      ta.select();
      document.execCommand('copy');
      showToast('📋 コピーしました（テキストを選択してCtrl+C）');
      return false;
    }
  }

  async function consultAI(svc) {
    await copyPromptToClipboard();
    const url = AI_URLS[svc];
    if (url) window.open(url, '_blank', 'noopener');
  }

  function applyAIResponse() {
    const text = document.getElementById('ai-response').value;
    if (!text.trim()) {
      showToast('⚠️ 回答が入力されていません');
      return;
    }

    const { fw, fl } = fieldDims();
    // Match patterns like: A3: (38, 25)  A3:(38,25)  B2 → 12, 50  A3 -> (38 25)
    const pattern = /([AB])\s*(\d+)\s*[:：→>→\-]+\s*\(?\s*(\d+(?:\.\d+)?)\s*[,、\s]\s*(\d+(?:\.\d+)?)\s*\)?/g;
    let match, count = 0, skipped = 0;

    while ((match = pattern.exec(text)) !== null) {
      const [, team, numStr, xStr, yStr] = match;
      const num = parseInt(numStr, 10);
      const x   = parseFloat(xStr);
      const y   = parseFloat(yStr);

      // Validate coordinates within field bounds (with some margin)
      if (x < -2 || x > fw + 2 || y < -2 || y > fl + 2) { skipped++; continue; }

      const player = state.players.find(p => p.team === team && p.number === num);
      if (player) {
        player.x = Math.max(0, Math.min(fw, x));
        player.y = Math.max(0, Math.min(fl, y));
        count++;
      }
    }

    if (count > 0) {
      render();
      saveToStorage();
      const msg = skipped > 0
        ? `✅ ${count}人を移動しました（${skipped}件は範囲外でスキップ）`
        : `✅ ${count}人の選手を移動しました`;
      showToast(msg, 3000);
      closeAIDlg();
    } else {
      showToast('⚠️ 移動指示が見つかりませんでした。形式を確認してください。');
    }
  }

  // ── MCP WebSocket Bridge ───────────────────────────────────────────────────
  function initMCPBridge() {
    let ws = null;
    let reconnTimer = null;

    function setStatus(connected) {
      const el = document.getElementById('mcp-status');
      if (el) el.className = 'mcp-dot' + (connected ? ' connected' : '');
    }

    function reply(requestId, data, error) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify(error ? { requestId, error } : { requestId, data }));
    }

    function handleCommand(msg) {
      const { type, requestId } = msg;
      try {
        switch (type) {
          case 'get_state': {
            const { fw, fl } = fieldDims();
            reply(requestId, {
              fieldSize:   state.fieldSize,
              orientation: state.orientation,
              fieldWidth:  fw,
              fieldLength: fl,
              formationA:  state.formationA,
              formationB:  state.formationB,
              ball:        { x: +state.ball.x.toFixed(1), y: +state.ball.y.toFixed(1) },
              frameCount:  state.frames.length,
              players: state.players.map(p => ({
                id: p.id, team: p.team, number: p.number,
                name: p.name, role: p.role,
                x: +p.x.toFixed(1), y: +p.y.toFixed(1),
              })),
            });
            break;
          }
          case 'move_player': {
            const { fw, fl } = fieldDims();
            const player = state.players.find(
              p => p.team === msg.team && p.number === msg.number
            );
            if (!player) throw new Error(`プレイヤー ${msg.team}${msg.number} が見つかりません`);
            pushHistory();
            player.x = Math.max(0, Math.min(fw, msg.x));
            player.y = Math.max(0, Math.min(fl, msg.y));
            render(); saveToStorage();
            reply(requestId, { success: true });
            break;
          }
          case 'move_ball': {
            const { fw, fl } = fieldDims();
            pushHistory();
            state.ball.x = Math.max(0, Math.min(fw, msg.x));
            state.ball.y = Math.max(0, Math.min(fl, msg.y));
            render(); saveToStorage();
            reply(requestId, { success: true });
            break;
          }
          case 'set_formation': {
            const { fw, fl } = fieldDims();
            const sel = document.getElementById(msg.team === 'A' ? 'sel-fa' : 'sel-fb');
            if (sel) sel.value = msg.formation;
            if (msg.team === 'A') state.formationA = msg.formation;
            else                  state.formationB = msg.formation;
            pushHistory();
            applyFormation(
              state.players.filter(p => p.team === msg.team),
              msg.formation, fw, fl
            );
            render(); saveToStorage();
            reply(requestId, { success: true });
            break;
          }
          case 'save_frame':
            saveFrame();
            reply(requestId, { frameCount: state.frames.length });
            break;
          case 'reset_ball': {
            const { fw, fl } = fieldDims();
            pushHistory();
            state.ball = { x: fw / 2, y: fl / 2 };
            render(); saveToStorage();
            reply(requestId, { success: true });
            break;
          }
          case 'clear_drawings':
            pushHistory();
            state.drawings = [];
            render(); saveToStorage();
            reply(requestId, { success: true });
            break;
          default:
            reply(requestId, null, `不明なコマンド: ${type}`);
        }
      } catch (err) {
        reply(requestId, null, err.message);
      }
    }

    function connect() {
      try { ws = new WebSocket('ws://localhost:3001'); }
      catch (_) { scheduleReconnect(); return; }

      ws.onopen  = () => { setStatus(true);  console.log('[MCP] 接続'); };
      ws.onclose = () => { setStatus(false); scheduleReconnect(); };
      ws.onerror = () => {};
      ws.onmessage = ev => {
        try { handleCommand(JSON.parse(ev.data)); } catch (_) {}
      };
    }

    function scheduleReconnect() {
      clearTimeout(reconnTimer);
      reconnTimer = setTimeout(connect, 4000);
    }

    connect();
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('canvas');
    ctx    = canvas.getContext('2d');

    const stored = loadFromStorage();
    if (!stored) {
      const { fw, fl } = fieldDims();
      state.players = [
        ...createTeam('A', state.formationA, fw, fl),
        ...createTeam('B', state.formationB, fw, fl),
      ];
      state.ball = { x: fw / 2, y: fl / 2 };
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Pointer events
    canvas.addEventListener('pointerdown',  onDown,  { passive: false });
    canvas.addEventListener('pointermove',  onMove,  { passive: false });
    canvas.addEventListener('pointerup',    onUp,    { passive: false });
    canvas.addEventListener('pointercancel',onUp,    { passive: false });
    canvas.addEventListener('wheel',        onWheel, { passive: false });
    canvas.addEventListener('contextmenu',  e => e.preventDefault());

    // Toolbar
    document.getElementById('btn-move' ).onclick = () => setTool('move');
    document.getElementById('btn-draw' ).onclick = () => setTool('draw');
    document.getElementById('btn-erase').onclick = () => setTool('erase');
    document.getElementById('btn-save-frame').onclick = saveFrame;
    document.getElementById('btn-play'  ).onclick = togglePlay;
    document.getElementById('btn-frames').onclick = toggleFramePanel;
    document.getElementById('btn-ai'    ).onclick = openAIDlg;
    document.getElementById('btn-menu'  ).onclick = openMenu;

    // AI dialog
    document.getElementById('ai-close'      ).onclick = closeAIDlg;
    document.getElementById('btn-ai-close2' ).onclick = closeAIDlg;
    document.getElementById('ai-dlg'        ).onclick = e => {
      if (e.target === document.getElementById('ai-dlg')) closeAIDlg();
    };
    document.getElementById('btn-copy-prompt').onclick = copyPromptToClipboard;
    document.getElementById('btn-apply-ai'  ).onclick = applyAIResponse;
    document.querySelectorAll('.ai-svc-btn').forEach(btn => {
      btn.onclick = () => consultAI(btn.dataset.svc);
    });

    document.getElementById('zoom-reset').onclick = () => { resetView(); render(); };
    document.getElementById('overlay'   ).onclick = closeMenu;
    document.getElementById('menu-close').onclick = closeMenu;
    document.getElementById('btn-undo'  ).onclick = undo;
    document.getElementById('btn-redo'  ).onclick = redo;

    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      }
    });

    // Field size
    document.getElementById('btn-large').onclick = () => {
      state.fieldSize = 'large';
      syncFieldSizeBtns();
      rebuildTeams();
    };
    document.getElementById('btn-small').onclick = () => {
      state.fieldSize = 'small';
      syncFieldSizeBtns();
      rebuildTeams();
    };

    // Orientation
    document.getElementById('btn-portrait' ).onclick = () => {
      if (state.orientation === 'portrait') return;
      transformAllElements(state.orientation, 'portrait');
      state.orientation = 'portrait';
      clearHistory(); // coordinates changed system
      syncOriBtns(); resetView(); render(); saveToStorage();
    };
    document.getElementById('btn-landscape').onclick = () => {
      if (state.orientation === 'landscape') return;
      transformAllElements(state.orientation, 'landscape');
      state.orientation = 'landscape';
      clearHistory(); // coordinates changed system
      syncOriBtns(); resetView(); render(); saveToStorage();
    };

    // Formation
    document.getElementById('sel-fa').onchange = e => { state.formationA = e.target.value; };
    document.getElementById('sel-fb').onchange = e => { state.formationB = e.target.value; };
    document.getElementById('btn-apply-form').onclick = () => { rebuildTeams(); closeMenu(); };

    // Reset ball
    document.getElementById('btn-reset-ball').onclick = () => {
      const { fw, fl } = fieldDims();
      state.ball = { x: fw / 2, y: fl / 2 };
      render(); saveToStorage();
    };

    // Clear drawings
    document.getElementById('btn-clear-draw').onclick = () => {
      if (confirm('描画をすべて消去しますか？')) {
        state.drawings = []; render(); saveToStorage();
      }
    };

    // Clear frames
    document.getElementById('btn-clear-frames').onclick = () => {
      if (confirm('フレームをすべて削除しますか？')) {
        state.frames = []; renderFrameList(); saveToStorage();
      }
    };

    // Save / Load
    document.getElementById('btn-save').onclick = () => {
      saveToStorage();
      const b = document.getElementById('btn-save');
      b.textContent = '保存しました ✓';
      setTimeout(() => { b.textContent = 'ブラウザに保存'; }, 1800);
    };
    document.getElementById('btn-load').onclick = () => {
      if (loadFromStorage()) { clearHistory(); syncUI(); applyTeamColors(); render(); renderFrameList(); }
    };

    // Animation speed
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel  = document.getElementById('speed-label');
    speedSlider.value = state.animSpeed;
    speedLabel.textContent = state.animSpeed + 's';
    speedSlider.oninput = () => {
      state.animSpeed    = parseFloat(speedSlider.value);
      speedLabel.textContent = state.animSpeed + 's';
    };

    // Color swatches
    document.querySelectorAll('.color-swatch').forEach(el => {
      el.onclick = () => {
        state.drawColor = el.dataset.color;
        document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
      };
    });

    // Line style buttons
    document.querySelectorAll('.ds-btn').forEach(el => {
      el.onclick = () => {
        state.drawStyle = el.dataset.style;
        document.querySelectorAll('.ds-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
      };
    });

    // Line width buttons
    document.querySelectorAll('.dw-btn').forEach(el => {
      el.onclick = () => {
        state.drawWidth = el.dataset.width;
        document.querySelectorAll('.dw-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
      };
    });

    // Player dialog
    document.getElementById('btn-dlg-ok').onclick = () => {
      if (dlgPlayer) {
        const n = parseInt(document.getElementById('edit-num').value, 10);
        if (!isNaN(n) && n >= 1 && n <= 99) dlgPlayer.number = n;
        dlgPlayer.name = document.getElementById('edit-name').value.trim().slice(0, 12);
        render(); saveToStorage();
      }
      closePlayerDlg();
    };
    document.getElementById('btn-dlg-cancel').onclick = closePlayerDlg;
    document.getElementById('player-dlg').onclick = e => {
      if (e.target === document.getElementById('player-dlg')) closePlayerDlg();
    };

    // Team color pickers
    const colorPickA = document.getElementById('color-a');
    const colorPickB = document.getElementById('color-b');
    if (colorPickA) {
      colorPickA.value    = state.colorA;
      colorPickA.oninput  = () => { state.colorA = colorPickA.value; applyTeamColors(); render(); saveToStorage(); };
    }
    if (colorPickB) {
      colorPickB.value    = state.colorB;
      colorPickB.oninput  = () => { state.colorB = colorPickB.value; applyTeamColors(); render(); saveToStorage(); };
    }

    syncUI();
    applyTeamColors();
    render();
    initMCPBridge();
  }

  function syncFieldSizeBtns() {
    document.getElementById('btn-large').classList.toggle('active', state.fieldSize === 'large');
    document.getElementById('btn-small').classList.toggle('active', state.fieldSize === 'small');
  }

  function syncOriBtns() {
    document.getElementById('btn-portrait' ).classList.toggle('active', state.orientation === 'portrait');
    document.getElementById('btn-landscape').classList.toggle('active', state.orientation === 'landscape');
  }

  function syncUI() {
    setTool(state.tool);
    syncFieldSizeBtns();
    syncOriBtns();
    document.getElementById('sel-fa').value = state.formationA;
    document.getElementById('sel-fb').value = state.formationB;
    document.getElementById('speed-slider').value = state.animSpeed;
    document.getElementById('speed-label').textContent = state.animSpeed + 's';
    const ca = document.getElementById('color-a');
    const cb = document.getElementById('color-b');
    if (ca) ca.value = state.colorA;
    if (cb) cb.value = state.colorB;
    // Default draw options
    const firstColor = document.querySelector(`.color-swatch[data-color="${state.drawColor}"]`);
    if (firstColor) firstColor.classList.add('active');
    else document.querySelector('.color-swatch').classList.add('active');
    document.querySelector('.ds-btn[data-style="solid"]').classList.add('active');
    document.querySelector('.dw-btn[data-width="medium"]').classList.add('active');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
