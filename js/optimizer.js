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

/*
 チームポジション最適化
*/
/**
 * ボール保持チームを判定
 * 最も近いプレイヤーがいるチーム = 保持チーム
 */
function determineBallPossession(players, ball) {
  let closestPlayer = null;
  let minDist = Infinity;

  for (const p of players) {
    const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (dist < minDist) {
      minDist = dist;
      closestPlayer = p;
    }
  }

  return {
    possessionTeam: closestPlayer ? closestPlayer.team : null,
    closestPlayer: closestPlayer,
    distanceToBall: minDist,
  };
}

/**
 * 敵チームのオフサイドライン・DFラインを計算
 */
function analyzeEnemyDefense(players, ball, team) {
  const enemyTeam = team === 'A' ? 'B' : 'A';
  const enemyDFs = players.filter(
    p => p.team === enemyTeam && p.role === 'DF'
  );
  const enemyFWs = players.filter(
    p => p.team === enemyTeam && p.role === 'FW'
  );

  // 敵DF最後尾（チームAなら最小y、チームBなら最大y）
  let dfLine;
  if (team === 'A') {
    dfLine = Math.min(...enemyDFs.map(p => p.y));  // 敵は上側
  } else {
    dfLine = Math.max(...enemyDFs.map(p => p.y));  // 敵は下側
  }

  // オフサイドライン（敵DF最後尾またはボールより遠い方）
  let offsideLine;
  if (team === 'A') {
    offsideLine = Math.min(dfLine - 2, ball.y + 2);  // チームA攻撃方向は下
  } else {
    offsideLine = Math.max(dfLine + 2, ball.y - 2);  // チームB攻撃方向は上
  }

  // 敵FW位置（プレス圧力の高さを示す）
  const enemyPressure = enemyFWs.map(fw => ({
    playerId: fw.id,
    x: fw.x,
    y: fw.y,
    distToBall: Math.hypot(fw.x - ball.x, fw.y - ball.y),
  }));

  return {
    enemyTeam,
    dfLine,
    offsideLine,
    enemyDFs,
    enemyFWs,
    enemyPressure,
  };
}

/**
 * 攻撃側（ボール保持）のコスト計算
 * 
 * 目標:
 * 1. スペース拡大（敵DFとの距離を広げる）
 * 2. 敵FWプレスを回避
 * 3. オフサイド厳守
 */
function calculateAttackingCost(
  player,
  targetPos,
  players,
  ball,
  fw,
  fl,
  team,
  enemyAnalysis
) {
  // 基本: 移動距離 + ロール不一致
  let cost = Math.hypot(player.x - targetPos.x, player.y - targetPos.y);
  let roleCost = player.role !== targetPos.role ? 15.0 : 0;

  // ✅ 1. スペース支配: 敵DFとの距離を最大化（報酬）
  const enemyDFDistances = enemyAnalysis.enemyDFs.map(df =>
    Math.hypot(targetPos.x - df.x, targetPos.y - df.y)
  );
  const minDFDist = Math.min(...enemyDFDistances);
  
  // 敵DFまで5m以上離れていれば報酬（距離が大きいほど良い）
  const spacingReward = Math.max(0, (minDFDist - 5) * 0.5);
  cost -= spacingReward;  // コストから引いて報酬

  // ✅ 2. 敵FWプレス回避
  const enemyFWDistances = enemyAnalysis.enemyFWs.map(fw =>
    Math.hypot(targetPos.x - fw.x, targetPos.y - fw.y)
  );
  const minFWDist = Math.min(...enemyFWDistances);

  if (minFWDist < 4.0) {
    // 敵FWが近い → ペナルティ
    cost += (4.0 - minFWDist) * 3.0;
  }

  // ✅ 3. オフサイド厳守（FWのみ）
  if (player.role === 'FW') {
    const isOffsideDanger = 
      team === 'A' ? targetPos.y < enemyAnalysis.offsideLine :
                     targetPos.y > enemyAnalysis.offsideLine;
    
    if (isOffsideDanger) {
      cost += 100;  // 致命的ペナルティ
    }
  }

  // ✅ 4. Voronoi支配スコア（敵より優位なエリアへ）
  const voronoi = computeVoronoi(players, fw, fl);
  const controlProb = getControlProbAt(targetPos, players, team, fw, fl);
  
  if (controlProb < 0.5) {
    // 敵支配が強いエリア → ペナルティ
    cost += (0.5 - controlProb) * 10;
  }

  // ✅ 5. ボールへの近さ（特にFW・MF）
  const distToBall = Math.hypot(targetPos.x - ball.x, targetPos.y - ball.y);
  if (player.role === 'FW' || player.role === 'MF') {
    // ボールに近いほど報酬
    const ballProximityReward = Math.max(0, (15 - distToBall) * 0.3);
    cost -= ballProximityReward;
  }

  return cost + roleCost;
}

/**
 * 守備側（ボール非保持）のコスト計算
 * 
 * 目標:
 * 1. コンパクトな陣形（DF-MF間距離を最小化）
 * 2. 敵FWへの有効なマーク
 * 3. DFラインの一貫性
 * 4. 敵の危険なスペースをブロック
 */
function calculateDefendingCost(
  player,
  targetPos,
  players,
  ball,
  fw,
  fl,
  team,
  enemyAnalysis
) {
  // 基本: 移動距離 + ロール不一致
  let cost = Math.hypot(player.x - targetPos.x, player.y - targetPos.y);
  let roleCost = player.role !== targetPos.role ? 15.0 : 0;

  // ✅ 1. DFラインのコンパクト性（横幅を詰める）
  if (player.role === 'DF') {
    const otherDFs = players.filter(
      p => p.team === team && p.role === 'DF' && p.id !== player.id
    );
    
    if (otherDFs.length > 0) {
      // DFたちのy座標バリアンスを最小化
      const dfYs = [targetPos.y, ...otherDFs.map(p => p.y)];
      const avgY = dfYs.reduce((a, b) => a + b) / dfYs.length;
      const variance = dfYs.reduce((sum, y) => sum + Math.pow(y - avgY, 2), 0);
      
      // バリアンスが小さいほどコスト削減（ラインがそろっている）
      const lineCompactness = variance / 100;
      cost += lineCompactness;
    }
  }

  // ✅ 2. 敵FWへのマーク（近接ディフェンス）
  const enemyFWs = enemyAnalysis.enemyFWs;
  if (enemyFWs.length > 0 && (player.role === 'DF' || player.role === 'MF')) {
    // 最も近い敵FWまでの距離を最小化
    const distToNearestEnemyFW = Math.min(
      ...enemyFWs.map(fw => Math.hypot(targetPos.x - fw.x, targetPos.y - fw.y))
    );

    if (distToNearestEnemyFW > 5.0) {
      // 敵FWまで遠い → マークが甘い
      cost += (distToNearestEnemyFW - 5.0) * 2.0;
    } else {
      // 敵FWに近い → マークが有効（報酬）
      cost -= (5.0 - distToNearestEnemyFW) * 1.5;
    }
  }

  // ✅ 3. 危険スペース（敵FW背後）のブロック
  const ball_to_goal = team === 'A' ? 0 : fl;  // 守るゴール位置
  const danger_zone_threshold = team === 'A' ? 10 : fl - 10;
  
  if (targetPos.y < danger_zone_threshold && team === 'A') {
    // DFがゴール近く（守備範囲内）
    const isBlockingDangerZone = player.role === 'DF';
    if (isBlockingDangerZone) {
      // ゴール前にいる → 報酬
      cost -= 3.0;
    }
  }

  // ✅ 4. 敵の高い圧力エリアでの混雑回避
  const enemyPressure = Math.max(
    ...enemyAnalysis.enemyPressure.map(p => p.distToBall)
  );
  const maxPressureRadius = 12.0;  // 敵が12m以内に圧力
  
  const distFromPressureZone = Math.hypot(
    targetPos.x - ball.x,
    targetPos.y - ball.y
  );

  if (distFromPressureZone < maxPressureRadius && player.role !== 'GK') {
    // プレス圏内に多くの選手がいるのは危険
    const playersInPressZone = players.filter(
      p => p.team === team &&
           Math.hypot(p.x - ball.x, p.y - ball.y) < maxPressureRadius
    ).length;

    if (playersInPressZone > 4) {
      // 多数がプレス圏内 → スペースが空く
      cost += (playersInPressZone - 3) * 5;
    }
  }

  // ✅ 5. ボール奪取への準備（ボールに適度な近さ）
  const distToBall = Math.hypot(targetPos.x - ball.x, targetPos.y - ball.y);
  if (player.role === 'MF') {
    // MFはボール奪取のため適度に近い（5-10m）が理想
    const idealDist = 7.0;
    const distError = Math.abs(distToBall - idealDist);
    cost += distError * 0.5;
  }

  return cost + roleCost;
}

/**
 * メイン最適化関数
 * ボール保持判定に基づいて戦術を切り替え
 */
function optimizeTeamWithPossession(
  team,
  formation,
  players,
  ball,
  fw,
  fl
) {
  // Step 1: ボール保持判定
  const possession = determineBallPossession(players, ball);
  const isPossession = possession.possessionTeam === team;

  console.log(`Team ${team}: ${isPossession ? '攻撃' : '守備'} フェーズ`);

  // Step 2: 敵分析
  const enemyAnalysis = analyzeEnemyDefense(players, ball, team);

  // Step 3: フォーメーション理想ポジションを生成
  const positions = FORMATIONS[formation];
  const half = fl / 2;
  const isTeamA = team === 'A';

  const idealPositions = [];
  positions.forEach((pos, i) => {
    let x, y;
    if (isTeamA) {
      x = pos.x * fw;
      y = fl - pos.y * half;
    } else {
      x = (1 - pos.x) * fw;
      y = pos.y * half;
    }
    idealPositions.push({ index: i, role: pos.role, x, y });
  });

  // Step 4a: GKは常に固定
  const gkIdeal = idealPositions.find(pos => pos.role === 'GK');
  const gkPlayer = players.find(p => p.team === team && p.role === 'GK');
  const otherIdeals = idealPositions.filter(pos => pos.role !== 'GK');
  const otherPlayers = players.filter(p => p.team === team && p.role !== 'GK');

  // Step 4b: 攻撃 vs 守備で戦術を分ける
  let shiftedIdeals;
  
  if (isPossession) {
    // 攻撃側: スペース拡大、敵DFをかわす方向へシフト
    shiftedIdeals = otherIdeals.map(ideal => {
      // 敵DFラインから距離を取る
      const distFromEnemyDF = isTeamA 
        ? enemyAnalysis.dfLine - ideal.y  // 敵は上側
        : ideal.y - enemyAnalysis.dfLine;  // 敵は下側

      let shiftY = 0;
      if (distFromEnemyDF < 8.0) {
        // 敵DFが近い → さらに離れる方向へシフト
        shiftY = isTeamA ? 3.0 : -3.0;
      }

      // ボール方向へのシフト（ボールに近い方へ）
      const ballYRelative = ball.y / fl;
      const shiftTowardBall = (ballYRelative - 0.5) * 5.0;

      let finalY = ideal.y + shiftY + shiftTowardBall;
      finalY = Math.max(2.0, Math.min(fl - 2.0, finalY));

      return { ...ideal, y: finalY };
    });
  } else {
    // 守備側: コンパクト、敵FWを封鎖する方向へシフト
    shiftedIdeals = otherIdeals.map(ideal => {
      // 敵FWへの近接
      const nearestEnemyFW = enemyAnalysis.enemyFWs.reduce((closest, fw) => {
        const dist = Math.hypot(ideal.x - fw.x, ideal.y - fw.y);
        return dist < Math.hypot(ideal.x - closest.x, ideal.y - closest.y) 
          ? fw : closest;
      }, enemyAnalysis.enemyFWs[0]);

      if (nearestEnemyFW) {
        // 敵FWに対して前に出る（マークを取る）
        const closeDistance = 6.0;
        const currentDist = Math.hypot(ideal.x - nearestEnemyFW.x, ideal.y - nearestEnemyFW.y);
        
        if (currentDist > closeDistance) {
          // 敵FWに近い方へシフト
          const shiftRatio = (closeDistance - 2.0) / currentDist;
          const shiftX = (nearestEnemyFW.x - ideal.x) * shiftRatio * 0.5;
          const shiftY = (nearestEnemyFW.y - ideal.y) * shiftRatio * 0.5;
          
          ideal.x += shiftX;
          ideal.y += shiftY;
        }
      }

      ideal.y = Math.max(2.0, Math.min(fl - 2.0, ideal.y));
      ideal.x = Math.max(2.0, Math.min(fw - 2.0, ideal.x));
      
      return ideal;
    });
  }

  // Step 5: コスト行列構築（攻撃 vs 守備で関数を変える）
  const costMatrix = [];
  
  for (let i = 0; i < otherPlayers.length; i++) {
    const p = otherPlayers[i];
    const row = [];

    for (let j = 0; j < shiftedIdeals.length; j++) {
      const ideal = shiftedIdeals[j];
      
      let cost;
      if (isPossession) {
        cost = calculateAttackingCost(
          p, ideal, players, ball, fw, fl, team, enemyAnalysis
        );
      } else {
        cost = calculateDefendingCost(
          p, ideal, players, ball, fw, fl, team, enemyAnalysis
        );
      }
      
      row.push(cost);
    }
    costMatrix.push(row);
  }

  // Step 6: ハンガリアン法で最適割り当て
  const assignments = hungarianAssign(costMatrix);

  // Step 7: 結果を構築
  const moves = [];

  if (gkPlayer && gkIdeal) {
    moves.push({
      playerId: gkPlayer.id,
      x: gkIdeal.x,
      y: gkIdeal.y,
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
        y: targetPos.y,
      });
    }
  }

  return {
    moves,
    isPossession,
    possession,
    enemyAnalysis,
    tactics: isPossession ? '攻撃' : '守備',
  };
}


/*********************************************************************** */

/**
 * ボール保持判定（修正版）
 */
function determineBallPossession(players, ball) {
  let closestPlayer = null;
  let minDist = Infinity;

  for (const p of players) {
    const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (dist < minDist) {
      minDist = dist;
      closestPlayer = p;
    }
  }

  return {
    possessionTeam: closestPlayer ? closestPlayer.team : 'A',
    closestPlayer: closestPlayer,
    distanceToBall: minDist,
  };
}

/**
 * 敵チーム分析（簡潔版）
 */
function analyzeEnemyDefense(players, team) {
  const enemyTeam = team === 'A' ? 'B' : 'A';
  const enemyPlayers = players.filter(p => p.team === enemyTeam);
  
  const enemyDFs = enemyPlayers.filter(p => p.role === 'DF');
  const enemyFWs = enemyPlayers.filter(p => p.role === 'FW');

  // 敵DF最後尾
  let dfLineY;
  if (team === 'A') {
    // 敵(Team B)の最前DF
    dfLineY = Math.min(...enemyDFs.map(p => p.y));
  } else {
    // 敵(Team A)の最前DF
    dfLineY = Math.max(...enemyDFs.map(p => p.y));
  }

  return {
    enemyDFs,
    enemyFWs,
    dfLineY,
  };
}

/**
 * 攻撃側コスト（攻撃的な配置を推奨）
 * 
 * 目標:
 * - 敵DFを抜く（前に出る）
 * - スペースを活用
 * - 敵FWプレス回避
 */
function calculateAttackingCost(player, targetPos, players, ball, team, enemyDF) {
  let cost = 0;

  // ← 基本: 移動距離
  const moveDist = Math.hypot(player.x - targetPos.x, player.y - targetPos.y);
  cost += moveDist;

  // ← ロール一致度
  if (player.role !== targetPos.role) {
    cost += 10.0;
  }

  // ← FW: 敵DFを抜いている（前に出ている）ことを報酬
  if (player.role === 'FW') {
    const isAhead = 
      team === 'A' ? targetPos.y < enemyDF.dfLineY - 2 :
                     targetPos.y > enemyDF.dfLineY + 2;
    
    if (isAhead) {
      cost -= 5.0;  // 敵DF越しは良い（負のコストで報酬）
    } else {
      cost += 5.0;  // 敵DFより後ろは悪い
    }
  }

  // ← ボールに近い（FW・MFが優先）
  const distToBall = Math.hypot(targetPos.x - ball.x, targetPos.y - ball.y);
  if (player.role === 'FW' || player.role === 'MF') {
    cost += distToBall * 0.1;  // ボール近いほど低コスト
  }

  // ← 敵FWプレス回避
  const nearestEnemyFW = enemyDF.enemyFWs.length > 0
    ? Math.min(...enemyDF.enemyFWs.map(fw => 
        Math.hypot(targetPos.x - fw.x, targetPos.y - fw.y)
      ))
    : 100;
  
  if (nearestEnemyFW < 4.0) {
    cost += (4.0 - nearestEnemyFW) * 2.0;  // 敵FW近すぎは悪い
  }

  return cost;
}

/**
 * 守備側コスト（守備的な配置を推奨）
 * 
 * 目標:
 * - DFラインをそろえる（コンパクト）
 * - 敵FWをマークする
 * - ゴール前を守る
 */
function calculateDefendingCost(player, targetPos, players, ball, team, enemyDF) {
  let cost = 0;

  // ← 基本: 移動距離
  const moveDist = Math.hypot(player.x - targetPos.x, player.y - targetPos.y);
  cost += moveDist;

  // ← ロール一致度
  if (player.role !== targetPos.role) {
    cost += 10.0;
  }

  // ← DF: ラインをそろえる（y座標を揃える）
  if (player.role === 'DF') {
    const otherDFs = players.filter(
      p => p.team === team && p.role === 'DF' && p.id !== player.id
    );

    for (const df of otherDFs) {
      const yDiff = Math.abs(targetPos.y - df.y);
      if (yDiff > 3.0) {
        // DFラインがズレている
        cost += yDiff * 0.5;
      }
    }
  }

  // ← 敵FWへのマーク（DF・MFが近い）
  if (player.role === 'DF' || player.role === 'MF') {
    const nearestEnemyFW = enemyDF.enemyFWs.length > 0
      ? Math.min(...enemyDF.enemyFWs.map(fw =>
          Math.hypot(targetPos.x - fw.x, targetPos.y - fw.y)
        ))
      : 100;

    if (nearestEnemyFW < 6.0) {
      // 敵FWが近い → マーク取得
      cost -= (6.0 - nearestEnemyFW) * 1.0;  // 報酬
    } else {
      // 敵FWが遠い → マーク失敗
      cost += (nearestEnemyFW - 6.0) * 0.5;
    }
  }

  // ← ゴール前を守る（最後尾のDF）
  if (player.role === 'DF') {
    const goalY = team === 'A' ? 0 : 68;  // ゴール位置
    const distToGoal = Math.abs(targetPos.y - goalY);
    const idealDist = 12.0;
    
    cost += Math.abs(distToGoal - idealDist) * 0.3;
  }

  return cost;
}


/**　***********************************************************
 * 動的理想ポジション生成（フォーメーションに縛られず状況適応）
 */
function generateDynamicIdeals(team, players, ball, fw, fl, isPossession) {
  const teamPlayers = players.filter(p => p.team === team && p.role !== 'GK');
  const numDF = teamPlayers.filter(p => p.role === 'DF').length || 4;
  const numMF = teamPlayers.filter(p => p.role === 'MF').length || 3;
  const numFW = teamPlayers.filter(p => p.role === 'FW').length || 3;

  const isTeamA = team === 'A';
  const ideals = [];
  const enemyAnalysis = analyzeEnemyDefense(players, team);

  // 基本的なゾーン分割（攻撃/守備で重心をずらす）
  let baseYShift = 0;
  if (isPossession) {
    baseYShift = isTeamA ? -8 : 8; // 攻撃時は前へ
  } else {
    baseYShift = isTeamA ? 5 : -5;  // 守備時はコンパクトに
  }

  const ballInfluence = (ball.y / fl - 0.5) * 15; // ボールに大きく引っ張られる

  // DFゾーン（後方）
  for (let i = 0; i < numDF; i++) {
    const x = fw * (0.2 + (i / Math.max(1, numDF - 1)) * 0.6);
    let y = isTeamA 
      ? fl * 0.75 + baseYShift + ballInfluence * 0.3
      : fl * 0.25 + baseYShift + ballInfluence * 0.3;
    y = Math.max(fl * 0.1, Math.min(fl * 0.9, y));
    ideals.push({ role: 'DF', x, y });
  }

  // MFゾーン（中央・流動的）
  for (let i = 0; i < numMF; i++) {
    const x = fw * (0.15 + (i / Math.max(1, numMF - 1)) * 0.7);
    let y = isTeamA 
      ? fl * 0.5 + baseYShift * 1.2 + ballInfluence * 0.6
      : fl * 0.5 + baseYShift * 1.2 + ballInfluence * 0.6;
    y = Math.max(fl * 0.25, Math.min(fl * 0.75, y));
    ideals.push({ role: 'MF', x, y });
  }

  // FWゾーン（前方・敵DFを意識）
  for (let i = 0; i < numFW; i++) {
    const x = fw * (0.2 + (i / Math.max(1, numFW - 1)) * 0.6);
    let y;
    if (isPossession) {
      // 攻撃時は敵DFラインを越える
      y = isTeamA 
        ? Math.min(enemyAnalysis.dfLineY - 5, ball.y - 8)
        : Math.max(enemyAnalysis.dfLineY + 5, ball.y + 8);
    } else {
      y = isTeamA ? fl * 0.45 : fl * 0.55;
    }
    y = Math.max(5, Math.min(fl - 5, y));
    ideals.push({ role: 'FW', x, y });
  }

  // ランダム微調整 + オープンスペース補正（多様性を持たせる）
  ideals.forEach((pos, i) => {
    const probe = getBestOpenSpace(pos.x, pos.y, players, fw, fl, team);
    pos.x = (pos.x * 0.7 + probe.x * 0.3);
    pos.y = (pos.y * 0.7 + probe.y * 0.3);
  });

  return ideals;
}

/** オープンスペース探索（簡易版） */
function getBestOpenSpace(cx, cy, players, fw, fl, team) {
  let bestScore = -Infinity;
  let best = {x: cx, y: cy};
  const angles = 12;
  const dist = 10;

  for (let a = 0; a < angles; a++) {
    const angle = (a / angles) * Math.PI * 2;
    const tx = cx + Math.cos(angle) * dist;
    const ty = cy + Math.sin(angle) * dist;
    if (tx < 2 || tx > fw-2 || ty < 2 || ty > fl-2) continue;

    let score = 0;
    players.forEach(p => {
      const d = Math.hypot(p.x - tx, p.y - ty);
      if (p.team === team) score -= 8 / (d + 1);
      else score += 15 / (d + 1);
    });
    if (score > bestScore) {
      bestScore = score;
      best = {x: tx, y: ty};
    }
  }
  return best;
}

/**
 * 新しいメイン最適化関数（フォーメーション非依存・状況適応型）
 */
function optimizeTeamWithPossession(team, formation, players, ball, fw, fl) {
  console.log(`\n=== 動的最適化開始: Team ${team} ===`);

  const possession = determineBallPossession(players, ball);
  const isPossession = possession.possessionTeam === team;

  // 動的理想ポジション生成（ここが最大の変更点）
  const dynamicIdeals = generateDynamicIdeals(team, players, ball, fw, fl, isPossession);

  const gkPlayer = players.find(p => p.team === team && p.role === 'GK');
  const otherPlayers = players.filter(p => p.team === team && p.role !== 'GK');

  // GKは従来通り
  const moves = [];
  if (gkPlayer) {
    const gkTarget = optimizePlayer(gkPlayer, players, ball, fw, fl); // 個別最適化も活用
    moves.push({ playerId: gkPlayer.id, x: gkTarget.x, y: gkTarget.y });
  }

  // コスト行列構築（役割ペナルティを大幅緩和）
  const costMatrix = [];
  for (let i = 0; i < otherPlayers.length; i++) {
    const p = otherPlayers[i];
    const row = [];
    for (let j = 0; j < dynamicIdeals.length; j++) {
      const target = dynamicIdeals[j];
      let cost = Math.hypot(p.x - target.x, p.y - target.y);

      // 役割ペナルティを弱く（状況適応を優先）
      const rolePenalty = (p.role !== target.role) ? 4.0 : 0;
      cost += rolePenalty;

      // 追加評価（ピッチコントロール・敵配置）
      const control = getControlProbAt(target, players, team, fw, fl);
      cost -= control * 12; // 支配率が高い場所を強く優先

      if (isPossession) {
        const distToBall = Math.hypot(target.x - ball.x, target.y - ball.y);
        cost += distToBall * 0.08; // 攻撃時はボール近くを好む
      }

      row.push(cost);
    }
    costMatrix.push(row);
  }

  const assignments = hungarianAssign(costMatrix);

  // 割り当て + 最終微調整
  for (let i = 0; i < otherPlayers.length; i++) {
    const p = otherPlayers[i];
    const idx = assignments[i];
    if (idx !== undefined && idx !== -1) {
      let target = { ...dynamicIdeals[idx] };
      // 個別ポテンシャル場で最終調整
      const refined = optimizePlayer(p, players, ball, fw, fl);
      target.x = target.x * 0.6 + refined.x * 0.4;
      target.y = target.y * 0.6 + refined.y * 0.4;

      moves.push({ playerId: p.id, x: target.x, y: target.y });
    }
  }

  return {
    moves,
    isPossession,
    dynamicIdeals, // デバッグ用
    tactics: isPossession ? '攻撃（動的）' : '守備（動的）'
  };
}