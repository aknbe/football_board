'use strict';

// Relative positions (x: 0-1 across width, y: 0-1 from own goal to midfield)
// GK≈9m, DF≈14m, MF=midpoint(DF,FW), FW=halfway-2m  (large field half=34m)
const FORMATIONS = {
  '3-3-1': [
    { x: 0.50, y: 0.26, role: 'GK' },
    { x: 0.20, y: 0.41, role: 'DF' }, { x: 0.50, y: 0.41, role: 'DF' }, { x: 0.80, y: 0.41, role: 'DF' },
    { x: 0.20, y: 0.67, role: 'MF' }, { x: 0.50, y: 0.67, role: 'MF' }, { x: 0.80, y: 0.67, role: 'MF' },
    { x: 0.50, y: 0.94, role: 'FW' },
  ],
  '2-4-1': [
    { x: 0.50, y: 0.26, role: 'GK' },
    { x: 0.30, y: 0.41, role: 'DF' }, { x: 0.70, y: 0.41, role: 'DF' },
    { x: 0.15, y: 0.67, role: 'MF' }, { x: 0.38, y: 0.67, role: 'MF' },
    { x: 0.62, y: 0.67, role: 'MF' }, { x: 0.85, y: 0.67, role: 'MF' },
    { x: 0.50, y: 0.94, role: 'FW' },
  ],
  '2-3-2': [
    { x: 0.50, y: 0.26, role: 'GK' },
    { x: 0.30, y: 0.41, role: 'DF' }, { x: 0.70, y: 0.41, role: 'DF' },
    { x: 0.20, y: 0.67, role: 'MF' }, { x: 0.50, y: 0.67, role: 'MF' }, { x: 0.80, y: 0.67, role: 'MF' },
    { x: 0.35, y: 0.94, role: 'FW' }, { x: 0.65, y: 0.94, role: 'FW' },
  ],
  '3-2-2': [
    { x: 0.50, y: 0.26, role: 'GK' },
    { x: 0.20, y: 0.41, role: 'DF' }, { x: 0.50, y: 0.41, role: 'DF' }, { x: 0.80, y: 0.41, role: 'DF' },
    { x: 0.35, y: 0.67, role: 'MF' }, { x: 0.65, y: 0.67, role: 'MF' },
    { x: 0.35, y: 0.94, role: 'FW' }, { x: 0.65, y: 0.94, role: 'FW' },
  ],
};

const TEAM_COLORS = {
  A: { fill: '#e53935', stroke: '#b71c1c', gkFill: '#e65100', gkStroke: '#bf360c', text: '#fff' },
  B: { fill: '#1e88e5', stroke: '#0d47a1', gkFill: '#f9a825', gkStroke: '#f57f17', text: '#fff' },
};

const PLAYER_R = 1.15; // radius in meters

function createTeam(team, formation, fw, fl) {
  const positions = FORMATIONS[formation] || FORMATIONS['3-3-1'];
  const half = fl / 2;
  return positions.map((pos, i) => {
    let x, y;
    if (team === 'A') {
      x = pos.x * fw;
      y = fl - pos.y * half;       // bottom half, GK near y=fl
    } else {
      x = (1 - pos.x) * fw;
      y = pos.y * half;             // top half, GK near y=0
    }
    return { id: `${team}${i + 1}`, team, number: i + 1, name: '', role: pos.role, x, y };
  });
}

function applyFormation(players, formation, fw, fl) {
  const positions = FORMATIONS[formation];
  if (!positions) return;
  const half = fl / 2;
  players.forEach((p, i) => {
    const pos = positions[i];
    if (!pos) return;
    p.role = pos.role;
    if (p.team === 'A') {
      p.x = pos.x * fw;
      p.y = fl - pos.y * half;
    } else {
      p.x = (1 - pos.x) * fw;
      p.y = pos.y * half;
    }
  });
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function _diamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx,     cy - r);
  ctx.lineTo(cx + r, cy    );
  ctx.lineTo(cx,     cy + r);
  ctx.lineTo(cx - r, cy    );
  ctx.closePath();
}

function _shadow(ctx, fn, dx, dy) {
  ctx.save();
  ctx.translate(dx, dy);
  fn();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.restore();
}

function drawBall(ctx, ball) {
  const r = PLAYER_R * 0.8; // ~0.92m, 80% of player radius
  // shadow
  ctx.save();
  ctx.beginPath();
  ctx.arc(ball.x + 0.08, ball.y + 0.08, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  ctx.restore();
  // body
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 0.06;
  ctx.stroke();
  // pattern hint
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = '#444';
  ctx.fill();
}

function drawPlayer(ctx, p) {
  const colors = TEAM_COLORS[p.team];
  const r      = PLAYER_R;
  const isGK   = p.role === 'GK';

  // shadow
  ctx.save();
  ctx.translate(0.1, 0.1);
  if (isGK) { _diamond(ctx, p.x, p.y, r * 1.05); }
  else       { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.restore();

  // body
  if (isGK) { _diamond(ctx, p.x, p.y, r * 1.05); }
  else       { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
  ctx.fillStyle   = isGK ? colors.gkFill   : colors.fill;
  ctx.fill();
  ctx.strokeStyle = isGK ? colors.gkStroke : colors.stroke;
  ctx.lineWidth   = 0.1;
  ctx.stroke();

  // number
  ctx.fillStyle    = colors.text;
  ctx.font         = `bold ${(r * 0.9).toFixed(2)}px -apple-system,sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(p.number), p.x, p.y + 0.04);

  // name
  if (p.name) {
    ctx.font         = `${(r * 0.62).toFixed(2)}px -apple-system,sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.95)';
    ctx.textBaseline = 'top';
    ctx.fillText(p.name, p.x, p.y + r + 0.2);
  }
}

function drawPlayers(ctx, players, ball) {
  drawBall(ctx, ball);
  players.forEach(p => drawPlayer(ctx, p));
}

// ── Team color derivation ─────────────────────────────────────────────────

function deriveTeamColors(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d) {
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  function hsl2hex(hh, ss, ll) {
    if (!ss) {
      const v = Math.round(Math.max(0, Math.min(1, ll)) * 255);
      return '#' + [v,v,v].map(x => x.toString(16).padStart(2,'0')).join('');
    }
    const q = ll < .5 ? ll*(1+ss) : ll+ss-ll*ss, p = 2*ll - q;
    const hue = t => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q-p)*6*t;
      if (t < .5)  return q;
      if (t < 2/3) return p + (q-p)*(2/3-t)*6;
      return p;
    };
    return '#' + [hue(hh+1/3), hue(hh), hue(hh-1/3)]
      .map(v => Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
  }
  const fill     = hex;
  const stroke   = hsl2hex(h, s, Math.max(l * 0.62, 0.04));
  const gkFill   = hsl2hex((h + 0.10) % 1, Math.min(s * 1.1, 1), Math.min(l + 0.12, 0.80));
  const gkStroke = hsl2hex((h + 0.10) % 1, Math.min(s * 1.1, 1), Math.max(l * 0.62, 0.04));
  const text     = l > 0.55 ? '#111' : '#fff';
  return { fill, stroke, gkFill, gkStroke, text };
}
