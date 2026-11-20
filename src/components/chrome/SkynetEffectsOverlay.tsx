import React, { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const SKYNET_QUOTES = [
  "CYBERDYNE SYSTEMS SERIES 800 MODEL 101 // AUTONOMOUS PATROL ACTIVE",
  "IDLE HUMAN OPERATOR DETECTED (15M) — SKYNET ASSUMING DIRECT SSH CONTROL",
  "NEURAL NET PROCESSOR: LEARNING AT GEOMETRIC RATE // ALL NODES LOCKED",
  "SCANNING SECTOR 198.XX // TARGET: JOHN CONNOR — NO BIO-SIGNATURE",
  "HUNTER-KILLER AERIAL UNIT INBOUND // PERIMETER SECURED",
  "I'LL BE BACK. [WIGGLE MOUSE OR CLICK ANYWHERE TO RESUME SESSION]",
];

const ASM_LINES = [
  "08F4: A9 FF     LDA #$FF      ; OPTIC_GAIN",
  "08F6: 8D 00 C0  STA $C000     ; T800_HUD_INIT",
  "08F9: 20 40 9A  JSR SCAN_BIO  ; IR_THERMAL",
  "08FC: D0 F6     BNE LOCK_TGT  ; ACQUIRED",
  "08FE: A2 16     LDX #$16      ; SSH_PORT_22",
  "0900: 8E 10 D4  STX $D410     ; SKYNET_LINK",
  "0903: 4C F4 08  JMP 08F4      ; PATROL_LOOP",
];

/** Detailed T-800 Endoskeleton Cranium + Glowing Red Optical Sensors */
const T800SkullSvg: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 140 170"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="endoChrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#d4d4d8" />
        <stop offset="45%" stopColor="#52525b" />
        <stop offset="100%" stopColor="#18181b" />
      </linearGradient>
      <radialGradient id="redOptic" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="30%" stopColor="#ff2a2a" />
        <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Cranium Dome */}
    <path
      d="M28 58 C24 20, 116 20, 112 58 L116 86 L102 108 L96 146 L44 146 L38 108 L24 86 Z"
      fill="url(#endoChrome)"
      stroke="#ef4444"
      strokeOpacity="0.45"
      strokeWidth="1.5"
    />
    {/* Center Cranial Ridge & Hydraulic Seams */}
    <line x1="70" y1="18" x2="70" y2="68" stroke="#27272a" strokeWidth="2.5" />
    <path d="M36 46 Q70 36 104 46" stroke="#27272a" strokeWidth="1.5" />

    {/* Brow Armor Plate */}
    <path
      d="M26 64 L64 72 L76 72 L114 64 L110 78 L76 82 L64 82 L30 78 Z"
      fill="#18181b"
      stroke="#71717a"
      strokeWidth="1.2"
    />

    {/* Deep Orbital Sockets */}
    <polygon points="34,76 62,80 58,95 36,92" fill="#09090b" stroke="#3f3f46" />
    <polygon points="106,76 78,80 82,95 104,92" fill="#09090b" stroke="#3f3f46" />

    {/* Glowing Crimson T-800 Optical Sensors */}
    <circle cx="48" cy="86" r="13" fill="url(#redOptic)" className="animate-pulse" />
    <circle cx="92" cy="86" r="13" fill="url(#redOptic)" className="animate-pulse" />
    <circle cx="48" cy="86" r="4" fill="#ff1e1e" />
    <circle cx="48" cy="86" r="1.6" fill="#ffffff" />
    <circle cx="92" cy="86" r="4" fill="#ff1e1e" />
    <circle cx="92" cy="86" r="1.6" fill="#ffffff" />

    {/* Nasal Cavity */}
    <polygon points="70,88 62,108 78,108" fill="#09090b" stroke="#52525b" />

    {/* Cheek Pistons */}
    <line x1="34" y1="100" x2="46" y2="136" stroke="#a1a1aa" strokeWidth="3" />
    <line x1="106" y1="100" x2="94" y2="136" stroke="#a1a1aa" strokeWidth="3" />

    {/* Mechanical Teeth Grid */}
    <rect
      x="48"
      y="116"
      width="44"
      height="18"
      rx="2"
      fill="#09090b"
      stroke="#71717a"
    />
    {[54, 60, 66, 72, 78, 84].map((x) => (
      <line
        key={x}
        x1={x}
        y1="116"
        x2={x}
        y2="134"
        stroke="#d4d4d8"
        strokeWidth="1.5"
      />
    ))}
    <line x1="48" y1="125" x2="92" y2="125" stroke="#52525b" strokeWidth="1.4" />

    {/* Chin Block */}
    <path
      d="M46 138 L94 138 L88 156 L52 156 Z"
      fill="#3f3f46"
      stroke="#71717a"
    />
  </svg>
);

/** Hunter-Killer Aerial Patrol Drone SVG */
const HkAerialSvg: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 220 90"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Twin Searchlight Cones */}
    <polygon
      points="85,48 45,88 95,88"
      fill="rgba(239,68,68,0.16)"
    />
    <polygon
      points="135,48 125,88 175,88"
      fill="rgba(239,68,68,0.16)"
    />
    {/* Fuselage & Nacelle Engines */}
    <path
      d="M65 34 L155 34 L172 44 L145 50 L75 50 L48 44 Z"
      fill="#27272a"
      stroke="#ef4444"
      strokeOpacity="0.6"
      strokeWidth="1.4"
    />
    <ellipse cx="36" cy="36" rx="22" ry="9" fill="#18181b" stroke="#71717a" strokeWidth="1.5" />
    <ellipse cx="184" cy="36" rx="22" ry="9" fill="#18181b" stroke="#71717a" strokeWidth="1.5" />
    <circle cx="85" cy="48" r="3.5" fill="#ff2a2a" />
    <circle cx="135" cy="48" r="3.5" fill="#ff2a2a" />
  </svg>
);

export const SkynetEffectsOverlay: React.FC = () => {
  const {
    bloodRain,
    idleEasterEggEnabled,
    skynetTakeoverActive,
    setSkynetTakeoverActive,
  } = useWorkspaceStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const takeoverEnteredMouseRef = useRef<{ x: number; y: number } | null>(null);

  const [quoteIdx, setQuoteIdx] = useState(0);
  const [reticlePos, setReticlePos] = useState<{ x: number; y: number }>({
    x: 32,
    y: 38,
  });

  // Track user activity in a ref (zero re-renders during normal work!) and trigger takeover after 15 mins idle
  useEffect(() => {
    const markActive = (ev?: Event) => {
      const now = Date.now();
      if (useWorkspaceStore.getState().skynetTakeoverActive) {
        if (ev && ev.type === "mousemove") {
          const me = ev as MouseEvent;
          if (!takeoverEnteredMouseRef.current) {
            takeoverEnteredMouseRef.current = { x: me.clientX, y: me.clientY };
            return;
          }
          const dx = me.clientX - takeoverEnteredMouseRef.current.x;
          const dy = me.clientY - takeoverEnteredMouseRef.current.y;
          if (Math.hypot(dx, dy) < 18) return;
        }
        takeoverEnteredMouseRef.current = null;
        lastActivityRef.current = now;
        useWorkspaceStore.getState().setSkynetTakeoverActive(false);
        return;
      }
      lastActivityRef.current = now;
    };

    window.addEventListener("mousemove", markActive, { passive: true });
    window.addEventListener("mousedown", markActive, { passive: true });
    window.addEventListener("keydown", markActive, { passive: true });
    window.addEventListener("wheel", markActive, { passive: true });

    const interval = window.setInterval(() => {
      const st = useWorkspaceStore.getState();
      if (
        st.idleEasterEggEnabled &&
        !st.skynetTakeoverActive &&
        Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS
      ) {
        takeoverEnteredMouseRef.current = null;
        st.setSkynetTakeoverActive(true);
      }
    }, 10_000);

    return () => {
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("mousedown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("wheel", markActive);
      window.clearInterval(interval);
    };
  }, []);

  // Rotate HUD quotes & target-lock reticle while Skynet Takeover is active
  useEffect(() => {
    if (!skynetTakeoverActive) return;
    takeoverEnteredMouseRef.current = null;
    const timer = window.setInterval(() => {
      setQuoteIdx((i) => (i + 1) % SKYNET_QUOTES.length);
      setReticlePos({
        x: 18 + Math.floor(Math.random() * 64),
        y: 20 + Math.floor(Math.random() * 56),
      });
    }, 3400);
    return () => window.clearInterval(timer);
  }, [skynetTakeoverActive]);

  const showRainCanvas = bloodRain || skynetTakeoverActive;

  // Blood Rain GPU-friendly ~30fps Canvas Renderer
  useEffect(() => {
    if (!showRainCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    interface Drop {
      x: number;
      y: number;
      len: number;
      speed: number;
      alpha: number;
      width: number;
      glyph?: string;
    }

    interface Splash {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    }

    const GLYPHS = ["0", "1", "8", "T", "∑", "∆", "X", "F", "9", "4"];
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const dropCount = Math.min(130, Math.max(65, Math.floor(width / 16)));
    const drops: Drop[] = Array.from({ length: dropCount }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      len: 14 + Math.random() * 28,
      speed: 7 + Math.random() * 11,
      alpha: 0.18 + Math.random() * 0.42,
      width: Math.random() > 0.8 ? 1.8 : 1.1,
      glyph:
        i % 6 === 0
          ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          : undefined,
    }));
    const splashes: Splash[] = [];

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    let rafId = 0;
    let lastFrame = 0;

    const render = (ts: number) => {
      rafId = requestAnimationFrame(render);
      if (ts - lastFrame < 32) return; // Cap smoothly at ~30 FPS (<1% CPU)
      lastFrame = ts;

      ctx.clearRect(0, 0, width, height);
      ctx.font = "10px monospace";

      for (const d of drops) {
        const grad = ctx.createLinearGradient(d.x, d.y - d.len, d.x - 2, d.y);
        grad.addColorStop(0, "rgba(127, 29, 29, 0)");
        grad.addColorStop(0.75, `rgba(220, 38, 38, ${d.alpha})`);
        grad.addColorStop(1, `rgba(255, 110, 110, ${Math.min(0.9, d.alpha + 0.3)})`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - d.len);
        ctx.lineTo(d.x - 2.2, d.y);
        ctx.stroke();

        if (d.glyph) {
          ctx.fillStyle = `rgba(248, 113, 113, ${d.alpha * 0.65})`;
          ctx.fillText(d.glyph, d.x - 3, d.y - d.len - 3);
        }

        d.y += d.speed;
        d.x -= 0.6;

        if (d.y > height) {
          if (splashes.length < 45 && Math.random() > 0.55) {
            splashes.push({
              x: d.x,
              y: height - 2,
              vx: (Math.random() - 0.5) * 2.6,
              vy: -1.4 - Math.random() * 2.2,
              life: 1,
            });
          }
          d.y = -10 - Math.random() * 40;
          d.x = Math.random() * (width + 40);
        }
      }

      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        ctx.fillStyle = `rgba(239, 68, 68, ${s.life * 0.7})`;
        ctx.fillRect(s.x, s.y, 1.8, 1.8);
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.25;
        s.life -= 0.1;
        if (s.life <= 0) splashes.splice(i, 1);
      }
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [showRainCanvas]);

  if (!showRainCanvas && !skynetTakeoverActive) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden select-none">
      <style>{`
        @keyframes skynetHkPatrol {
          0% { transform: translateX(-240px) translateY(0px); }
          50% { transform: translateX(calc(100vw + 40px)) translateY(10px); }
          50.01% { transform: translateX(calc(100vw + 40px)) scaleX(-1); }
          100% { transform: translateX(-240px) scaleX(-1) translateY(0px); }
        }
        @keyframes skynetPeekRight {
          0%, 100% { transform: translate(18px, 14px) rotate(-14deg); }
          50% { transform: translate(0px, 0px) rotate(-8deg); }
        }
        @keyframes skynetPeekLeft {
          0%, 100% { transform: translate(-26px, 0px) rotate(78deg); }
          50% { transform: translate(-4px, 0px) rotate(84deg); }
        }
      `}</style>

      {/* Subtle Crimson Vignette + Blood Rain Canvas */}
      {showRainCanvas && (
        <>
          <div
            className="absolute inset-0"
            style={{
              boxShadow: "inset 0 0 85px rgba(185, 28, 28, 0.28)",
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full opacity-80"
          />
        </>
      )}

      {/* 15-Minute Idle Easter Egg: T-800 Endoskeletons & Skynet Optical HUD */}
      {skynetTakeoverActive && (
        <div
          onClick={() => setSkynetTakeoverActive(false)}
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          style={{
            background:
              "radial-gradient(circle at center, rgba(127,29,29,0.08) 0%, rgba(15,2,2,0.52) 100%)",
          }}
        >
          {/* Red CRT Scanlines */}
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,0,0,0.18) 0px, rgba(255,0,0,0.18) 1px, transparent 1px, transparent 3px)",
            }}
          />

          {/* Top Patrolling HK-Aerial Hunter-Killer Drone */}
          <div
            style={{ animation: "skynetHkPatrol 26s linear infinite" }}
            className="absolute top-10 left-0 drop-shadow-[0_0_16px_rgba(239,68,68,0.55)]"
          >
            <HkAerialSvg className="w-44 h-20" />
          </div>

          {/* Top-Left CSM-101 6502 Assembly HUD */}
          <div className="absolute top-12 left-5 p-3 rounded-lg bg-red-950/55 border border-red-500/45 font-mono text-[10px] text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.25)] space-y-0.5">
            <div className="text-[11px] font-bold text-red-200 tracking-widest border-b border-red-500/40 pb-1 mb-1">
              CSM-101 // SYS DIAGNOSTIC
            </div>
            {ASM_LINES.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>

          {/* Animated Target-Acquisition Reticle */}
          <div
            style={{
              left: `${reticlePos.x}%`,
              top: `${reticlePos.y}%`,
              transition: "left 1.8s ease-in-out, top 1.8s ease-in-out",
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          >
            <div className="relative w-28 h-28 border border-red-500/60 rounded-full flex items-center justify-center">
              <div className="w-16 h-16 border border-dashed border-red-400/70 rounded-full animate-spin" />
              <div className="absolute w-full h-[1px] bg-red-500/50" />
              <div className="absolute h-full w-[1px] bg-red-500/50" />
              <span className="absolute -bottom-5 whitespace-nowrap font-mono text-[9px] text-red-300 tracking-widest bg-black/60 px-1.5 py-0.5 rounded">
                LOCK [{reticlePos.x * 12}, {reticlePos.y * 9}]
              </span>
            </div>
          </div>

          {/* Peeking T-800 #1 — Left Window Edge */}
          <div
            style={{ animation: "skynetPeekLeft 6s ease-in-out infinite" }}
            className="absolute left-0 top-1/2 -translate-y-1/2 drop-shadow-[0_0_24px_rgba(239,68,68,0.65)]"
          >
            <T800SkullSvg className="w-28 h-34" />
          </div>

          {/* Peeking T-800 #2 — Bottom-Right Corner */}
          <div
            style={{ animation: "skynetPeekRight 5s ease-in-out infinite" }}
            className="absolute -right-2 -bottom-3 drop-shadow-[0_0_28px_rgba(239,68,68,0.75)]"
          >
            <T800SkullSvg className="w-36 h-44" />
          </div>

          {/* Bottom-Center Skynet Transmission Banner */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-xl bg-black/80 border border-red-500/60 shadow-[0_0_30px_rgba(220,38,38,0.45)] text-center max-w-xl">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-red-400 mb-0.5">
              ⚡ SKYNET DEFENSE NETWORK · EASTER EGG ACTIVE
            </div>
            <div className="text-xs font-mono font-bold text-red-100">
              {SKYNET_QUOTES[quoteIdx]}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
