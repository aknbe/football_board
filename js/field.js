'use strict';

const FIELD_SIZES = {
  large: { width: 50, length: 68 },
  small: { width: 40, length: 56 },
};

// Field marking dimensions (meters, 8-a-side official)
const FM = {
  goalWidth:         5,
  goalDepth:         2,
  goalAreaWidth:    13,
  goalAreaDepth:     4,
  penAreaWidth:     29,
  penAreaDepth:     12,
  penSpot:           8,
  centerR:           7,
  penArcR:           7,
  cornerR:           1,
};

function drawField(ctx, fw, fl) {
  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, fw, fl);

  // Alternating stripe pattern (every 4m)
  const stripeW = 4;
  for (let i = 0; i * stripeW < fl; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      ctx.fillRect(0, i * stripeW, fw, stripeW);
    }
  }

  // ── Line style ───────────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth   = 0.11;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.setLineDash([]);

  // ── Field outline ────────────────────────────────────────────────────────────
  ctx.strokeRect(0, 0, fw, fl);

  // ── Halfway line ─────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(0, fl / 2);
  ctx.lineTo(fw, fl / 2);
  ctx.stroke();

  // ── Centre circle ─────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(fw / 2, fl / 2, FM.centerR, 0, Math.PI * 2);
  ctx.stroke();

  // Centre spot
  ctx.beginPath();
  ctx.arc(fw / 2, fl / 2, 0.18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  // ── Both penalty ends ─────────────────────────────────────────────────────────
  _drawEnd(ctx, fw, fl, true);
  _drawEnd(ctx, fw, fl, false);
}

function _drawEnd(ctx, fw, fl, isTop) {
  const cx = fw / 2;
  const pSpotY  = isTop ? FM.penSpot : fl - FM.penSpot;
  const paEdgeY = isTop ? FM.penAreaDepth : fl - FM.penAreaDepth;

  // Goal (behind goal line)
  const gx = cx - FM.goalWidth / 2;
  const gy = isTop ? -FM.goalDepth : fl;
  ctx.strokeRect(gx, gy, FM.goalWidth, FM.goalDepth);

  // Goal area box
  const gaX = cx - FM.goalAreaWidth / 2;
  const gaY = isTop ? 0 : fl - FM.goalAreaDepth;
  ctx.strokeRect(gaX, gaY, FM.goalAreaWidth, FM.goalAreaDepth);

  // Penalty area box
  const paX = cx - FM.penAreaWidth / 2;
  const paY = isTop ? 0 : fl - FM.penAreaDepth;
  ctx.strokeRect(paX, paY, FM.penAreaWidth, FM.penAreaDepth);

  // Penalty spot
  ctx.beginPath();
  ctx.arc(cx, pSpotY, 0.18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  // Penalty arc — only the part outside the penalty area
  ctx.save();
  ctx.beginPath();
  if (isTop) {
    ctx.rect(-1, FM.penAreaDepth, fw + 2, fl);
  } else {
    ctx.rect(-1, 0, fw + 2, fl - FM.penAreaDepth);
  }
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx, pSpotY, FM.penArcR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth   = 0.11;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();

  // Corner arcs (clipped to field interior)
  const cornerYs = isTop ? [0] : [fl];
  const cornerXs = [0, fw];
  cornerYs.forEach(cy2 => {
    cornerXs.forEach(cx2 => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, fw, fl);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(cx2, cy2, FM.cornerR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth   = 0.11;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
    });
  });
}
