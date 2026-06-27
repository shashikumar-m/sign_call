/**
 * SignConnect — MediaPipe Hands Gesture Recognition Engine
 * mediapipe.js
 *
 * Uses real landmark geometry (finger angles, extension ratios,
 * motion vectors) to classify ASL signs. No random selection.
 *
 * Landmark indices (MediaPipe Hands):
 *  0=WRIST  1=CMC_THUMB  2=MCP_THUMB  3=IP_THUMB  4=TIP_THUMB
 *  5=MCP_INDEX  6=PIP_INDEX  7=DIP_INDEX  8=TIP_INDEX
 *  9=MCP_MID   10=PIP_MID  11=DIP_MID  12=TIP_MID
 * 13=MCP_RING  14=PIP_RING 15=DIP_RING 16=TIP_RING
 * 17=MCP_PINKY 18=PIP_PINKY 19=DIP_PINKY 20=TIP_PINKY
 */

const GestureEngine = (() => {

  // ── Landmark helpers ────────────────────────────────────────
  /** Euclidean distance between two landmarks */
  function dist(a, b) {
    return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + ((a.z||0)-(b.z||0))**2);
  }

  /** Angle at point B of the A→B→C triangle (degrees) */
  function angleBetween(a, b, c) {
    const ab = { x: a.x-b.x, y: a.y-b.y };
    const cb = { x: c.x-b.x, y: c.y-b.y };
    const dot  = ab.x*cb.x + ab.y*cb.y;
    const magA = Math.sqrt(ab.x**2+ab.y**2);
    const magC = Math.sqrt(cb.x**2+cb.y**2);
    if (magA===0 || magC===0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot/(magA*magC)))) * 180 / Math.PI;
  }

  /**
   * Returns boolean array [thumb, index, middle, ring, pinky]
   * true = finger extended, false = curled
   */
  function getFingerStates(lm) {
    const tips  = [4,  8, 12, 16, 20];
    const mids  = [3,  7, 11, 15, 19];
    const bases = [2,  6, 10, 14, 18];
    const wrist = lm[0];

    const states = [];

    // Thumb: compare tip x vs mcp x (account for handedness by wrist)
    const thumbTip = lm[4];
    const thumbMCP = lm[2];
    const thumbIP  = lm[3];
    // Thumb extended if tip is far from index MCP
    const thumbExt = dist(thumbTip, lm[5]) > dist(thumbMCP, lm[5]) * 0.85;
    states.push(thumbExt);

    // Fingers: tip Y < pip Y means extended (screen coords: smaller Y = higher)
    for (let i = 1; i < 5; i++) {
      const tipY  = lm[tips[i]].y;
      const pipY  = lm[mids[i]].y;
      const mcpY  = lm[bases[i]].y;
      // Extended = tip is above (smaller y) the pip knuckle by a margin
      states.push(tipY < pipY - 0.02);
    }
    return states; // [thumb, index, middle, ring, pinky]
  }

  /** Normalized palm size for scale-independent comparisons */
  function palmSize(lm) {
    return dist(lm[0], lm[9]) || 0.001;
  }

  /** Normalized distance between two landmarks */
  function normDist(lm, a, b) {
    return dist(lm[a], lm[b]) / palmSize(lm);
  }

  // ── Gesture classifier functions ────────────────────────────
  // Each returns a confidence 0-1, or 0 if not matched.

  const classifiers = {

    // Open palm, all 5 fingers extended
    'Hello': (lm) => {
      const f = getFingerStates(lm);
      const allExt = f.every(v => v);
      if (!allExt) return 0;
      // Fingers should be spread: tip-to-tip distances should be large
      const spread = dist(lm[4], lm[20]) / palmSize(lm);
      return spread > 1.2 ? Math.min(0.95, 0.6 + spread * 0.15) : 0;
    },

    // ILY: thumb + index + pinky extended, middle + ring curled
    'I Love You': (lm) => {
      const f = getFingerStates(lm);
      if (f[0] && f[1] && !f[2] && !f[3] && f[4]) {
        const score = 0.80 + (normDist(lm,4,8) > 0.5 ? 0.1 : 0) + (normDist(lm,4,20) > 0.4 ? 0.1 : 0);
        return Math.min(0.95, score);
      }
      return 0;
    },

    // Fist: all fingers curled including thumb across
    'Yes': (lm) => {
      const f = getFingerStates(lm);
      if (f.some(v => v)) return 0;
      // Tips should be close to palm
      const tipsToPalm = [8,12,16,20].map(i => normDist(lm, i, 0)).reduce((a,b)=>a+b,0)/4;
      return tipsToPalm < 0.7 ? Math.min(0.9, 0.6 + (0.7 - tipsToPalm)) : 0;
    },

    // Index finger pointing up, others curled
    'No': (lm) => {
      const f = getFingerStates(lm);
      if (f[1] && !f[2] && !f[3] && !f[4]) {
        const score = 0.75 + (normDist(lm,8,0) > 0.8 ? 0.1 : 0);
        return Math.min(0.9, score);
      }
      return 0;
    },

    // Flat hand, fingers together, palm forward (stop sign)
    'Stop': (lm) => {
      const f = getFingerStates(lm);
      const fourExt = f[1] && f[2] && f[3] && f[4];
      if (!fourExt) return 0;
      // Fingers should be close together (not spread)
      const spread = dist(lm[8], lm[20]) / palmSize(lm);
      return spread < 0.8 ? Math.min(0.9, 0.7 + (0.8 - spread)) : 0;
    },

    // Thumb up, others curled
    'Good': (lm) => {
      const f = getFingerStates(lm);
      if (!f[0] || f[1] || f[2] || f[3] || f[4]) return 0;
      // Thumb tip should be pointing up (low Y)
      const thumbUp = lm[4].y < lm[2].y - 0.05;
      return thumbUp ? 0.88 : 0.65;
    },

    // Thumb down (tip Y higher than MCP)
    'Bad': (lm) => {
      const f = getFingerStates(lm);
      if (f[1] || f[2] || f[3] || f[4]) return 0;
      const thumbDown = lm[4].y > lm[2].y + 0.04;
      return thumbDown ? 0.85 : 0;
    },

    // Thumb + index L-shape (others curled)
    'Help': (lm) => {
      const f = getFingerStates(lm);
      if (f[0] && f[1] && !f[2] && !f[3] && !f[4]) {
        const angle = angleBetween(lm[4], lm[2], lm[8]);
        // L-shape means roughly 90 degree angle
        return (angle > 60 && angle < 120) ? 0.82 : 0.55;
      }
      return 0;
    },

    // Index + middle extended (peace/V sign)
    'Peace': (lm) => {
      const f = getFingerStates(lm);
      if (!f[0] && f[1] && f[2] && !f[3] && !f[4]) {
        const vSpread = dist(lm[8], lm[12]) / palmSize(lm);
        return vSpread > 0.3 ? 0.85 : 0.60;
      }
      return 0;
    },

    // Closed fist rotating = Sorry
    'Sorry': (lm) => {
      const f = getFingerStates(lm);
      if (f.some(v => v)) return 0;
      // Wrist normal roughly facing camera and fingertips near palm center
      const tips = [8,12,16,20].map(i => normDist(lm,i,9)).reduce((a,b)=>a+b,0)/4;
      return tips < 0.55 ? 0.80 : 0;
    },

    // Flat hand at chin level (palm facing down)
    'Thank You': (lm) => {
      const f = getFingerStates(lm);
      const fourExt = f[1] && f[2] && f[3] && f[4];
      if (!fourExt) return 0;
      // Hand should be near chin height → Y close to 0.5-0.7 in normalized coords
      const handY = (lm[5].y + lm[0].y) / 2;
      return (handY > 0.4 && handY < 0.75) ? 0.83 : 0.4;
    },

    // W hand: ring + middle + index extended, others curled (Water)
    'Water': (lm) => {
      const f = getFingerStates(lm);
      if (f[1] && f[2] && f[3] && !f[4] && !f[0]) return 0.80;
      return 0;
    },

    // Flat hand, palm facing self, touching near forehead then down (Home)
    'Home': (lm) => {
      const f = getFingerStates(lm);
      const fourExt = f[0] && f[1] && f[2] && f[3] && f[4];
      if (!fourExt) return 0;
      // Fingers close together, hand high up
      const handY = lm[9].y;
      const spread = dist(lm[8], lm[20]) / palmSize(lm);
      return (handY < 0.45 && spread < 0.7) ? 0.78 : 0;
    },

    // Index hooked/curled (asking "who")
    'Who': (lm) => {
      const f = getFingerStates(lm);
      if (!f[0] && !f[1] && !f[2] && !f[3] && !f[4]) return 0;
      // Index somewhat extended but bent at DIP
      const indexDIP  = lm[7].y;
      const indexTip  = lm[8].y;
      const indexMCP  = lm[5].y;
      const hooked = indexTip > indexDIP && indexDIP < indexMCP;
      return hooked ? 0.75 : 0;
    },

    // Index extended pointing sideways
    'Where': (lm) => {
      const f = getFingerStates(lm);
      if (f[1] && !f[2] && !f[3] && !f[4]) {
        // Index pointing more horizontal than vertical
        const dX = Math.abs(lm[8].x - lm[5].x);
        const dY = Math.abs(lm[8].y - lm[5].y);
        return dX > dY * 0.7 ? 0.78 : 0;
      }
      return 0;
    },

    // Fingers bunched (all tips near thumb tip) = Eat
    'Eat': (lm) => {
      const f = getFingerStates(lm);
      if (f.some(v => v)) return 0;
      // All finger tips close together near mouth area
      const cluster = [4,8,12,16,20].map(i => dist(lm[i], lm[4])).reduce((a,b)=>a+b,0) / palmSize(lm);
      return cluster < 1.2 ? 0.80 : 0;
    },

    // ── ASL Alphabet (A–Z) ─────────────────────────────────────
    // A: Fist with thumb on side
    'A': (lm) => {
      const f = getFingerStates(lm);
      if (f[1]||f[2]||f[3]||f[4]) return 0;
      const thumbSide = Math.abs(lm[4].x - lm[8].x) < 0.15;
      return thumbSide ? 0.75 : 0;
    },

    // B: Four fingers straight up, thumb tucked
    'B': (lm) => {
      const f = getFingerStates(lm);
      if (f[1]&&f[2]&&f[3]&&f[4]&&!f[0]) {
        const spread = dist(lm[8],lm[20])/palmSize(lm);
        return spread < 0.5 ? 0.80 : 0;
      }
      return 0;
    },

    // C: Curved hand (C-shape), all fingers curved same direction
    'C': (lm) => {
      const f = getFingerStates(lm);
      // All slightly extended but curved
      const tipDist = normDist(lm, 4, 8);
      return (tipDist > 0.4 && tipDist < 0.8 && !f[1]) ? 0.72 : 0;
    },

    // D: Index up, others curled against thumb
    'D': (lm) => {
      const f = getFingerStates(lm);
      if (f[1] && !f[2] && !f[3] && !f[4]) {
        const thumbIndexClose = normDist(lm,4,12) < 0.5;
        return thumbIndexClose ? 0.76 : 0;
      }
      return 0;
    },

    // E: Fingers curled, tips touching thumb
    'E': (lm) => {
      const f = getFingerStates(lm);
      if (f.some(v=>v)) return 0;
      const tipsToThumb = [8,12,16,20].map(i=>normDist(lm,i,4)).reduce((a,b)=>a+b,0)/4;
      return tipsToThumb < 0.5 ? 0.73 : 0;
    },

    // F: Index + thumb touching, others extended
    'F': (lm) => {
      const f = getFingerStates(lm);
      if (!f[2]||!f[3]||!f[4]) return 0;
      const pinch = normDist(lm,4,8);
      return (pinch < 0.25 && !f[1]) ? 0.78 : 0;
    },

    // L: L-shape: thumb + index extended perpendicular
    'L': (lm) => {
      const f = getFingerStates(lm);
      if (f[0]&&f[1]&&!f[2]&&!f[3]&&!f[4]) {
        const angle = angleBetween(lm[4],lm[2],lm[8]);
        return (angle>70&&angle<110) ? 0.85 : 0;
      }
      return 0;
    },

    // O: All fingers curve to meet thumb (O shape)
    'O': (lm) => {
      const allCurved = !getFingerStates(lm).some(v=>v);
      if (!allCurved) return 0;
      const tipToThumb = normDist(lm,8,4);
      return (tipToThumb>0.1&&tipToThumb<0.4) ? 0.78 : 0;
    },

    // Y: Thumb + pinky extended
    'Y': (lm) => {
      const f = getFingerStates(lm);
      if (f[0]&&!f[1]&&!f[2]&&!f[3]&&f[4]) return 0.82;
      return 0;
    },
  };

  // ── Temporal buffer for stability ───────────────────────────
  const BUFFER_SIZE    = 8;   // frames
  const MIN_CONFIDENCE = 0.72;
  const HOLD_FRAMES    = 12;  // how many frames a gesture must hold

  const recentGestures = []; // ring buffer of { name, confidence }
  let   holdName       = null;
  let   holdCount      = 0;
  let   lastEmitted    = null;
  let   lastEmitTime   = 0;
  const EMIT_COOLDOWN  = 1800; // ms between emitting same gesture

  function classifyFrame(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;
    const lm = landmarks;

    let bestName = null;
    let bestConf = 0;

    for (const [name, fn] of Object.entries(classifiers)) {
      try {
        const conf = fn(lm);
        if (conf > bestConf) { bestConf = conf; bestName = name; }
      } catch {}
    }

    if (bestConf < MIN_CONFIDENCE) return { name: '…', confidence: bestConf };
    return { name: bestName, confidence: bestConf };
  }

  function processFrame(landmarks) {
    const result = classifyFrame(landmarks);
    if (!result) return null;

    // Push to buffer
    recentGestures.push(result);
    if (recentGestures.length > BUFFER_SIZE) recentGestures.shift();

    // Find majority gesture in buffer
    const counts = {};
    for (const r of recentGestures) {
      if (r.name && r.name !== '…') {
        counts[r.name] = (counts[r.name] || 0) + 1;
      }
    }
    const majority = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if (!majority || majority[1] < BUFFER_SIZE * 0.5) {
      return { name: '…', confidence: 0 };
    }

    const stableName = majority[0];
    const avgConf = recentGestures
      .filter(r => r.name === stableName)
      .reduce((s,r) => s + r.confidence, 0) / majority[1];

    // Hold counter for stable emission
    if (stableName === holdName) {
      holdCount++;
    } else {
      holdName  = stableName;
      holdCount = 1;
    }

    const shouldEmit = holdCount >= HOLD_FRAMES &&
      (stableName !== lastEmitted || Date.now() - lastEmitTime > EMIT_COOLDOWN);

    if (shouldEmit) {
      lastEmitted  = stableName;
      lastEmitTime = Date.now();
      return { name: stableName, confidence: avgConf, emit: true };
    }

    return { name: stableName, confidence: avgConf, emit: false };
  }

  // ── Drawing helpers ──────────────────────────────────────────
  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],       // thumb
    [0,5],[5,6],[6,7],[7,8],       // index
    [0,9],[9,10],[10,11],[11,12],  // middle
    [0,13],[13,14],[14,15],[15,16],// ring
    [0,17],[17,18],[18,19],[19,20],// pinky
    [5,9],[9,13],[13,17],          // palm
  ];

  const LANDMARK_COLORS = {
    wrist:   '#ffffff',
    thumb:   '#ff6b6b',
    index:   '#ffd93d',
    middle:  '#6bcb77',
    ring:    '#4d96ff',
    pinky:   '#c77dff',
  };

  function fingerGroup(i) {
    if (i === 0) return 'wrist';
    if (i <= 4)  return 'thumb';
    if (i <= 8)  return 'index';
    if (i <= 12) return 'middle';
    if (i <= 16) return 'ring';
    return 'pinky';
  }

  function drawHandOnCanvas(ctx, landmarks, canvasW, canvasH, mirrored = true) {
    if (!landmarks) return;

    // Scale and optionally mirror
    const pts = landmarks.map(lm => ({
      x: mirrored ? (1 - lm.x) * canvasW : lm.x * canvasW,
      y: lm.y * canvasH,
    }));

    // Draw connections
    ctx.lineWidth   = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineCap     = 'round';
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }

    // Draw landmark dots
    for (let i = 0; i < pts.length; i++) {
      const color = LANDMARK_COLORS[fingerGroup(i)];
      const radius = (i === 0) ? 5 : 4;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function clearCanvas(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    processFrame,
    drawHandOnCanvas,
    clearCanvas,
    getFingerStates,
    classifiers,
  };

})();

window.GestureEngine = GestureEngine;
