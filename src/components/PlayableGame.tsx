'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Genre } from '../types/common';
import type { GameSpec } from '../types/game';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlayableGameProps {
  gameSpec: GameSpec;
  onScoreChange?: (score: number) => void;
  onGameComplete?: (score: number) => void;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const INPUT_HINT_MAP: Record<string, string> = {
  keyboard: 'Use keyboard arrow keys or highlighted keys',
  mouse: 'Click or tap items to interact',
  touch: 'Tap items to interact',
  voice: 'Say commands aloud (e.g. "go north", "pick up")',
  single_switch: 'Press Space or Enter to act',
  eye_tracking: 'Look at an item to select it',
  gamepad: 'Use your gamepad buttons',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlayableGame({ gameSpec, onScoreChange, onGameComplete }: PlayableGameProps) {
  const genre = gameSpec.genre;

  switch (genre) {
    case 'adventure':
      return <AdventureGame spec={gameSpec} onScoreChange={onScoreChange} onGameComplete={onGameComplete} />;
    case 'puzzle':
      return <PuzzleGame spec={gameSpec} onScoreChange={onScoreChange} onGameComplete={onGameComplete} />;
    case 'strategy':
      return <StrategyGame spec={gameSpec} onScoreChange={onScoreChange} onGameComplete={onGameComplete} />;
    case 'simulation':
      return <SimulationGame spec={gameSpec} onScoreChange={onScoreChange} onGameComplete={onGameComplete} />;
    case 'narrative':
      return <NarrativeGame spec={gameSpec} onScoreChange={onScoreChange} onGameComplete={onGameComplete} />;
    default:
      return <FallbackGame spec={gameSpec} />;
  }
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function InputHints({ spec }: { spec: GameSpec }) {
  const methods = [...new Set(spec.interactionMappings.map((m) => m.inputMethod))];
  if (methods.length === 0) return null;
  return (
    <div style={hintBoxStyle} role="note" aria-label="How to play">
      <strong style={{ display: 'block', marginBottom: '4px' }}>How to play:</strong>
      <ul style={{ margin: 0, paddingLeft: '18px' }}>
        {methods.map((m) => (
          <li key={m} style={{ fontSize: '14px', lineHeight: 1.6 }}>
            {INPUT_HINT_MAP[m] ?? m}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBar({ score, message }: { score: number; message?: string }) {
  return (
    <div style={scoreBarStyle} aria-live="polite">
      <span style={{ fontWeight: 700 }}>Score: {score}</span>
      {message && <span style={{ marginLeft: '12px', color: '#555' }}>{message}</span>}
    </div>
  );
}

function WinBanner({ score, onRestart }: { score: number; onRestart: () => void }) {
  return (
    <div style={winBannerStyle} role="alert">
      <p style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px 0' }}>
        You win!
      </p>
      <p style={{ margin: '0 0 16px 0' }}>Final score: {score}</p>
      <button type="button" onClick={onRestart} style={actionBtnStyle}>
        Play Again
      </button>
    </div>
  );
}

// =====================================================================
// ADVENTURE — grid exploration, items, inventory
// =====================================================================

interface Room {
  id: string;
  name: string;
  description: string;
  items: string[];
  exits: Record<string, string>;
  emoji: string;
}

function buildAdventureRooms(spec: GameSpec): Room[] {
  const rand = rng(spec.createdAt);
  const theme = spec.playerDescription.toLowerCase();

  const roomEmojis = ['🏠', '🌲', '🏔️', '🌊', '🏰', '🗺️', '⛺', '🌋'];
  const itemSets = [
    ['Golden Key', 'Old Map', 'Torch', 'Rope', 'Gem', 'Shield'],
    ['Crystal Shard', 'Magic Scroll', 'Compass', 'Lantern', 'Amulet', 'Potion'],
  ];
  const items = shuffle(itemSets[Math.floor(rand() * itemSets.length)], rand);
  const emojis = shuffle(roomEmojis, rand);

  const roomNames = theme.includes('space')
    ? ['Cockpit', 'Engine Room', 'Cargo Bay', 'Bridge', 'Escape Pod', 'Observatory']
    : theme.includes('bird') || theme.includes('angry')
      ? ['Nest', 'Slingshot Area', 'Pig Fort', 'Tower', 'Forest Clearing', 'Victory Hill']
      : ['Starting Camp', 'Dark Forest', 'Mountain Pass', 'River Crossing', 'Ancient Ruins', 'Treasure Chamber'];

  const rooms: Room[] = roomNames.map((name, i) => ({
    id: `room-${i}`,
    name,
    description: `You are at the ${name}. ${i === roomNames.length - 1 ? 'This is the final destination!' : 'Look around for items and exits.'}`,
    items: i > 0 && i < roomNames.length - 1 && items[i - 1] ? [items[i - 1]] : [],
    exits: {},
    emoji: emojis[i] ?? '📍',
  }));

  for (let i = 0; i < rooms.length - 1; i++) {
    const dir = i % 2 === 0 ? 'east' : 'north';
    const back = dir === 'east' ? 'west' : 'south';
    rooms[i].exits[dir] = rooms[i + 1].id;
    rooms[i + 1].exits[back] = rooms[i].id;
  }

  return rooms;
}

function AdventureGame({ spec, onScoreChange, onGameComplete }: { spec: GameSpec; onScoreChange?: (n: number) => void; onGameComplete?: (n: number) => void }) {
  const rooms = useMemo(() => buildAdventureRooms(spec), [spec]);
  const [currentRoomId, setCurrentRoomId] = useState(rooms[0].id);
  const [inventory, setInventory] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [log, setLog] = useState<string[]>(['Your adventure begins!']);
  const [won, setWon] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const room = rooms.find((r) => r.id === currentRoomId) ?? rooms[0];
  const isDestination = room.id === rooms[rooms.length - 1].id;

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-8), msg]);
  }, []);

  const handleMove = useCallback((dir: string) => {
    const target = room.exits[dir];
    if (!target) return;
    const next = rooms.find((r) => r.id === target);
    if (next) {
      setCurrentRoomId(next.id);
      addLog(`Moved ${dir} to ${next.name}.`);
    }
  }, [room, rooms, addLog]);

  const handlePickUp = useCallback((item: string) => {
    setInventory((prev) => [...prev, item]);
    const pts = score + 10;
    setScore(pts);
    onScoreChange?.(pts);
    rooms.find((r) => r.id === currentRoomId)!.items = rooms
      .find((r) => r.id === currentRoomId)!
      .items.filter((i) => i !== item);
    addLog(`Picked up ${item}. (+10 pts)`);
  }, [score, currentRoomId, rooms, addLog, onScoreChange]);

  const handleWin = useCallback(() => {
    if (won) return;
    const finalScore = score + 50;
    setScore(finalScore);
    setWon(true);
    onScoreChange?.(finalScore);
    onGameComplete?.(finalScore);
    addLog('You reached the destination! Adventure complete!');
  }, [won, score, addLog, onScoreChange, onGameComplete]);

  useEffect(() => {
    if (isDestination && !won) handleWin();
  }, [isDestination, won, handleWin]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const keyMap: Record<string, string> = {
      ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east',
      w: 'north', s: 'south', a: 'west', d: 'east',
    };
    const dir = keyMap[e.key];
    if (dir && room.exits[dir]) {
      e.preventDefault();
      handleMove(dir);
    }
    if (e.key === 'e' || e.key === 'Enter') {
      if (room.items.length > 0) handlePickUp(room.items[0]);
    }
  }, [room, handleMove, handlePickUp]);

  if (won) return <WinBanner score={score} onRestart={() => { setCurrentRoomId(rooms[0].id); setInventory([]); setScore(0); setWon(false); setLog(['Your adventure begins again!']); }} />;

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} style={gameContainerStyle} role="application" aria-label={`Adventure game: ${spec.title}`}>
      <InputHints spec={spec} />
      <ScoreBar score={score} message={`Room ${rooms.indexOf(room) + 1} / ${rooms.length}`} />

      <div style={roomStyle}>
        <div style={{ fontSize: '40px', textAlign: 'center' }} aria-hidden="true">{room.emoji}</div>
        <h3 style={{ fontSize: '20px', fontWeight: 700, margin: '8px 0 4px', textAlign: 'center' }}>{room.name}</h3>
        <p style={{ fontSize: '15px', color: '#555', textAlign: 'center', margin: '0 0 12px' }}>{room.description}</p>

        {room.items.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <strong>Items here:</strong>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
              {room.items.map((item) => (
                <button key={item} type="button" onClick={() => handlePickUp(item)} style={itemBtnStyle} aria-label={`Pick up ${item}`}>
                  📦 {item}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {Object.entries(room.exits).map(([dir]) => (
            <button key={dir} type="button" onClick={() => handleMove(dir)} style={dirBtnStyle} aria-label={`Go ${dir}`}>
              {dir === 'north' ? '⬆️' : dir === 'south' ? '⬇️' : dir === 'east' ? '➡️' : '⬅️'} {dir.charAt(0).toUpperCase() + dir.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {inventory.length > 0 && (
        <details open style={{ marginTop: '12px' }}>
          <summary style={{ fontWeight: 600, cursor: 'pointer' }}>Inventory ({inventory.length})</summary>
          <ul style={{ paddingLeft: '18px', margin: '6px 0 0' }}>
            {inventory.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </details>
      )}

      <div style={logStyle} aria-live="polite" aria-label="Adventure log">
        {log.map((entry, i) => <p key={i} style={{ margin: '2px 0', fontSize: '13px', color: i === log.length - 1 ? '#1a1a1a' : '#888' }}>{entry}</p>)}
      </div>
    </div>
  );
}

// =====================================================================
// PUZZLE — tile matching grid
// =====================================================================

const TILE_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];
const TILE_LABELS = ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Teal'];

function PuzzleGame({ spec, onScoreChange, onGameComplete }: { spec: GameSpec; onScoreChange?: (n: number) => void; onGameComplete?: (n: number) => void }) {
  const gridSize = 5;
  const rand = useMemo(() => rng(spec.createdAt), [spec]);

  const buildGrid = useCallback(() => {
    const g: number[] = [];
    for (let i = 0; i < gridSize * gridSize; i++) {
      g.push(Math.floor(rand() * TILE_COLORS.length));
    }
    return g;
  }, [rand]);

  const [grid, setGrid] = useState<number[]>(buildGrid);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [won, setWon] = useState(false);
  const totalTiles = gridSize * gridSize;
  const winTarget = Math.floor(totalTiles * 0.6);

  const handleTileClick = useCallback((idx: number) => {
    if (won) return;
    if (selected === null) {
      setSelected(idx);
      return;
    }
    if (selected === idx) {
      setSelected(null);
      return;
    }
    const r1 = Math.floor(selected / gridSize);
    const c1 = selected % gridSize;
    const r2 = Math.floor(idx / gridSize);
    const c2 = idx % gridSize;
    const adjacent = (Math.abs(r1 - r2) + Math.abs(c1 - c2)) === 1;
    if (!adjacent) {
      setSelected(idx);
      return;
    }

    const newGrid = [...grid];
    [newGrid[selected], newGrid[idx]] = [newGrid[idx], newGrid[selected]];

    const matched = findMatches(newGrid, gridSize);
    if (matched.size > 0) {
      for (const m of matched) newGrid[m] = -1;
      const pts = score + matched.size * 10;
      const cl = cleared + matched.size;
      setScore(pts);
      setCleared(cl);
      onScoreChange?.(pts);
      if (cl >= winTarget && !won) {
        setWon(true);
        onGameComplete?.(pts);
      }
    }
    setGrid(newGrid);
    setSelected(null);
  }, [grid, selected, score, cleared, won, winTarget, gridSize, onScoreChange, onGameComplete]);

  if (won) return <WinBanner score={score} onRestart={() => { setGrid(buildGrid()); setSelected(null); setScore(0); setCleared(0); setWon(false); }} />;

  return (
    <div style={gameContainerStyle} role="application" aria-label={`Puzzle game: ${spec.title}`}>
      <InputHints spec={spec} />
      <ScoreBar score={score} message={`Cleared ${cleared} / ${winTarget} tiles`} />
      <p style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>
        {spec.title}
      </p>
      <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
        Select two adjacent tiles to swap. Match 3+ in a row/column to clear them. Clear {winTarget} tiles to win!
      </p>
      <div role="grid" aria-label="Puzzle board" style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: '4px', maxWidth: '320px', margin: '0 auto' }}>
        {grid.map((colorIdx, i) => {
          const isEmpty = colorIdx < 0;
          const isSelected = selected === i;
          return (
            <button
              key={i}
              role="gridcell"
              type="button"
              disabled={isEmpty}
              onClick={() => handleTileClick(i)}
              aria-label={isEmpty ? 'Empty' : `${TILE_LABELS[colorIdx]} tile${isSelected ? ', selected' : ''}`}
              style={{
                width: '100%',
                aspectRatio: '1',
                border: isSelected ? '3px solid #1a1a1a' : '2px solid transparent',
                borderRadius: '8px',
                backgroundColor: isEmpty ? '#eee' : TILE_COLORS[colorIdx],
                cursor: isEmpty ? 'default' : 'pointer',
                opacity: isEmpty ? 0.3 : 1,
                transition: 'transform 0.1s',
                transform: isSelected ? 'scale(1.1)' : 'none',
                minHeight: '44px',
                minWidth: '44px',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function findMatches(grid: number[], size: number): Set<number> {
  const matched = new Set<number>();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 2; c++) {
      const idx = r * size + c;
      const v = grid[idx];
      if (v < 0) continue;
      if (grid[idx + 1] === v && grid[idx + 2] === v) {
        matched.add(idx); matched.add(idx + 1); matched.add(idx + 2);
      }
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size - 2; r++) {
      const idx = r * size + c;
      const v = grid[idx];
      if (v < 0) continue;
      if (grid[idx + size] === v && grid[idx + size * 2] === v) {
        matched.add(idx); matched.add(idx + size); matched.add(idx + size * 2);
      }
    }
  }
  return matched;
}

// =====================================================================
// STRATEGY — turn-based grid with units
// =====================================================================

interface StratUnit {
  id: string;
  side: 'player' | 'enemy';
  hp: number;
  row: number;
  col: number;
}

function StrategyGame({ spec, onScoreChange, onGameComplete }: { spec: GameSpec; onScoreChange?: (n: number) => void; onGameComplete?: (n: number) => void }) {
  const gridSize = 6;
  const rand = useMemo(() => rng(spec.createdAt), [spec]);

  const buildUnits = useCallback((): StratUnit[] => {
    const units: StratUnit[] = [];
    for (let i = 0; i < 3; i++) {
      units.push({ id: `p${i}`, side: 'player', hp: 3, row: gridSize - 1, col: i * 2 });
      units.push({ id: `e${i}`, side: 'enemy', hp: 2, row: 0, col: 1 + i * 2 });
    }
    return units;
  }, []);

  const [units, setUnits] = useState<StratUnit[]>(buildUnits);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [turn, setTurn] = useState(1);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('Your turn — select a unit, then click an adjacent cell to move.');
  const [won, setWon] = useState(false);

  const unitAt = useCallback((r: number, c: number) => units.find((u) => u.row === r && u.col === c && u.hp > 0), [units]);

  const handleCellClick = useCallback((r: number, c: number) => {
    if (won) return;
    const clicked = unitAt(r, c);

    if (!selectedUnit) {
      if (clicked && clicked.side === 'player') {
        setSelectedUnit(clicked.id);
        setMessage(`Selected ${clicked.id}. Click an adjacent cell to move or attack.`);
      }
      return;
    }

    const sel = units.find((u) => u.id === selectedUnit)!;
    const dist = Math.abs(sel.row - r) + Math.abs(sel.col - c);
    if (dist !== 1) {
      setSelectedUnit(null);
      setMessage('Too far. Select a unit and move to an adjacent cell.');
      return;
    }

    if (clicked && clicked.side === 'enemy' && clicked.hp > 0) {
      const newUnits = units.map((u) => u.id === clicked.id ? { ...u, hp: u.hp - 1 } : u);
      const killed = clicked.hp - 1 <= 0;
      const pts = killed ? score + 20 : score + 5;
      setUnits(newUnits);
      setScore(pts);
      onScoreChange?.(pts);
      setSelectedUnit(null);
      const enemiesLeft = newUnits.filter((u) => u.side === 'enemy' && u.hp > 0).length;
      if (enemiesLeft === 0) {
        setWon(true);
        onGameComplete?.(pts + 50);
        setScore(pts + 50);
        setMessage('All enemies defeated! You win!');
      } else {
        setMessage(killed ? `Defeated ${clicked.id}! (+20 pts)` : `Hit ${clicked.id}! (+5 pts)`);
        doEnemyTurn(newUnits);
      }
    } else if (!clicked) {
      const newUnits = units.map((u) => u.id === sel.id ? { ...u, row: r, col: c } : u);
      setUnits(newUnits);
      setSelectedUnit(null);
      setMessage(`Moved ${sel.id}. Enemy turn...`);
      doEnemyTurn(newUnits);
    } else {
      setSelectedUnit(null);
      setMessage('Cannot move there.');
    }
  }, [units, selectedUnit, score, won, unitAt, onScoreChange, onGameComplete]);

  const doEnemyTurn = useCallback((currentUnits: StratUnit[]) => {
    const enemies = currentUnits.filter((u) => u.side === 'enemy' && u.hp > 0);
    const players = currentUnits.filter((u) => u.side === 'player' && u.hp > 0);
    if (enemies.length === 0 || players.length === 0) return;

    let updatedUnits = [...currentUnits];
    for (const enemy of enemies) {
      const target = players.reduce((closest, p) => {
        const d1 = Math.abs(closest.row - enemy.row) + Math.abs(closest.col - enemy.col);
        const d2 = Math.abs(p.row - enemy.row) + Math.abs(p.col - enemy.col);
        return d2 < d1 ? p : closest;
      }, players[0]);
      const dr = Math.sign(target.row - enemy.row);
      const dc = Math.sign(target.col - enemy.col);
      const nr = enemy.row + dr;
      const nc = enemy.col + (dr === 0 ? dc : 0);
      const occupant = updatedUnits.find((u) => u.row === nr && u.col === nc && u.hp > 0);
      if (occupant && occupant.side === 'player') {
        updatedUnits = updatedUnits.map((u) => u.id === occupant.id ? { ...u, hp: u.hp - 1 } : u);
      } else if (!occupant && nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
        updatedUnits = updatedUnits.map((u) => u.id === enemy.id ? { ...u, row: nr, col: nc } : u);
      }
    }
    setUnits(updatedUnits);
    setTurn((t) => t + 1);
    const playersAlive = updatedUnits.filter((u) => u.side === 'player' && u.hp > 0);
    if (playersAlive.length === 0) {
      setMessage('Your units were defeated. Try again!');
    } else {
      setMessage(`Turn ${turn + 1} — your move.`);
    }
  }, [turn]);

  if (won) return <WinBanner score={score} onRestart={() => { setUnits(buildUnits()); setSelectedUnit(null); setTurn(1); setScore(0); setWon(false); setMessage('Your turn — select a unit.'); }} />;

  return (
    <div style={gameContainerStyle} role="application" aria-label={`Strategy game: ${spec.title}`}>
      <InputHints spec={spec} />
      <ScoreBar score={score} message={`Turn ${turn}`} />
      <p style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>{spec.title}</p>
      <p style={{ fontSize: '14px', color: '#555', margin: '0 0 8px' }} aria-live="polite">{message}</p>
      <div role="grid" aria-label="Battlefield" style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: '3px', maxWidth: '360px', margin: '0 auto' }}>
        {Array.from({ length: gridSize * gridSize }, (_, idx) => {
          const r = Math.floor(idx / gridSize);
          const c = idx % gridSize;
          const unit = unitAt(r, c);
          const isSelected = unit?.id === selectedUnit;
          return (
            <button
              key={idx}
              role="gridcell"
              type="button"
              onClick={() => handleCellClick(r, c)}
              aria-label={unit ? `${unit.side} unit ${unit.id} (HP: ${unit.hp})${isSelected ? ' selected' : ''}` : `Empty cell row ${r + 1} col ${c + 1}`}
              style={{
                width: '100%',
                aspectRatio: '1',
                border: isSelected ? '3px solid #667eea' : '1px solid #d0d0d0',
                borderRadius: '6px',
                backgroundColor: unit ? (unit.side === 'player' ? '#667eea' : '#e53935') : '#fafafa',
                color: unit ? '#fff' : '#ccc',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                opacity: unit && unit.hp <= 0 ? 0.2 : 1,
                minHeight: '44px',
                minWidth: '44px',
              }}
            >
              {unit && unit.hp > 0 ? (unit.side === 'player' ? `⚔${unit.hp}` : `👹${unit.hp}`) : ''}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '13px', justifyContent: 'center' }}>
        <span>⚔️ = Your unit</span>
        <span>👹 = Enemy</span>
        <span>Number = HP</span>
      </div>
    </div>
  );
}

// =====================================================================
// SIMULATION — resource management clicker
// =====================================================================

function SimulationGame({ spec, onScoreChange, onGameComplete }: { spec: GameSpec; onScoreChange?: (n: number) => void; onGameComplete?: (n: number) => void }) {
  const [resources, setResources] = useState(50);
  const [buildings, setBuildings] = useState(0);
  const [population, setPopulation] = useState(10);
  const [score, setScore] = useState(0);
  const [tick, setTick] = useState(0);
  const [won, setWon] = useState(false);
  const winTarget = 10;

  useEffect(() => {
    if (won) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      setResources((r) => r + 5 + buildings * 3);
      setPopulation((p) => Math.min(p + buildings, 200));
    }, 2000);
    return () => clearInterval(interval);
  }, [won, buildings]);

  const handleBuild = useCallback(() => {
    if (resources < 30 || won) return;
    const b = buildings + 1;
    const pts = score + 15;
    setResources((r) => r - 30);
    setBuildings(b);
    setScore(pts);
    onScoreChange?.(pts);
    if (b >= winTarget) {
      setWon(true);
      onGameComplete?.(pts + 100);
      setScore(pts + 100);
    }
  }, [resources, buildings, score, won, onScoreChange, onGameComplete]);

  const handleGather = useCallback(() => {
    if (won) return;
    setResources((r) => r + 20);
    const pts = score + 5;
    setScore(pts);
    onScoreChange?.(pts);
  }, [score, won, onScoreChange]);

  if (won) return <WinBanner score={score} onRestart={() => { setResources(50); setBuildings(0); setPopulation(10); setScore(0); setTick(0); setWon(false); }} />;

  return (
    <div style={gameContainerStyle} role="application" aria-label={`Simulation game: ${spec.title}`}>
      <InputHints spec={spec} />
      <ScoreBar score={score} message={`Buildings ${buildings} / ${winTarget}`} />
      <p style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>{spec.title}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center', margin: '16px 0' }}>
        <div style={statCardStyle}>
          <div style={{ fontSize: '28px' }}>🪵</div>
          <div style={{ fontWeight: 700, fontSize: '20px' }}>{resources}</div>
          <div style={{ fontSize: '13px', color: '#555' }}>Resources</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: '28px' }}>🏠</div>
          <div style={{ fontWeight: 700, fontSize: '20px' }}>{buildings}</div>
          <div style={{ fontSize: '13px', color: '#555' }}>Buildings</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: '28px' }}>👥</div>
          <div style={{ fontWeight: 700, fontSize: '20px' }}>{population}</div>
          <div style={{ fontSize: '13px', color: '#555' }}>Population</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={handleGather} style={actionBtnStyle}>
          🪓 Gather Resources (+20)
        </button>
        <button type="button" onClick={handleBuild} disabled={resources < 30} style={{ ...actionBtnStyle, opacity: resources < 30 ? 0.5 : 1 }}>
          🏗️ Build (costs 30)
        </button>
      </div>
      <p style={{ fontSize: '13px', color: '#888', textAlign: 'center', marginTop: '10px' }} aria-live="off">
        Resources arrive every 2 seconds. Build {winTarget} buildings to win.
      </p>
    </div>
  );
}

// =====================================================================
// NARRATIVE — branching story choices
// =====================================================================

interface StoryNode {
  id: string;
  text: string;
  choices: { label: string; next: string; points: number }[];
}

function buildStoryNodes(spec: GameSpec): StoryNode[] {
  const theme = spec.playerDescription.toLowerCase();
  const setting = theme.includes('space') ? 'spaceship' : theme.includes('bird') ? 'a sky island' : 'a mysterious land';

  return [
    {
      id: 'start',
      text: `You find yourself in ${setting}. The air is thick with mystery. Two paths stretch before you.`,
      choices: [
        { label: 'Take the bright path', next: 'bright', points: 5 },
        { label: 'Take the shadowy path', next: 'shadow', points: 5 },
      ],
    },
    {
      id: 'bright',
      text: 'The bright path leads to a clearing with a friendly stranger. They offer you a gift or a riddle.',
      choices: [
        { label: 'Accept the gift', next: 'gift', points: 10 },
        { label: 'Solve the riddle', next: 'riddle', points: 15 },
      ],
    },
    {
      id: 'shadow',
      text: 'The shadows close in. You discover a locked door and a hidden switch on the wall.',
      choices: [
        { label: 'Try the switch', next: 'switch', points: 10 },
        { label: 'Search for a key', next: 'key', points: 10 },
      ],
    },
    {
      id: 'gift',
      text: 'The gift is a golden compass! It points toward a hidden treasure deeper in the land.',
      choices: [
        { label: 'Follow the compass', next: 'ending_good', points: 20 },
      ],
    },
    {
      id: 'riddle',
      text: '"What has roots nobody sees, is taller than trees?" You answer: "A mountain!" The stranger smiles and reveals a secret passage.',
      choices: [
        { label: 'Enter the passage', next: 'ending_great', points: 25 },
      ],
    },
    {
      id: 'switch',
      text: 'The switch opens the door, revealing a grand hall filled with ancient artifacts.',
      choices: [
        { label: 'Explore the hall', next: 'ending_good', points: 20 },
      ],
    },
    {
      id: 'key',
      text: 'You find a small key hidden behind a loose stone. The door opens to reveal a secret garden.',
      choices: [
        { label: 'Step into the garden', next: 'ending_great', points: 25 },
      ],
    },
    {
      id: 'ending_good',
      text: 'You completed the adventure and found something wonderful. A satisfying journey!',
      choices: [],
    },
    {
      id: 'ending_great',
      text: 'You discovered the deepest secret of this place! A truly remarkable adventure.',
      choices: [],
    },
  ];
}

function NarrativeGame({ spec, onScoreChange, onGameComplete }: { spec: GameSpec; onScoreChange?: (n: number) => void; onGameComplete?: (n: number) => void }) {
  const nodes = useMemo(() => buildStoryNodes(spec), [spec]);
  const [currentId, setCurrentId] = useState('start');
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [won, setWon] = useState(false);
  const node = nodes.find((n) => n.id === currentId) ?? nodes[0];

  const handleChoice = useCallback((choice: { label: string; next: string; points: number }) => {
    const pts = score + choice.points;
    setScore(pts);
    onScoreChange?.(pts);
    setHistory((h) => [...h, `> ${choice.label}`]);
    setCurrentId(choice.next);
    const nextNode = nodes.find((n) => n.id === choice.next);
    if (nextNode && nextNode.choices.length === 0) {
      setWon(true);
      onGameComplete?.(pts);
    }
  }, [score, nodes, onScoreChange, onGameComplete]);

  if (won) return <WinBanner score={score} onRestart={() => { setCurrentId('start'); setScore(0); setHistory([]); setWon(false); }} />;

  return (
    <div style={gameContainerStyle} role="application" aria-label={`Story game: ${spec.title}`}>
      <InputHints spec={spec} />
      <ScoreBar score={score} />
      <p style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px' }}>{spec.title}</p>
      <div style={storyBoxStyle}>
        <p style={{ fontSize: '16px', lineHeight: 1.7, margin: 0 }}>{node.text}</p>
      </div>
      {node.choices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          {node.choices.map((choice, i) => (
            <button key={i} type="button" onClick={() => handleChoice(choice)} style={choiceBtnStyle}>
              {choice.label}
            </button>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: '16px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>Story so far</summary>
          <div style={{ paddingLeft: '12px', marginTop: '6px' }}>
            {history.map((h, i) => <p key={i} style={{ fontSize: '13px', color: '#555', margin: '2px 0' }}>{h}</p>)}
          </div>
        </details>
      )}
    </div>
  );
}

// =====================================================================
// FALLBACK — generic description for unsupported genres
// =====================================================================

function FallbackGame({ spec }: { spec: GameSpec }) {
  return (
    <div style={gameContainerStyle}>
      <p>Game genre "{spec.genre}" does not have an interactive renderer yet.</p>
      <p>Description: {spec.description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const gameContainerStyle: React.CSSProperties = {
  padding: '16px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#1a1a1a',
  lineHeight: 1.6,
};

const hintBoxStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '8px',
  background: 'linear-gradient(135deg, rgba(102,126,234,0.08) 0%, rgba(118,75,162,0.08) 100%)',
  border: '1px solid #c8d6f0',
  marginBottom: '12px',
  fontSize: '14px',
};

const scoreBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 14px',
  borderRadius: '6px',
  backgroundColor: '#f5f7fa',
  border: '1px solid #d0d0d0',
  marginBottom: '12px',
  fontSize: '15px',
};

const roomStyle: React.CSSProperties = {
  padding: '20px',
  borderRadius: '12px',
  border: '2px solid #d0d0d0',
  backgroundColor: '#fafafa',
};

const dirBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: '15px',
  fontWeight: 600,
  border: '2px solid #667eea',
  borderRadius: '8px',
  backgroundColor: '#fff',
  color: '#667eea',
  cursor: 'pointer',
  minHeight: '44px',
  minWidth: '44px',
};

const itemBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: '14px',
  fontWeight: 600,
  border: '2px solid #43a047',
  borderRadius: '8px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  cursor: 'pointer',
  minHeight: '44px',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#fff',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
  minHeight: '44px',
};

const logStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '10px 12px',
  borderRadius: '6px',
  backgroundColor: '#f9f9f9',
  border: '1px solid #e0e0e0',
  maxHeight: '120px',
  overflowY: 'auto',
};

const statCardStyle: React.CSSProperties = {
  padding: '14px 8px',
  borderRadius: '10px',
  border: '1px solid #d0d0d0',
  backgroundColor: '#fafafa',
};

const storyBoxStyle: React.CSSProperties = {
  padding: '20px',
  borderRadius: '12px',
  backgroundColor: '#fafafa',
  border: '2px solid #d0d0d0',
};

const choiceBtnStyle: React.CSSProperties = {
  padding: '14px 20px',
  fontSize: '16px',
  fontWeight: 600,
  textAlign: 'left',
  border: '2px solid #667eea',
  borderRadius: '10px',
  backgroundColor: '#fff',
  color: '#667eea',
  cursor: 'pointer',
  minHeight: '44px',
  transition: 'background-color 0.15s',
};

const winBannerStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '32px 24px',
  borderRadius: '12px',
  backgroundColor: '#e8f5e9',
  border: '2px solid #a5d6a7',
  color: '#1b5e20',
};

export default PlayableGame;
