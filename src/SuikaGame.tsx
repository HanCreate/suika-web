import React, { useEffect, useMemo, useRef, useState } from "react";
import Matter, { Bodies, Body, Composite, Engine, Events, World } from "matter-js";

/**
 * Suika (Watermelon) Game – Browser-ready starter
 * ------------------------------------------------
 * - React single-file component using Matter.js physics
 * - Mouse/touch move = aim horizontally; click/tap = drop fruit
 * - Same-type fruits merge into next tier when they collide slowly enough
 * - Next fruit preview + queue
 * - Skins (unlockable) via localStorage (simple demo logic)
 * - Local leaderboard fallback (localStorage) + Supabase-ready hooks (optional)
 * - Responsive canvas; works on desktop & mobile
 * - Clean, minimal UI with Tailwind classes (no external CSS required)
 *
 * Notes:
 * - Replace placeholder circle drawing with sprite rendering if you provide PNGs.
 * - To enable online leaderboard, set SUPABASE_URL & SUPABASE_ANON_KEY in your app
 *   and implement fetchTopScores/postScore in the Supabase section below.
 */

// -----------------------------
// Types & Constants
// -----------------------------

type FruitKind =
  | "cherry" | "strawberry" | "grape" | "orange" | "apple"
  | "pear" | "peach" | "pineapple" | "melon" | "watermelon";

type FruitDef = {
  kind: FruitKind;
  radius: number; // physics radius (px at 1x scale)
  score: number;  // score when created by merge
};

const FRUITS: FruitDef[] = [
  { kind: "cherry", radius: 14, score: 1 },
  { kind: "strawberry", radius: 18, score: 3 },
  { kind: "grape", radius: 22, score: 6 },
  { kind: "orange", radius: 28, score: 10 },
  { kind: "apple", radius: 34, score: 16 },
  { kind: "pear", radius: 42, score: 24 },
  { kind: "peach", radius: 52, score: 36 },
  { kind: "pineapple", radius: 64, score: 50 },
  { kind: "melon", radius: 78, score: 80 },
  { kind: "watermelon", radius: 96, score: 130 },
];

const KIND_INDEX: Record<FruitKind, number> = Object.fromEntries(
  FRUITS.map((f, i) => [f.kind, i])
) as any;

const MERGE_VELOCITY_THRESHOLD = 3.2; // must collide reasonably slow to merge
const DROP_COOLDOWN_MS = 350;          // prevent rapid drops
const TOP_SENSOR_THICKNESS = 8;

// Skin system (very simple)
// Each skin can override color per fruit.
// Locked skins are unlocked via score milestones (demo logic).

type Skin = {
  id: string;
  name: string;
  unlockedAtScore?: number; // unlock permanently if best score >= this
  colors: Partial<Record<FruitKind, string>>; // fallback to default if not set
  bg?: string; // background CSS
};

const DEFAULT_COLORS: Record<FruitKind, string> = {
  cherry: "#ff4b5c",
  strawberry: "#f55172",
  grape: "#8f5bcc",
  orange: "#ff9f1c",
  apple: "#4caf50",
  pear: "#9ccc65",
  peach: "#ffb6a1",
  pineapple: "#ffa000",
  melon: "#6ecb63",
  watermelon: "#1db954",
};

const SKINS: Skin[] = [
  { id: "classic", name: "Classic", colors: {}, bg: "linear-gradient(#f8fafc,#e2e8f0)" },
  { id: "neon", name: "Neon", unlockedAtScore: 500, colors: {
      cherry: "#ff1e56", strawberry: "#ffac41", grape: "#7a04eb", orange: "#f8f32b",
      apple: "#08f7fe", pear: "#09fbd3", peach: "#f72585", pineapple: "#fee440",
      melon: "#b5179e", watermelon: "#06d6a0",
    }, bg: "radial-gradient(circle,#0f172a,#020617)" },
  { id: "mono", name: "Monochrome", unlockedAtScore: 900, colors: {
      cherry: "#111827", strawberry: "#1f2937", grape: "#374151", orange: "#4b5563",
      apple: "#6b7280", pear: "#9ca3af", peach: "#d1d5db", pineapple: "#e5e7eb",
      melon: "#f3f4f6", watermelon: "#111827",
    }, bg: "linear-gradient(#fff,#e5e7eb)" },
];

// -----------------------------
// Local Storage Helpers
// -----------------------------

const LS = {
  BEST: "suika.bestScore",
  SKIN: "suika.currentSkin",
  LEADER: "suika.leaderboard.v1",
};

function getBestScore(): number { return Number(localStorage.getItem(LS.BEST) || 0); }
function setBestScore(v: number) { localStorage.setItem(LS.BEST, String(v)); }
function getSkinId(): string { return localStorage.getItem(LS.SKIN) || "classic"; }
function setSkinId(id: string) { localStorage.setItem(LS.SKIN, id); }

// Local fallback leaderboard (top 20)
function addLocalScore(name: string, score: number) {
  const raw = localStorage.getItem(LS.LEADER);
  const arr: { name: string; score: number; ts: number }[] = raw ? JSON.parse(raw) : [];
  arr.push({ name, score, ts: Date.now() });
  arr.sort((a, b) => b.score - a.score || a.ts - b.ts);
  localStorage.setItem(LS.LEADER, JSON.stringify(arr.slice(0, 20)));
}
function getLocalTop() {
  const raw = localStorage.getItem(LS.LEADER);
  return (raw ? JSON.parse(raw) : []) as { name: string; score: number; ts: number }[];
}

// -----------------------------
// Optional Supabase Leaderboard (stub)
// -----------------------------
// Fill these from your env and replace functions below.
// const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
async function fetchTopScores(): Promise<{ name: string; score: number }[]> {
  // TODO: Replace with Supabase client query if configured
  return getLocalTop().map((x: any) => ({ name: x.name, score: x.score }));
}
async function postScore(name: string, score: number) {
  // TODO: Replace with Supabase insert if configured
  addLocalScore(name, score);
}

// -----------------------------
// Utilities
// -----------------------------

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function rng(seed: number) {
  // simple LCG for deterministic sequences if you want daily seeds
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
}

// -----------------------------
// Main Component
// -----------------------------

export default function SuikaGame() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine] = useState(() => Engine.create({ gravity: { x: 0, y: 1 } }));
  const worldRef = useRef<World>(engine.world);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(getBestScore());
  const [gameOver, setGameOver] = useState(false);
  const [canDropAt, setCanDropAt] = useState(0);
  const [aimX, setAimX] = useState(0.5); // 0..1 relative
  const [queue, setQueue] = useState<FruitKind[]>(["cherry", "strawberry", "grape"]);
  const [hold, setHold] = useState<{ body?: Body; kind?: FruitKind }>({});
  const [skinId, setSkin] = useState(getSkinId());
  const [showSkins, setShowSkins] = useState(false);
  const [top, setTop] = useState<{ name: string; score: number }[]>([]);
  const [playerName, setPlayerName] = useState<string>(() => localStorage.getItem("suika.name") || "Player");

  const currentSkin = useMemo(() => {
    const bestScore = best;
    return SKINS.map(s => ({ ...s, unlocked: !s.unlockedAtScore || bestScore >= s.unlockedAtScore }))
      .find(s => s.id === skinId) || SKINS[0];
  }, [skinId, best]);

  const skinPalette: Record<FruitKind, string> = useMemo(() => {
    const colors: Record<FruitKind, string> = { ...DEFAULT_COLORS } as any;
    const override = SKINS.find(s => s.id === skinId)?.colors || {};
    (Object.keys(override) as FruitKind[]).forEach(k => {
      colors[k] = override[k] as string;
    });
    return colors;
  }, [skinId]);

  // Resize canvas to container
  useEffect(() => {
    function onResize() {
      const el = containerRef.current; const cv = canvasRef.current; if (!el || !cv) return;
      const w = el.clientWidth; const h = el.clientHeight;
      const aspect = 9 / 16; // portrait
      let cw = w, ch = Math.floor(w / aspect);
      if (ch > h) { ch = h; cw = Math.floor(h * aspect); }
      cv.width = cw; cv.height = ch;
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Build world (walls & top sensor)
  useEffect(() => {
    const world = worldRef.current;
    const cv = canvasRef.current!;
    const W = cv.width, H = cv.height;

    // Clear world
    Composite.clear(world, false);

    const wallThickness = 40;
    const floor = Bodies.rectangle(W / 2, H + wallThickness / 2, W, wallThickness, { isStatic: true, friction: 0.8 });
    const left = Bodies.rectangle(-wallThickness / 2, H / 2, wallThickness, H, { isStatic: true });
    const right = Bodies.rectangle(W + wallThickness / 2, H / 2, wallThickness, H, { isStatic: true });

    // Top sensor to detect game over
    const topSensor = Bodies.rectangle(W / 2, 0 + TOP_SENSOR_THICKNESS / 2, W, TOP_SENSOR_THICKNESS, {
      isStatic: true, isSensor: true, label: "topSensor"
    });

    World.add(world, [floor, left, right, topSensor]);

    // Collision events for merging
    const onCollide = (e: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of e.pairs) {
        const a = pair.bodyA as Body & any; const b = pair.bodyB as Body & any;
        // Only consider fruit bodies (label starts with fruit:kind)
        if (!a.label.startsWith("fruit:") || !b.label.startsWith("fruit:")) continue;
        const kindA = a.label.split(":")[1] as FruitKind;
        const kindB = b.label.split(":")[1] as FruitKind;
        if (kindA !== kindB) continue;
        const idx = KIND_INDEX[kindA];
        if (idx >= FRUITS.length - 1) continue; // max size, cannot merge
        const rel = pair.collision.penetration;
        const vRel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        // Gentle-ish bump required
        if (vRel > MERGE_VELOCITY_THRESHOLD) continue;

        // Mark to avoid double-processing
        if ((a as any).merging || (b as any).merging) continue;
        (a as any).merging = (b as any).merging = true;

        // Create merged fruit at weighted midpoint
        const nx = (a.position.x + b.position.x) / 2;
        const ny = (a.position.y + b.position.y) / 2;
        const nextDef = FRUITS[idx + 1];
        const merged = Bodies.circle(nx, ny, nextDef.radius, {
          restitution: 0.1, friction: 0.5, density: 0.0018, label: `fruit:${nextDef.kind}`
        }) as Body & any;
        merged.render = { fillStyle: skinPalette[nextDef.kind] } as any;

        // Remove originals, add merged
        Composite.remove(world, a);
        Composite.remove(world, b);
        World.add(world, merged);

        // Score
        setScore(s => s + nextDef.score);

        // Tiny nudge
        Body.applyForce(merged, merged.position, { x: (Math.random() - 0.5) * 0.001, y: -0.002 });
      }
    };

    const onSensor = (e: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of e.pairs) {
        if (pair.bodyA.label === "topSensor" || pair.bodyB.label === "topSensor") {
          setGameOver(true);
        }
      }
    };

    Events.on(engine, "collisionStart", onCollide);
    Events.on(engine, "collisionActive", onSensor);

    return () => {
      Events.off(engine, "collisionStart", onCollide);
      Events.off(engine, "collisionActive", onSensor);
    };
  }, [engine, skinPalette]);

  // Game loop & drawing
  useEffect(() => {
    let anim = 0;
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!;

    const step = () => {
      Engine.update(engine, 1000 / 60);

      // Draw background
      ctx.save();
      if (currentSkin.bg) {
        // Use CSS bg simulation
        ctx.fillStyle = "#f1f5f9";
      } else ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, 0, cv.width, cv.height);

      // Well background
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(0, 0, cv.width, 8);

      // Draw bodies (fruits only)
      const all = Composite.allBodies(engine.world);
      for (const b of all) {
        if (!b.label.startsWith("fruit:")) continue;
        const kind = b.label.split(":")[1] as FruitKind;
        const color = skinPalette[kind] || DEFAULT_COLORS[kind];
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, (b as any).circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        // subtle border
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.stroke();
      }

      // Draw aiming ghost if holding
      if (hold.kind) {
        const def = FRUITS[KIND_INDEX[hold.kind]];
        const gx = aimX * cv.width; const gy = 40;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(gx, gy, def.radius, 0, Math.PI * 2);
        ctx.fillStyle = skinPalette[hold.kind] || DEFAULT_COLORS[hold.kind];
        ctx.fill(); ctx.globalAlpha = 1;
      }

      // Next preview UI (right top)
      const boxX = cv.width - 100, boxY = 10, boxW = 90, boxH = 140;
      ctx.fillStyle = "rgba(0,0,0,0.04)"; ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = "#111827"; ctx.font = "12px system-ui"; ctx.fillText("Next", boxX + 8, boxY + 16);
      queue.slice(0, 3).forEach((k, i) => {
        const d = FRUITS[KIND_INDEX[k]]; const y = boxY + 36 + i * 34;
        ctx.beginPath(); ctx.arc(boxX + boxW / 2, y, Math.min(d.radius, 14), 0, Math.PI * 2);
        ctx.fillStyle = skinPalette[k] || DEFAULT_COLORS[k]; ctx.fill();
      });

      // Score UI
      ctx.fillStyle = "#111827"; ctx.font = "bold 18px system-ui";
      ctx.fillText(`Score: ${score}`, 12, 26);
      ctx.font = "12px system-ui"; ctx.fillStyle = "#374151";
      ctx.fillText(`Best: ${best}`, 12, 44);

      anim = requestAnimationFrame(step);
    };

    anim = requestAnimationFrame(step);
    return () => cancelAnimationFrame(anim);
  }, [engine, hold.kind, aimX, queue, score, best, currentSkin.bg, skinPalette]);

  // Spawn first hold & fetch leaderboard
  useEffect(() => {
    if (!hold.kind) {
      setHold({ kind: drawNext(queue, setQueue) });
    }
    fetchTopScores().then(setTop).catch(() => {});
  }, []);

  // Handle input (mouse/touch)
  useEffect(() => {
    const cv = canvasRef.current!;

    function pos(e: MouseEvent | TouchEvent) {
      const rect = cv.getBoundingClientRect();
      let clientX: number;
      if (e instanceof TouchEvent) clientX = e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0;
      else clientX = (e as MouseEvent).clientX;
      const x = clamp((clientX - rect.left) / rect.width, 0.05, 0.95); // keep inside walls
      setAimX(x);
    }

    const onMove = (e: any) => { pos(e); };
    const onDown = (e: any) => { pos(e); tryDrop(); };

    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("touchmove", onMove, { passive: true });
    cv.addEventListener("mousedown", onDown);
    cv.addEventListener("touchstart", onDown, { passive: true });

    return () => {
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("touchmove", onMove as any);
      cv.removeEventListener("mousedown", onDown);
      cv.removeEventListener("touchstart", onDown as any);
    };
  }, [hold.kind, queue, canDropAt, gameOver]);

  // Drop logic
  const tryDrop = () => {
    if (gameOver) return;
    const now = performance.now();
    if (now < canDropAt) return;
    if (!hold.kind) return;
    const cv = canvasRef.current!; const world = worldRef.current;
    const def = FRUITS[KIND_INDEX[hold.kind]];
    const x = aimX * cv.width; const y = 26;
    const body = Bodies.circle(x, y, def.radius, {
      restitution: 0.1, friction: 0.5, density: 0.0018, label: `fruit:${hold.kind}`
    }) as Body & any;
    body.render = { fillStyle: (skinPalette[hold.kind] || DEFAULT_COLORS[hold.kind]) } as any;
    World.add(world, body);
    setHold({ kind: drawNext(queue, setQueue) });
    setCanDropAt(now + DROP_COOLDOWN_MS);
  };

  // Game over handling
  useEffect(() => {
    if (!gameOver) return;
    if (score > best) { setBest(score); setBestScore(score); }
  }, [gameOver]);

  const reset = () => {
    // rebuild world while keeping event listeners
    setGameOver(false);
    setScore(0);
    setQueue(["cherry", "strawberry", "grape"]);
    setHold({ kind: undefined, body: undefined });

    // Clear all fruit bodies
    const world = worldRef.current;
    const bodies = Composite.allBodies(world);
    for (const b of bodies) if (b.label.startsWith("fruit:")) Composite.remove(world, b);
    // re-seed next
    setHold({ kind: drawNext(["cherry", "strawberry", "grape"], setQueue) });
  };

  // Unlocks UI helpers
  const bestScore = best;
  const skinsWithUnlock = SKINS.map(s => ({ ...s, unlocked: !s.unlockedAtScore || bestScore >= s.unlockedAtScore }));

  // Background style
  const bgStyle: React.CSSProperties = currentSkin.bg ? { background: currentSkin.bg } : { background: "linear-gradient(#f8fafc,#e2e8f0)" };

  return (
    <div className="w-full h-full grid grid-cols-1 md:grid-cols-[minmax(280px,420px)_minmax(260px,1fr)] gap-4 p-4" style={bgStyle}>
      {/* Game Column */}
      <div className="relative rounded-2xl shadow-lg bg-white/70 backdrop-blur p-3">
        <div className="flex items-center justify-between px-1">
          <div className="text-sm text-slate-700">Score <span className="font-semibold">{score}</span> · Best <span className="font-semibold">{best}</span></div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs rounded bg-slate-900 text-white" onClick={() => setShowSkins(true)}>Skins</button>
            <button className="px-2 py-1 text-xs rounded bg-slate-800 text-white" onClick={reset}>Restart</button>
          </div>
        </div>
        <div ref={containerRef} className="mt-2 aspect-[9/16] w-full">
          <canvas ref={canvasRef} className="w-full h-full touch-none rounded-xl border border-slate-200" />
        </div>
        {gameOver && (
          <div className="absolute inset-0 grid place-items-center bg-white/80 rounded-2xl">
            <div className="bg-white rounded-xl shadow p-4 text-center w-64">
              <div className="text-lg font-semibold">Game Over</div>
              <div className="text-sm text-slate-600 mt-1">Score {score}</div>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-center gap-2">
                  <input value={playerName} onChange={e => { setPlayerName(e.target.value); localStorage.setItem("suika.name", e.target.value); }} className="px-2 py-1 text-sm border rounded w-36" placeholder="Your name" />
                  <button className="px-2 py-1 text-sm rounded bg-slate-900 text-white" onClick={async () => { await postScore(playerName || "Player", score); const t = await fetchTopScores(); setTop(t); }}>Submit</button>
                </div>
                <button className="px-3 py-2 text-sm rounded bg-slate-800 text-white" onClick={reset}>Play Again</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Side Panel: Next, Leaderboard, Help */}
      <div className="rounded-2xl shadow-lg bg-white/80 backdrop-blur p-4">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        <ol className="mt-2 space-y-1 text-sm max-h-64 overflow-auto pr-1">
          {top.length === 0 && <li className="text-slate-500">No scores yet.</li>}
          {top.map((t, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-slate-700">{i + 1}. {t.name}</span>
              <span className="font-mono">{t.score}</span>
            </li>
          ))}
        </ol>

        <h2 className="text-lg font-semibold mt-6">How to Play</h2>
        <ul className="mt-2 text-sm list-disc pl-5 text-slate-700 space-y-1">
          <li>Move your mouse (or drag) to aim; click/tap to drop the fruit.</li>
          <li>Combine two identical fruits to evolve into the next larger one.</li>
          <li>Don’t let fruits cross the top line — that ends the game.</li>
          <li>Next fruit preview shows the upcoming queue (top of game area).</li>
        </ul>

        <h2 className="text-lg font-semibold mt-6">Skins</h2>
        <p className="text-sm text-slate-600">Unlock by reaching score milestones. Currently selected: <span className="font-medium">{currentSkin.name}</span></p>
      </div>

      {/* Skin Modal */}
      {showSkins && (
        <div className="fixed inset-0 bg-black/30 grid place-items-center p-4" onClick={() => setShowSkins(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Choose Skin</div>
              <button className="px-2 py-1 text-xs rounded bg-slate-900 text-white" onClick={() => setShowSkins(false)}>Close</button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {skinsWithUnlock.map(s => (
                <button key={s.id} disabled={!s.unlocked} onClick={() => { setSkinId(s.id); setSkin(s.id); }} className={`flex items-center justify-between px-3 py-2 rounded border ${skinId === s.id ? "border-slate-900" : "border-slate-200"} ${s.unlocked ? "bg-white" : "bg-slate-100"}`}>
                  <div className="text-left">
                    <div className="font-medium">{s.name}</div>
                    {!s.unlocked && <div className="text-xs text-slate-500">Unlock at {s.unlockedAtScore}+</div>}
                  </div>
                  <div className="flex -space-x-2">
                    {FRUITS.slice(0, 4).map(f => (
                      <div key={f.kind} className="w-6 h-6 rounded-full border border-slate-200" style={{ background: (s.colors[f.kind as FruitKind] || DEFAULT_COLORS[f.kind as FruitKind]) }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------
// Helpers (queue handling, RNG, etc.)
// -----------------------------

function drawNext(queue: FruitKind[], setQueue: (q: FruitKind[]) => void): FruitKind {
  // If queue is short, extend it with weighted random of small fruits
  const pool: FruitKind[] = ["cherry", "strawberry", "grape", "orange", "apple"]; // favor smaller
  const next = queue.length ? queue[0] : pool[(Math.random() * pool.length) | 0];
  const rest = queue.length ? queue.slice(1) : [pool[(Math.random() * pool.length) | 0]];
  if (rest.length < 3) rest.push(pool[(Math.random() * pool.length) | 0]);
  setQueue(rest);
  return next;
}
