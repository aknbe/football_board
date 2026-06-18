/**
 * Mathematical optimization algorithms for soccer board.
 * Includes Voronoi, Pitch Control, Hungarian, and Potential Field methods.
 */

// Roles configuration speeds (m/s)
const ROLE_SPEEDS = {
  GK: 8.0,
  DF: 9.0,
  MF: 9.5,
  FW: 10.0
};

/**
 * 1. Voronoi Area Dominance (Space Score)
 * Computes which team controls which grid points.
 * Returns the control score of team A and team B, and grid data.
 */
function computeVoronoi(players, fw, fl) {
  const step = 2.0;
  const nx = Math.ceil(fw / step);
  const ny = Math.ceil(fl / step);
  let teamAScore = 0;
  let teamBScore = 0;
  const grid = [];

  for (let j = 0; j < ny; j++) {
    const y = j * step + step / 2;
    for (let i = 0; i < nx; i++) {
      const x = i * step + step / 2;
      
      let minDist = Infinity;
      let closestPlayer = null;

      for (const p of players) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < minDist) {
          minDist = d;
          closestPlayer = p;
        }
      }

      if (closestPlayer) {
        if (closestPlayer.team === 'A') {
          teamAScore++;
          grid.push({ x, y, team: 'A' });
        } else {
          teamBScore++;
          grid.push({ x, y, team: 'B' });
        }
      }
    }
  }

  const total = teamAScore + teamBScore;
  return {
    scoreA: total > 0 ? (teamAScore / total) * 100 : 50,
    scoreB: total > 0 ? (teamBScore / total) * 100 : 50,
    grid
  };
}

/**
 * 2. Spearman Pitch Control (Simplified)
 * Probability of team controlling the ball at point (x, y).
 */
function computePitchControlHeatmap(players, fw, fl, team) {
  const step = 2.0;
  const nx = Math.ceil(fw / step);
  const ny = Math.ceil(fl / step);
  const heatmap = new Float32Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const y = j * step + step / 2;
    for (let i = 0; i < nx; i++) {
      const x = i * step + step / 2;
      
      let minTimeA = Infinity;
      let minTimeB = Infinity;

      for (const p of players) {
        const dist = Math.hypot(p.x - x, p.y - y);
        const speed = ROLE_SPEEDS[p.role] || 9.0;
        const time = dist / speed;

        if (p.team === 'A') {
          if (time < minTimeA) minTimeA = time;
        } else {
          if (time < minTimeB) minTimeB = time;
        }
      }

      // Sigmoid control probability: Spearman-like time difference model
      // P = 1 / (1 + exp(-k * (TimeOpp - TimeOwn)))
      const k = 1.8; // scaling factor for time difference
      const timeOwn = team === 'A' ? minTimeA : minTimeB;
      const timeOpp = team === 'A' ? minTimeB : minTimeA;

      const pControl = 1.0 / (1.0 + Math.exp(-k * (timeOpp - timeOwn)));
      heatmap[j * nx + i] = pControl;
    }
  }

  return { heatmap, nx, ny, step };
}

/**
 * 3. Hungarian Algorithm for Optimal Assignment (O(N^3))
 * Solves the assignment problem: minimizing total cost.
 */
function hungarianAssign(costMatrix) {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0].length;

  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      result[p[j] - 1] = j - 1;
    }
  }
  return result;
}

/**
 * 4. Team-level Optimization
 * Uses Hungarian method to assign players to ideal positions.
 * Formation positions are scaled, shifted by ball position, then matched.
 */
function optimizeTeam(team, formation, players, ball, fw, fl) {
  // Get all active players of target team
  const teamPlayers = players.filter(p => p.team === team);
  if (teamPlayers.length === 0) return [];

  // Get formation template positions from player.js FORMATIONS
  const positions = FORMATIONS[formation];
  if (!positions) return [];

  const half = fl / 2;
  const isTeamA = (team === 'A');

  // GK is fixed to GK position and not optimized via Hungarian, to avoid swapping GK
  const gkPlayer = teamPlayers.find(p => p.role === 'GK');
  const otherPlayers = teamPlayers.filter(p => p.role !== 'GK');
  
  const idealPositions = [];
  positions.forEach((pos, i) => {
    // Generate ideal position coordinates
    let rx = pos.x;
    let ry = pos.y;
    let x, y;

    if (isTeamA) {
      x = rx * fw;
      y = fl - ry * half;
    } else {
      x = (1 - rx) * fw;
      y = ry * half;
    }
    
    idealPositions.push({ index: i, role: pos.role, x, y });
  });

  // Keep GK position separate
  const gkIdeal = idealPositions.find(pos => pos.role === 'GK');
  const otherIdeals = idealPositions.filter(pos => pos.role !== 'GK');

  // Apply offensive/defensive shift based on ball position
  // Shift factor: team moves slightly towards ball y position
  const ballYRelative = ball.y / fl; // 0 (top) to 1 (bottom)
  
  // Shift distance: how much team adapts to ball height
  const shiftMultiplier = 12.0; // max shift in meters
  let shiftY = 0;
  if (isTeamA) {
    // Team A moves up if ball is high
    shiftY = (ballYRelative - 0.75) * shiftMultiplier;
  } else {
    // Team B moves down if ball is low
    shiftY = (ballYRelative - 0.25) * shiftMultiplier;
  }

  // Also shift slightly horizontally towards ball
  const shiftX = (ball.x / fw - 0.5) * 5.0;

  const shiftedIdeals = otherIdeals.map(ideal => {
    let px = ideal.x + shiftX;
    let py = ideal.y + shiftY;

    // Constrain to own half + small buffer over midfield
    if (isTeamA) {
      py = Math.max(fl * 0.15, Math.min(fl - 2.0, py));
    } else {
      py = Math.max(2.0, Math.min(fl * 0.85, py));
    }
    px = Math.max(2.0, Math.min(fw - 2.0, px));

    return { ...ideal, x: px, y: py };
  });

  // Construct Cost Matrix for Hungarian Assignment
  const costMatrix = [];
  for (let i = 0; i < otherPlayers.length; i++) {
    const p = otherPlayers[i];
    const row = [];
    for (let j = 0; j < shiftedIdeals.length; j++) {
      const pos = shiftedIdeals[j];
      
      // Basic distance cost
      let dist = Math.hypot(p.x - pos.x, p.y - pos.y);
      
      // Role match bonus/penalty (prefer matching Roles)
      let roleCost = 0;
      if (p.role !== pos.role) {
        roleCost = 15.0; // penalty for role mismatch
      }
      
      row.push(dist + roleCost);
    }
    costMatrix.push(row);
  }

  // Resolve assignment
  const assignments = hungarianAssign(costMatrix);

  // Map assignments back to movements
  const moves = [];
  
  // GK is placed directly
  if (gkPlayer && gkIdeal) {
    moves.push({
      playerId: gkPlayer.id,
      x: gkIdeal.x,
      y: gkIdeal.y
    });
  }

  for (let i = 0; i < otherPlayers.length; i++) {
    const p = otherPlayers[i];
    const idealIdx = assignments[i];
    if (idealIdx !== undefined && idealIdx !== -1 && idealIdx < shiftedIdeals.length) {
      const targetPos = shiftedIdeals[idealIdx];
      moves.push({
        playerId: p.id,
        x: targetPos.x,
        y: targetPos.y
      });
    }
  }

  return moves;
}

/**
 * 5. Individual Player Optimization (Potential Field Method)
 * Pulls towards ball and open spaces (Voronoi boundaries), repels from others.
 */
function optimizePlayer(player, allPlayers, ball, fw, fl) {
  if (player.role === 'GK') {
    // GK stays in front of goal center, tracking ball angle
    const goalX = fw / 2;
    const goalY = player.team === 'A' ? fl - 1.5 : 1.5;
    
    // Project ball to GK line
    const dx = ball.x - goalX;
    const dy = ball.y - goalY;
    const angle = Math.atan2(dy, dx);
    
    // Move up to 4 meters along angle towards ball
    const gkR = 3.0;
    const tx = goalX + Math.cos(angle) * gkR;
    const ty = goalY + Math.sin(angle) * gkR;

    return { x: Math.max(fw * 0.4, Math.min(fw * 0.6, tx)), y: ty };
  }

  // Force vector: fx, fy
  let fx = 0;
  let fy = 0;

  // Force 1: Attract to ball
  const distToBall = Math.hypot(ball.x - player.x, ball.y - player.y);
  if (distToBall > 0.1) {
    // Standard role attraction weight
    let ballWeight = 0.4;
    if (player.role === 'FW') ballWeight = 0.7;
    if (player.role === 'DF') ballWeight = 0.2;

    fx += ((ball.x - player.x) / distToBall) * ballWeight;
    fy += ((ball.y - player.y) / distToBall) * ballWeight;
  }

  // Force 2: Repel from teammates (don't crowd)
  allPlayers.forEach(p => {
    if (p.id === player.id) return;
    const dist = Math.hypot(p.x - player.x, p.y - player.y);
    if (dist < 8.0 && dist > 0.1) {
      const repelWeight = p.team === player.team ? 0.35 : 0.15; // Stronger repel from teammates
      const force = (8.0 - dist) / 8.0;
      fx -= ((p.x - player.x) / dist) * force * repelWeight;
      fy -= ((p.y - player.y) / dist) * force * repelWeight;
    }
  });

  // Force 3: Attract to local space (Voronoi boundary / Open spaces)
  // We probe surrounding points to find the direction of least opponent dominance
  const angles = 8;
  const probeDist = 6.0;
  let bestAngle = 0;
  let maxFreeSpace = -Infinity;

  for (let a = 0; a < angles; a++) {
    const angle = (a / angles) * Math.PI * 2;
    const px = player.x + Math.cos(angle) * probeDist;
    const py = player.y + Math.sin(angle) * probeDist;

    if (px < 0 || px > fw || py < 0 || py > fl) continue;

    // Space score: sum of distances to opponents - sum of distances to teammates
    let score = 0;
    allPlayers.forEach(p => {
      const d = Math.hypot(p.x - px, p.y - py);
      if (p.team === player.team) {
        score -= 5.0 / (d + 0.5); // repel teammates from target points
      } else {
        score += 10.0 / (d + 0.5); // value spacing from opponents
      }
    });

    if (score > maxFreeSpace) {
      maxFreeSpace = score;
      bestAngle = angle;
    }
  }

  fx += Math.cos(bestAngle) * 0.5;
  fy += Math.sin(bestAngle) * 0.5;

  // Force 4: Role positioning area constraints (anchor player to their role half)
  const isTeamA = player.team === 'A';
  let targetY = player.y;

  if (isTeamA) {
    if (player.role === 'DF') targetY = fl * 0.75;
    if (player.role === 'MF') targetY = fl * 0.55;
    if (player.role === 'FW') targetY = fl * 0.35;
  } else {
    if (player.role === 'DF') targetY = fl * 0.25;
    if (player.role === 'MF') targetY = fl * 0.45;
    if (player.role === 'FW') targetY = fl * 0.65;
  }

  fy += (targetY - player.y) * 0.15; // restore to role zone force

  // Step vector scaling
  const stepSize = 4.0; // proposal distance step limit
  const len = Math.hypot(fx, fy);
  let finalX = player.x;
  let finalY = player.y;

  if (len > 0.01) {
    finalX += (fx / len) * stepSize;
    finalY += (fy / len) * stepSize;
  }

  // Constrain coordinates to field dimensions with buffer
  finalX = Math.max(2.0, Math.min(fw - 2.0, finalX));
  finalY = Math.max(2.0, Math.min(fl - 2.0, finalY));

  return { x: finalX, y: finalY };
}
