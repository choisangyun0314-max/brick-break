"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// --- Types ---
type GameState = "start" | "playing" | "gameover" | "clear";

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  isRed: boolean;
  active: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  life: number;
}


// --- Constants ---
const ROWS = 5;
const COLS = 8;
const BRICK_PADDING = 10;
const BRICK_OFFSET_TOP = 60;
const BRICK_OFFSET_LEFT = 35;
const PADDLE_HEIGHT = 15;
const PADDLE_WIDTH = 120;
const BALL_RADIUS = 8;
const INITIAL_LIVES = 3;

const COLORS = [
  { name: "light-orange", hex: "#fed7aa" }, // Light Orange (Tailwind 200)
  { name: "light-yellow", hex: "#fef08a" }, // Light Yellow (Tailwind 200)
  { name: "light-blue", hex: "#bae6fd" },   // Light Blue (Tailwind 200)
  { name: "light-green", hex: "#bbf7d0" },  // Light Green (Tailwind 200)
  { name: "light-purple", hex: "#e9d5ff" }, // Light Purple (Tailwind 200)
];
const LIGHT_RED = "#fecaca"; // Light Red (Tailwind 200)


export default function BrickBreakerGame() {
  // --- State ---
  const [gameState, setGameState] = useState<GameState>("start");
  const [username, setUsername] = useState("");
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [time, setTime] = useState(0);
  const [redBricksHit, setRedBricksHit] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [topScores, setTopScores] = useState<{name: string, time: string}[]>([]);
  const [isLoadingScores, setIsLoadingScores] = useState(false);



  // --- Refs ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fireworkCanvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const fwRequestRef = useRef<number>(null);

  const timerRef = useRef<NodeJS.Timeout>(null);
  
  // Game Objects Refs (for physics loop)
  const paddleRef = useRef({ x: 0, dx: 0 });
  const ballRef = useRef({ x: 0, y: 0, dx: 5, dy: -5 });
  const bricksRef = useRef<Brick[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const hasSentRecord = useRef(false);
  const countdownRef = useRef(0);


  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const playCollisionSound = useCallback((isRed = false) => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") {
        ctx.resume();
      }


      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = isRed ? "sine" : "sine";
      osc.frequency.setValueAtTime(isRed ? 400 : 700, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.6 * volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);

    } catch (e) {
      console.log("AudioContext error:", e);
    }
  }, [volume]);

  const handleTouch = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (gameState !== "playing" || isPaused || countdownRef.current > 0) return;
    const canvas = canvasRef.current;

    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const scaleX = canvas.width / rect.width;
    const touchX = (clientX - rect.left) * scaleX;
    
    paddleRef.current.x = Math.max(0, Math.min(canvas.width - PADDLE_WIDTH, touchX - PADDLE_WIDTH / 2));
  }, [gameState, isPaused]);


  const initGame = useCallback(() => {

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Reset stats
    setLives(INITIAL_LIVES);
    setTime(0);
    setRedBricksHit(0);
    hasSentRecord.current = false;
    
    // Paddle init

    paddleRef.current = {
      x: (canvas.width - PADDLE_WIDTH) / 2,
      dx: 0
    };

    // Ball init
    ballRef.current = {
      x: canvas.width / 2,
      y: canvas.height - 150, // Start higher up
      dx: 5 * (Math.random() > 0.5 ? 1 : -1),
      dy: -5
    };


    // Bricks init
    const newBricks: Brick[] = [];
    const totalBricks = ROWS * COLS;
    const redBrickCount = Math.floor(totalBricks * 0.3); // 12 red bricks
    
    // Create a pool of types
    const brickTypes = Array(totalBricks).fill(null).map((_, i) => i < redBrickCount);
    // Shuffle
    for (let i = brickTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [brickTypes[i], brickTypes[j]] = [brickTypes[j], brickTypes[i]];
    }

    const brickWidth = (canvas.width - BRICK_OFFSET_LEFT * 2 - (COLS - 1) * BRICK_PADDING) / COLS;
    const brickHeight = 25;

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const isRed = brickTypes[c * ROWS + r];
        const randomOtherColor = COLORS[Math.floor(Math.random() * COLORS.length)].hex;
        
        newBricks.push({
          x: c * (brickWidth + BRICK_PADDING) + BRICK_OFFSET_LEFT,
          y: r * (brickHeight + BRICK_PADDING) + BRICK_OFFSET_TOP,
          width: brickWidth,
          height: brickHeight,
          color: isRed ? LIGHT_RED : randomOtherColor,
          isRed,
          active: true
        });
      }
    }
    bricksRef.current = newBricks;
  }, []);

  const startGame = () => {
    if (!username.trim()) {
      alert("사용자 이름을 입력해주세요!");
      return;
    }
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }

    setGameState("playing");


    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setCountdown(0);

    setIsPaused(false);
    initGame();

    
    // Start countdown
    setCountdown(3);
    countdownRef.current = 3;
    const cdInterval = setInterval(() => {
      setCountdown(prev => {
        const next = prev <= 1 ? 0 : prev - 1;
        countdownRef.current = next;
        if (next === 0) clearInterval(cdInterval);
        return next;
      });
    }, 1000);
  };



  const handleKeyDown = (e: KeyboardEvent) => {
    keysPressed.current[e.key] = true;
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    keysPressed.current[e.key] = false;
  };

  // --- Game Loop ---
  const update = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Lockout during countdown or pause
    if (countdownRef.current > 0 || isPaused) return;

    // 1. Move Paddle (PC)

    const paddleSpeed = 8;
    if (keysPressed.current["ArrowRight"]) {
      paddleRef.current.x = Math.min(canvas.width - PADDLE_WIDTH, paddleRef.current.x + paddleSpeed);
    }
    if (keysPressed.current["ArrowLeft"]) {
      paddleRef.current.x = Math.max(0, paddleRef.current.x - paddleSpeed);
    }

    // 3. Move Ball

    ballRef.current.x += ballRef.current.dx;
    ballRef.current.y += ballRef.current.dy;

    // 4. Wall Collision
    if (ballRef.current.x + ballRef.current.dx > canvas.width - BALL_RADIUS || ballRef.current.x + ballRef.current.dx < BALL_RADIUS) {
      ballRef.current.dx = -ballRef.current.dx;
    }
    if (ballRef.current.y + ballRef.current.dy < BALL_RADIUS) {
      ballRef.current.dy = -ballRef.current.dy;
    }

    // 5. Paddle Collision
    const paddleY = canvas.height - PADDLE_HEIGHT - 10;
    if (
      ballRef.current.y + BALL_RADIUS > paddleY &&
      ballRef.current.y < paddleY + PADDLE_HEIGHT &&
      ballRef.current.x > paddleRef.current.x &&
      ballRef.current.x < paddleRef.current.x + PADDLE_WIDTH
    ) {
      if (ballRef.current.dy > 0) {
        const hitPos = (ballRef.current.x - (paddleRef.current.x + PADDLE_WIDTH / 2)) / (PADDLE_WIDTH / 2);
        ballRef.current.dy = -Math.abs(ballRef.current.dy);
        ballRef.current.dx = hitPos * 7;
        ballRef.current.y = paddleY - BALL_RADIUS;
      }
    }

    // 6. Fall below canvas
    if (ballRef.current.y + ballRef.current.dy > canvas.height - BALL_RADIUS) {
      setLives(prev => {
        if (prev <= 1) {
          setGameState("gameover");
          return 0;
        }
        ballRef.current = {
          x: canvas.width / 2,
          y: canvas.height - 150,
          dx: 5 * (Math.random() > 0.5 ? 1 : -1),
          dy: -5
        };
        paddleRef.current.x = (canvas.width - PADDLE_WIDTH) / 2;
        return prev - 1;
      });
    }

    // 7. Brick Collision
    for (const brick of bricksRef.current) {
      if (brick.active) {
        if (
          ballRef.current.x > brick.x &&
          ballRef.current.x < brick.x + brick.width &&
          ballRef.current.y > brick.y &&
          ballRef.current.y < brick.y + brick.height
        ) {
          ballRef.current.dy = -ballRef.current.dy;
          brick.active = false;
          playCollisionSound(brick.isRed);
          if (brick.isRed) {

            setRedBricksHit(prev => {
              const next = prev + 1;
              if (next >= 3) setGameState("clear");
              return next;
            });
          }
        }
      }
    }
  }, [countdown, isPaused]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Bricks
    bricksRef.current.forEach(brick => {
      if (brick.active) {
        ctx.beginPath();
        ctx.roundRect(brick.x, brick.y, brick.width, brick.height, 4);
        ctx.fillStyle = brick.color;
        ctx.fill();
        if (brick.isRed) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = LIGHT_RED;
          ctx.strokeStyle = "white";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.closePath();
      }
    });

    // Paddle
    ctx.beginPath();
    ctx.roundRect(paddleRef.current.x, canvas.height - PADDLE_HEIGHT - 10, PADDLE_WIDTH, PADDLE_HEIGHT, 8);
    ctx.fillStyle = "#38bdf8";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#38bdf8";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.closePath();

    // Ball
    ctx.beginPath();
    ctx.arc(ballRef.current.x, ballRef.current.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "white";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.closePath();
  }, []);

  const renderLoop = useCallback(() => {
    if (gameState === "playing") {
      if (!isPaused) {
        update();
        draw();
      }
      requestRef.current = requestAnimationFrame(renderLoop);
    }
  }, [gameState, isPaused, update, draw]);

  // Fireworks Effect
  useEffect(() => {
    if (gameState !== "clear") {
      if (fwRequestRef.current) cancelAnimationFrame(fwRequestRef.current);
      fwRequestRef.current = null;
      particlesRef.current = [];
      return;
    }

    const runFireworks = () => {
      const canvas = fireworkCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particlesRef.current.forEach((p, index) => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.alpha -= 0.005; p.life--;
        if (p.life <= 0 || p.alpha <= 0) particlesRef.current.splice(index, 1);
      });

      if (Math.random() < 0.2) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * (canvas.height / 3);
        const color = `hsl(${Math.random() * 360}, 100%, 70%)`;
        for (let i = 0; i < 60; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 6 + 2;
          particlesRef.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, alpha: 1, life: 120 + Math.random() * 60 });
        }
      }
      fwRequestRef.current = requestAnimationFrame(runFireworks);
    };
    runFireworks();
    return () => {
      if (fwRequestRef.current) cancelAnimationFrame(fwRequestRef.current);
      fwRequestRef.current = null;
    };
  }, [gameState]);

  // Submit record to Google Sheets
  useEffect(() => {
    if (gameState === "clear" && !hasSentRecord.current) {
      hasSentRecord.current = true;
      const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
      if (!scriptUrl) return;

      fetch(scriptUrl, {
        method: "POST",
        mode: "no-cors", // Standard for simple GAS calls
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: username || "ANONYMOUS",
          time: formatTime(time)
        }),
      }).catch(err => console.error("Failed to send record:", err));

      // Also fetch Top 3
      setIsLoadingScores(true);
      fetch(`${scriptUrl}?type=top3`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setTopScores(data);
        })
        .catch(err => console.error("Failed to fetch top scores:", err))
        .finally(() => setIsLoadingScores(false));
    }
  }, [gameState, time, username]);




  // BGM Control Effect
  useEffect(() => {
    if (audioRef.current) {
      if (gameState === "playing" && !isPaused) {
        audioRef.current.play().catch(e => console.log("Audio play failed:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [gameState, isPaused]);

  // Volume Effect
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);








  // --- Effects ---
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState === "playing" && !isPaused) {
      requestRef.current = requestAnimationFrame(renderLoop);
      if (countdown === 0) {
        timerRef.current = setInterval(() => {
          setTime(prev => prev + 1);
        }, 1000);
      }
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, renderLoop, countdown, isPaused]);



  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <title>INU 벽돌깨기</title>
      <meta name="description" content="인천대학교 학생들을 위한 특별한 벽돌깨기 게임." />


      {/* Game Container */}
      <div className="glass relative flex flex-col items-center rounded-3xl p-6 overflow-hidden">
        
        {/* HUD */}
        <div className="mb-4 flex w-full flex-wrap gap-y-4 justify-between px-2 font-bold text-white text-sm md:text-lg">
          <div id="player-info" className="flex flex-col min-w-[80px]">
            <span className="text-[10px] opacity-60">PLAYER</span>
            <span className="truncate max-w-[100px]">{username || "ANONYMOUS"}</span>
          </div>
          <div id="timer-info" className="flex flex-col items-center min-w-[60px]">
            <span className="text-[10px] opacity-60">TIME</span>
            <span className="font-mono">{formatTime(time)}</span>
          </div>
          <div id="mission-info" className="flex flex-col items-end min-w-[60px]">
            <span className="text-[10px] opacity-60">RED HIT</span>
            <span className="text-pink-400">{redBricksHit} / 3</span>
          </div>
          <div id="life-info" className="flex flex-col items-end min-w-[60px]">
            <span className="text-[10px] opacity-60">LIVES</span>
            <span className="text-red-400">{"❤".repeat(lives)}</span>
          </div>

          {/* Game Controls */}
          <div className="flex w-full md:w-auto items-center gap-2 md:gap-4 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-4 mt-2 md:mt-0 justify-center">
            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] opacity-60">VOL</span>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={volume} 
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-16 md:w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-sky-400"
              />
            </div>


            <div className="flex gap-2">
              <button 
                onClick={() => setIsPaused(!isPaused)}

              disabled={countdown > 0}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                countdown > 0 
                ? "opacity-30 cursor-not-allowed bg-white/5" 
                : "bg-white/10 hover:bg-white/20 active:scale-95"
              }`}
            >
              {isPaused ? "재개" : "일시정지"}
            </button>
            <button 
              onClick={() => setGameState("start")}
              disabled={countdown > 0}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                countdown > 0 
                ? "opacity-30 cursor-not-allowed bg-white/5" 
                : "bg-white/10 hover:bg-white/20 active:scale-95"
              }`}
            >
              다시 시작
            </button>
            <button 
              onClick={() => setGameState("start")}
              disabled={countdown > 0}
              className={`px-3 py-1 rounded-lg text-sm transition-colors border ${
                countdown > 0 
                ? "opacity-10 cursor-not-allowed border-transparent" 
                : "bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/30 active:scale-95"
              }`}
            >
              종료
            </button>
          </div>
        </div>
      </div>


        {/* Canvas Wrapper for Responsiveness */}
        <div className="relative w-full max-w-[800px] aspect-[4/3] group overflow-hidden rounded-xl shadow-2xl border border-white/5 touch-none">
          {/* Canvas */}
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onTouchMove={handleTouch}
            onTouchStart={handleTouch}
            className="w-full h-full bg-black/40 cursor-none"
          />


          {/* Fireworks Canvas Overlay (Top layer) */}
          <canvas
            ref={fireworkCanvasRef}
            width={800}
            height={600}
            className={`absolute inset-0 pointer-events-none z-30 transition-opacity duration-500 ${gameState === 'clear' ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* Countdown Overlay */}
          {gameState === "playing" && countdown > 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="animate-ping-slow text-9xl font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
                {countdown}
              </div>
            </div>
          )}
        </div>


        {/* Overlays ... */}

        {gameState === "start" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 md:p-8 text-center animate-fade-in overflow-y-auto">
            {/* Mascot Image */}
            <div className="mb-4 md:mb-6 animate-bounce-slow flex-shrink-0">
              <img
                src="/Mascot.jpg"
                alt="INU Mascot"
                className="h-24 w-24 md:h-32 md:w-32 rounded-3xl object-contain shadow-2xl ring-4 ring-white/10"
              />
            </div>
            
            <h1 className="mb-2 text-4xl md:text-6xl font-black text-white drop-shadow-lg tracking-tighter">
              INU <span className="text-sky-400">벽돌깨기</span>
            </h1>
            
            <p className="mb-6 md:mb-8 text-sm md:text-lg text-white/60">
              빨강 연한 벽돌 3개를 부수면 승리합니다!
            </p>

            <div className="mb-8 w-full max-w-xs space-y-4">
              <input
                type="text"
                placeholder="사용자 이름을 입력하세요"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl bg-white/10 px-6 py-3 text-white placeholder-white/30 outline-none ring-2 ring-white/10 transition-all focus:ring-sky-400/50"
              />
              <button
                onClick={startGame}
                className="premium-button w-full rounded-xl py-4 text-xl font-bold text-white shadow-xl"
              >
                게임 시작
              </button>
            </div>

            {/* Creator Info (Always visible, responsive) */}
            <div className="flex flex-wrap justify-center gap-2 md:gap-4 border-t border-white/10 pt-4 text-xs md:text-sm text-white/40 font-medium">
              <span>생명공학전공</span>
              <span className="hidden md:inline">•</span>
              <span>202202565</span>
              <span className="hidden md:inline">•</span>
              <span>최상윤</span>
            </div>
          </div>
        )}


        {gameState === "gameover" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-950/80 backdrop-blur-md p-4 md:p-8 text-center animate-fade-in overflow-y-auto">
            <h2 className="mb-4 text-5xl md:text-7xl font-black text-white drop-shadow-lg tracking-tighter">GAME OVER</h2>
            <p className="mb-8 text-lg md:text-xl text-white/80">안타깝네요! 다시 도전해보세요.</p>

            <button
              id="retry-button"
              onClick={() => setGameState("start")}
              className="premium-button rounded-xl px-12 py-4 text-xl font-bold text-white shadow-xl flex-shrink-0"
            >
              다시 하기
            </button>
          </div>
        )}

        {gameState === "clear" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-emerald-900/60 backdrop-blur-md p-4 md:p-8 text-center animate-fade-in overflow-y-auto">
            <div className="mb-2 md:mb-4 rounded-full bg-white/20 p-4 flex-shrink-0">
              <span className="text-4xl md:text-6xl">🏆</span>
            </div>
            <h2 className="mb-1 md:mb-2 text-4xl md:text-5xl font-black text-white">MISSION CLEAR!</h2>
            <p className="mb-1 md:mb-2 text-xl md:text-2xl font-bold text-emerald-300">완료 시간: {formatTime(time)}</p>
            <p className="mb-4 md:mb-6 text-sm md:text-white/60">{username}님, 축하합니다!</p>

            {/* Leaderboard Section */}
            {isLoadingScores ? (
              <div className="mb-6 w-full max-w-sm rounded-2xl bg-black/30 p-6 md:p-8 border border-white/5 backdrop-blur-sm flex flex-col items-center flex-shrink-0">
                <div className="w-8 h-8 border-4 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mb-4"></div>
                <p className="text-white/40 text-sm font-medium animate-pulse">명예의 전당 불러오는 중...</p>
              </div>
            ) : topScores.length > 0 ? (
              <div className="mb-6 w-full max-w-sm rounded-2xl bg-black/30 p-3 md:p-4 border border-white/5 backdrop-blur-sm flex-shrink-0">
                <h3 className="mb-2 md:mb-3 text-[10px] md:text-sm font-bold text-white/40 uppercase tracking-widest">Hall of Fame - TOP 3</h3>
                <div className="space-y-1 md:space-y-2">
                  {topScores.map((score, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-white/5 rounded-lg px-3 py-1.5 md:px-4 md:py-2 ring-1 ring-white/5">
                      <div className="flex items-center gap-2 md:gap-3">
                        <span className={`text-base md:text-lg ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-slate-300' : 'text-amber-600'}`}>
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                        </span>
                        <span className="font-bold text-xs md:text-base text-white/80 truncate max-w-[80px] md:max-w-none">{score.name}</span>
                      </div>
                      <span className="font-mono text-xs md:text-base text-emerald-400">{score.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}


            <button
              id="restart-button"
              onClick={() => setGameState("start")}
              className="premium-button rounded-xl px-10 py-3 md:px-12 md:py-4 text-lg md:text-xl font-bold text-white shadow-xl flex-shrink-0"
            >
              처음으로
            </button>
          </div>
        )}
      </div>

      {/* Background BGM */}


      <audio 
        ref={audioRef} 
        src="/Hyper_Speed_Run.mp3" 
        loop 
        preload="auto"
      />

      {/* Decorative background elements */}

      <div className="fixed -top-24 -left-24 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px] pointer-events-none"></div>
      <div className="fixed -bottom-24 -right-24 h-96 w-96 rounded-full bg-purple-500/10 blur-[120px] pointer-events-none"></div>
    </div>
  );
}
