import type { Genre, InputMethod } from '../types/common';
import type { AccessibilityProfile } from '../types/player';
import type {
  GameSpec,
  GameRule,
  WinCondition,
  GameMechanic,
  InteractionMapping,
  AssetReference,
  AccessibilityAdaptation,
} from '../types/game';

// ---------------------------------------------------------------------------
// Request / Result types
// ---------------------------------------------------------------------------

export interface GameGenerationRequest {
  playerDescription: string;
  profile: AccessibilityProfile;
  preferredGenre?: Genre;
  sessionId: string;
}

export interface GameGenerationResult {
  success: boolean;
  gameSpec?: GameSpec;
  conflicts?: ConflictDescription[];
  generationTimeMs: number;
}

export interface ConflictDescription {
  requirement1: string;
  requirement2: string;
  explanation: string;
}

export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: ConflictDescription[];
}

export interface ValidationResult {
  valid: boolean;
  invalidMappings: InvalidMapping[];
}

export interface InvalidMapping {
  mechanicId: string;
  inputMethod: InputMethod;
  reason: string;
}

// ---------------------------------------------------------------------------
// LLM Provider abstraction
// ---------------------------------------------------------------------------

export interface LLMProvider {
  generateGameSpec(prompt: string, genre: Genre): Promise<GameSpec>;
}

// ---------------------------------------------------------------------------
// Conflict pair definitions
// ---------------------------------------------------------------------------

interface ConflictPair {
  keywords1: string[];
  keywords2: string[];
  explanation: string;
}

const CONFLICT_PAIRS: ConflictPair[] = [
  {
    keywords1: ['fast-paced', 'fast paced', 'high speed', 'rapid', 'quick action'],
    keywords2: ['no time pressure', 'no timer', 'relaxed pace', 'untimed', 'no rush'],
    explanation: 'Fast-paced gameplay conflicts with no time pressure',
  },
  {
    keywords1: ['complex controls', 'many buttons', 'complex input'],
    keywords2: ['simple controls', 'one button', 'single switch', 'minimal input'],
    explanation: 'Complex controls conflict with simple/minimal input requirements',
  },
  {
    keywords1: ['multiplayer', 'competitive', 'pvp'],
    keywords2: ['single player', 'solo', 'alone'],
    explanation: 'Multiplayer mode conflicts with single-player requirement',
  },
  {
    keywords1: ['text heavy', 'lots of reading', 'text-based'],
    keywords2: ['no reading', 'no text', 'audio only'],
    explanation: 'Text-heavy gameplay conflicts with no-reading requirement',
  },
  {
    keywords1: ['visually complex', 'detailed graphics', 'many visual elements'],
    keywords2: ['minimal visuals', 'simple graphics', 'low visual complexity'],
    explanation: 'Visually complex gameplay conflicts with minimal visual requirements',
  },
];

// ---------------------------------------------------------------------------
// Genre templates for mock/template-based generation
// ---------------------------------------------------------------------------

interface GenreTemplate {
  genre: Genre;
  titlePrefix: string;
  ruleTemplates: Omit<GameRule, 'id'>[];
  winConditionTemplates: Omit<WinCondition, 'id'>[];
  mechanicTemplates: Omit<GameMechanic, 'id'>[];
  estimatedPlayTime: number;
}

const GENRE_TEMPLATES: Record<Genre, GenreTemplate> = {
  puzzle: {
    genre: 'puzzle',
    titlePrefix: 'Puzzle Quest',
    ruleTemplates: [
      { description: 'Match three or more tiles to clear them', condition: 'tiles_matched >= 3', effect: 'clear_tiles' },
      { description: 'Cleared tiles award points', condition: 'tiles_cleared', effect: 'add_score' },
    ],
    winConditionTemplates: [
      { description: 'Clear all puzzle tiles to win', condition: 'all_tiles_cleared' },
    ],
    mechanicTemplates: [
      { name: 'tile_select', description: 'Select a tile on the board', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'eye_tracking', 'single_switch'], difficulty: 0.2 },
      { name: 'tile_swap', description: 'Swap two adjacent tiles', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'eye_tracking'], difficulty: 0.3 },
    ],
    estimatedPlayTime: 10,
  },
  adventure: {
    genre: 'adventure',
    titlePrefix: 'Adventure',
    ruleTemplates: [
      { description: 'Explore areas to discover items and clues', condition: 'player_enters_area', effect: 'reveal_items' },
      { description: 'Collect items to solve puzzles', condition: 'item_collected', effect: 'update_inventory' },
    ],
    winConditionTemplates: [
      { description: 'Reach the final destination to complete the adventure', condition: 'reached_destination' },
    ],
    mechanicTemplates: [
      { name: 'move', description: 'Move character in a direction', requiredInputMethods: ['keyboard'], alternativeInputMethods: ['voice', 'touch', 'gamepad', 'eye_tracking', 'single_switch'], difficulty: 0.2 },
      { name: 'interact', description: 'Interact with objects in the environment', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'voice', 'touch', 'eye_tracking', 'single_switch'], difficulty: 0.3 },
      { name: 'use_item', description: 'Use an item from inventory', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'voice', 'touch', 'single_switch'], difficulty: 0.3 },
    ],
    estimatedPlayTime: 20,
  },
  strategy: {
    genre: 'strategy',
    titlePrefix: 'Strategy',
    ruleTemplates: [
      { description: 'Place units on the board during your turn', condition: 'player_turn', effect: 'allow_placement' },
      { description: 'Units attack adjacent enemies automatically', condition: 'adjacent_enemy', effect: 'auto_attack' },
    ],
    winConditionTemplates: [
      { description: 'Defeat all enemy units to win', condition: 'all_enemies_defeated' },
    ],
    mechanicTemplates: [
      { name: 'select_unit', description: 'Select a unit to command', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'eye_tracking', 'single_switch'], difficulty: 0.3 },
      { name: 'place_unit', description: 'Place a unit on the board', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'eye_tracking'], difficulty: 0.4 },
      { name: 'end_turn', description: 'End your current turn', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'voice', 'touch', 'single_switch', 'gamepad'], difficulty: 0.1 },
    ],
    estimatedPlayTime: 25,
  },
  simulation: {
    genre: 'simulation',
    titlePrefix: 'Sim',
    ruleTemplates: [
      { description: 'Resources accumulate over time', condition: 'time_passes', effect: 'add_resources' },
      { description: 'Build structures using resources', condition: 'resources_available', effect: 'allow_building' },
    ],
    winConditionTemplates: [
      { description: 'Build a thriving community to complete the simulation', condition: 'community_thriving' },
    ],
    mechanicTemplates: [
      { name: 'build', description: 'Build a structure', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'eye_tracking', 'single_switch'], difficulty: 0.3 },
      { name: 'manage', description: 'Manage resources and settings', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'touch', 'voice', 'single_switch'], difficulty: 0.4 },
    ],
    estimatedPlayTime: 30,
  },
  narrative: {
    genre: 'narrative',
    titlePrefix: 'Story',
    ruleTemplates: [
      { description: 'Choices affect the story outcome', condition: 'choice_made', effect: 'branch_narrative' },
      { description: 'Dialogue reveals character motivations', condition: 'dialogue_triggered', effect: 'reveal_info' },
    ],
    winConditionTemplates: [
      { description: 'Reach one of the story endings', condition: 'story_complete' },
    ],
    mechanicTemplates: [
      { name: 'choose', description: 'Make a narrative choice', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'voice', 'touch', 'eye_tracking', 'single_switch', 'sip_puff'], difficulty: 0.1 },
      { name: 'dialogue', description: 'Engage in dialogue with characters', requiredInputMethods: ['mouse'], alternativeInputMethods: ['keyboard', 'voice', 'touch', 'single_switch'], difficulty: 0.2 },
    ],
    estimatedPlayTime: 15,
  },
};

// ---------------------------------------------------------------------------
// Genre detection from description
// ---------------------------------------------------------------------------

const GENRE_KEYWORDS: Record<Genre, string[]> = {
  puzzle: [
    'puzzle', 'match', 'brain', 'logic', 'riddle', 'sudoku', 'crossword',
    'jigsaw', 'tile', 'solitaire', 'card', 'cards', 'tetris', 'minesweeper',
    'mahjong', 'wordle', 'trivia', 'quiz', 'number', 'math', 'pattern',
    'sort', 'color', 'connect', 'swap', 'merge', 'block', '2048', 'candy',
    'bejeweled', 'bubble',
  ],
  adventure: [
    'adventure', 'explore', 'quest', 'journey', 'discover', 'treasure',
    'dungeon', 'space', 'zelda', 'mario', 'platformer', 'rpg', 'role play',
    'angry bird', 'angry birds', 'minecraft', 'pokemon', 'pirate',
    'dragon', 'knight', 'hero', 'mission', 'survive', 'survival',
  ],
  strategy: [
    'strategy', 'tactical', 'war', 'battle', 'defend', 'tower defense',
    'chess', 'plan', 'army', 'conquer', 'command', 'checkers', 'risk',
    'civilization', 'clash', 'troops', 'deploy',
  ],
  simulation: [
    'simulation', 'sim', 'build', 'manage', 'farm', 'city', 'tycoon',
    'sandbox', 'resource', 'construct', 'factory', 'cook', 'cooking',
    'restaurant', 'shop', 'store', 'garden', 'animal crossing',
  ],
  narrative: [
    'story', 'narrative', 'choose your own', 'visual novel', 'dialogue',
    'mystery', 'detective', 'horror', 'romance', 'drama', 'thriller',
    'escape room', 'clue', 'whodunit', 'text adventure',
  ],
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function detectGenre(description: string, preferred?: Genre): Genre {
  if (preferred) return preferred;

  const lower = description.toLowerCase();
  let bestGenre: Genre = 'puzzle';
  let bestScore = 0;

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS) as [Genre, string[]][]) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  return bestGenre;
}

function findCompatibleInputMethod(
  requiredMethods: InputMethod[],
  alternativeMethods: InputMethod[],
  playerMethods: InputMethod[],
): InputMethod | null {
  // First check if any required method is available
  for (const method of requiredMethods) {
    if (playerMethods.includes(method)) return method;
  }
  // Then check alternatives
  for (const method of alternativeMethods) {
    if (playerMethods.includes(method)) return method;
  }
  return null;
}

function buildInteractionMappings(
  mechanics: GameMechanic[],
  playerMethods: InputMethod[],
): InteractionMapping[] {
  const mappings: InteractionMapping[] = [];

  for (const mechanic of mechanics) {
    const method = findCompatibleInputMethod(
      mechanic.requiredInputMethods,
      mechanic.alternativeInputMethods,
      playerMethods,
    );

    if (method) {
      mappings.push({
        mechanicId: mechanic.id,
        inputMethod: method,
        binding: buildBinding(method, mechanic.name),
      });
    }
  }

  return mappings;
}

function buildBinding(method: InputMethod, mechanicName: string): string {
  switch (method) {
    case 'keyboard': return `key:${mechanicName}`;
    case 'mouse': return `mouse:click_${mechanicName}`;
    case 'touch': return `touch:tap_${mechanicName}`;
    case 'voice': return `voice:${mechanicName.replace(/_/g, ' ')}`;
    case 'single_switch': return `switch:activate_${mechanicName}`;
    case 'eye_tracking': return `eye:gaze_${mechanicName}`;
    case 'head_tracking': return `head:nod_${mechanicName}`;
    case 'sip_puff': return `sip_puff:${mechanicName}`;
    case 'gamepad': return `gamepad:button_${mechanicName}`;
    default: return `${method}:${mechanicName}`;
  }
}

function buildAccessibilityAdaptations(
  mechanics: GameMechanic[],
  profile: AccessibilityProfile,
): AccessibilityAdaptation[] {
  const adaptations: AccessibilityAdaptation[] = [];

  for (const mechanic of mechanics) {
    // Add pacing adaptation for slow-paced preference
    if (profile.preferredPacing === 'slow') {
      adaptations.push({
        mechanicId: mechanic.id,
        adaptationType: 'pacing_adjustment',
        parameters: { speedMultiplier: 0.5 },
      });
    }

    // Add visual adaptations for low vision
    if (profile.minReadableTextSize > 16) {
      adaptations.push({
        mechanicId: mechanic.id,
        adaptationType: 'enlarge_text',
        parameters: { minSize: profile.minReadableTextSize },
      });
    }

    // Add contrast adaptations
    if (profile.minContrastRatio > 4.5) {
      adaptations.push({
        mechanicId: mechanic.id,
        adaptationType: 'high_contrast',
        parameters: { minRatio: profile.minContrastRatio },
      });
    }
  }

  return adaptations;
}

interface GenreAssetPalette {
  background: string;
  surface: string;
  accent: string;
  text: string;
}

const GENRE_ASSET_PALETTES: Record<Genre, GenreAssetPalette> = {
  puzzle: {
    background: '#13293d',
    surface: '#1f4e79',
    accent: '#f5b700',
    text: '#ffffff',
  },
  adventure: {
    background: '#10381e',
    surface: '#206a5d',
    accent: '#ffd166',
    text: '#ffffff',
  },
  strategy: {
    background: '#2f1847',
    surface: '#6247aa',
    accent: '#a7c957',
    text: '#ffffff',
  },
  simulation: {
    background: '#0f3b57',
    surface: '#1d5b79',
    accent: '#9bdaf1',
    text: '#ffffff',
  },
  narrative: {
    background: '#3d1f47',
    surface: '#6c3a7a',
    accent: '#ffd6ff',
    text: '#ffffff',
  },
};

function sanitizeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSvgDataUri(
  title: string,
  subtitle: string,
  palette: GenreAssetPalette,
): string {
  const safeTitle = sanitizeSvgText(title.slice(0, 50));
  const safeSubtitle = sanitizeSvgText(subtitle.slice(0, 60));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.background}" />
      <stop offset="100%" stop-color="${palette.surface}" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)" />
  <circle cx="1080" cy="160" r="130" fill="${palette.accent}" opacity="0.25" />
  <rect x="120" y="140" width="1040" height="420" rx="24" fill="${palette.background}" opacity="0.34" />
  <text x="640" y="320" text-anchor="middle" font-size="68" font-family="system-ui, sans-serif" fill="${palette.text}" font-weight="700">${safeTitle}</text>
  <text x="640" y="390" text-anchor="middle" font-size="32" font-family="system-ui, sans-serif" fill="${palette.text}" opacity="0.92">${safeSubtitle}</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Small inline WAV clips so generated games remain playable without
// deployment-specific static audio files.
const BACKGROUND_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

const AMBIENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAGsRQh4mI84eXhIaAY3vUuLi3K3gs+zL/XcPEx0MI88fNxROA4nxj+MP3b3f5eqZ+3QNxxvOIq8g+xV/BZPz6uRf3e3eK+lq+WMLXhptIm8hqRerB6r1YObR3T7eiedC90YJ2xjpIQ0iPxnOCcv38Odm3rHdAOYj9SEHPxdCIYgiuxroC/X5mOke30fdkeQP8/QEjBV6IOEiHRz2DSX8Vuv23wDdPeMI8cICwhOSHxYjYh31D1n+Ku3v4N3cB+IR740A5RGJHigjiR7lEY0AEe8H4t3c7+Aq7Vn+9Q9iHRYjkh/CE8ICCPE94wDd9t9W6yX89g0dHOEieiCMFfQED/OR5EfdHt+Y6fX56Au7GogiQiE/FyEHI/UA5rHdZt7w58v3zgk/GQ0i6SHbGEYJQveJ5z7e0d1g5qr1qwepF28hbSJeGmMLavkr6e3eX93q5JPzfwX7Fa8gziLHG3QNmfvl6r3fD92P44nxTgM3FM8fDCMTHXcPy/2z7K3g4txS4o3vGgFeEs4eJiNCHmsRAACV7r7h2twy4aLt5v5zEK4dHiNTH00TNQKJ8O3i9Nwx4Mnrsvx3DnEc8SJDIBsVZwSM8jnkMt1R3wXqgfptDBYboSITIdUWlgad9KLlk92R3lfoVfhWCqAZLyLCIXcYvgi69iXnF97z3cHmMvY1CBAYmiFPIgAa3Qrf+MHovt543UXlGPQLBmgW4iC5Im8b8QwM+3Tqht8f3ePjCvLbA6oUCiAAI8Mc+A4+/T7sbuDq3J7iC/CnAdYSER8jI/kd7xBz/xvud+HY3HfhG+5z/+8Q+R0jIxEf1hKnAQvwnuLq3G7gPuw+/fgOwxwAIwogqhTbAwry4+Mf3YbfdOoM+/EMbxu5IuIgaBYLBhj0ReV43b7ewejf+N0KABpPIpohEBg1CDL2webz3RfeJee69r4IdxjCIS8ioBlWClX4V+iR3pPdouWd9JYG1RYTIaEiFhttDIH6BepR3zLdOeSM8mcEGxVDIPEicRx3DrL8yesx4PTc7eKJ8DUCTRNTHx4jrh1zEOb+ou0y4drcvuGV7g==';

function generateVisualAssets(genre: Genre, title: string): AssetReference[] {
  const palette = GENRE_ASSET_PALETTES[genre];

  return [
    {
      id: generateId(),
      type: 'image',
      url: buildSvgDataUri(title, `${genre} background`, palette),
      altText: `${title} background scene`,
    },
    {
      id: generateId(),
      type: 'image',
      url: buildSvgDataUri('Accessible UI', `${genre} controls`, palette),
      altText: `${title} user interface elements`,
    },
    {
      id: generateId(),
      type: 'animation',
      url: buildSvgDataUri('Character Preview', `${genre} movement placeholder`, palette),
      altText: `${title} character animation`,
    },
  ];
}

function generateAudioAssets(genre: Genre, title: string): AssetReference[] {
  return [
    {
      id: generateId(),
      type: 'audio',
      url: BACKGROUND_AUDIO_DATA_URI,
      altText: `${title} background music`,
    },
    {
      id: generateId(),
      type: 'soundscape',
      url: AMBIENT_AUDIO_DATA_URI,
      altText: `${title} ambient soundscape`,
      spatialPosition: { azimuth: 0, elevation: 0, distance: 0.5 },
    },
  ];
}

// ---------------------------------------------------------------------------
// TemplateBasedLLMProvider (mock/default implementation)
// ---------------------------------------------------------------------------

export class TemplateBasedLLMProvider implements LLMProvider {
  async generateGameSpec(prompt: string, genre: Genre): Promise<GameSpec> {
    const template = GENRE_TEMPLATES[genre];
    const id = generateId();

    const rules: GameRule[] = template.ruleTemplates.map((r, i) => ({
      ...r,
      id: `rule-${id}-${i}`,
    }));

    const winConditions: WinCondition[] = template.winConditionTemplates.map((w, i) => ({
      ...w,
      id: `win-${id}-${i}`,
    }));

    const mechanics: GameMechanic[] = template.mechanicTemplates.map((m, i) => ({
      ...m,
      id: `mech-${id}-${i}`,
    }));

    return {
      id,
      genre,
      title: `${template.titlePrefix}: ${prompt.substring(0, 50)}`,
      description: prompt,
      createdAt: Date.now(),
      playerDescription: prompt,
      rules,
      winConditions,
      mechanics,
      interactionMappings: [], // filled in by the service
      visualAssets: [],        // filled in by the service
      audioAssets: [],         // filled in by the service
      accessibilityAdaptations: [],
      estimatedPlayTimeMinutes: template.estimatedPlayTime,
      difficultyLevel: 'adaptive',
    };
  }
}

// ---------------------------------------------------------------------------
// GameGeneratorService
// ---------------------------------------------------------------------------

/** 30-second generation time limit. */
const GENERATION_TIMEOUT_MS = 30_000;

/** 15-second modification time limit. */
const MODIFICATION_TIMEOUT_MS = 15_000;

export class GameGeneratorService {
  private llmProvider: LLMProvider;

  constructor(llmProvider?: LLMProvider) {
    this.llmProvider = llmProvider ?? new TemplateBasedLLMProvider();
  }

  /**
   * Generate a new game from a natural language description + accessibility profile.
   *
   * Pipeline: parse description → load profile → detect conflicts → construct prompt
   * → generate GameSpec → validate interactions → generate assets → progressive delivery.
   *
   * Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.8
   */
  async generateGame(request: GameGenerationRequest): Promise<GameGenerationResult> {
    const startTime = Date.now();

    // Validate input
    if (!request.playerDescription || request.playerDescription.trim().length === 0) {
      return {
        success: false,
        generationTimeMs: Date.now() - startTime,
        conflicts: [{ requirement1: 'description', requirement2: '', explanation: 'Game description cannot be empty' }],
      };
    }

    if (!request.profile.inputMethods || request.profile.inputMethods.length === 0) {
      return {
        success: false,
        generationTimeMs: Date.now() - startTime,
        conflicts: [{ requirement1: 'input_methods', requirement2: '', explanation: 'At least one input method is required in the accessibility profile' }],
      };
    }

    // Step 1: Detect conflicts in the description
    const conflictResult = this.detectConflicts(request.playerDescription);
    if (conflictResult.hasConflicts) {
      return {
        success: false,
        conflicts: conflictResult.conflicts,
        generationTimeMs: Date.now() - startTime,
      };
    }

    // Step 2: Detect genre
    const genre = detectGenre(request.playerDescription, request.preferredGenre);

    // Step 3: Generate GameSpec via LLM provider with timeout
    let gameSpec: GameSpec;
    try {
      gameSpec = await withTimeout(
        this.llmProvider.generateGameSpec(request.playerDescription, genre),
        GENERATION_TIMEOUT_MS,
      );
    } catch (error) {
      // Timeout or generation failure — return partial result
      return {
        success: false,
        generationTimeMs: Date.now() - startTime,
        conflicts: [{
          requirement1: 'generation',
          requirement2: '',
          explanation: error instanceof TimeoutError
            ? 'Game generation exceeded 30-second time limit'
            : `Game generation failed: ${(error as Error).message}`,
        }],
      };
    }

    // Step 4: Build interaction mappings compatible with player's input methods
    const mappings = buildInteractionMappings(gameSpec.mechanics, request.profile.inputMethods);
    gameSpec.interactionMappings = mappings;

    // Step 5: Validate interactions
    const validation = this.validateInteractions(gameSpec, request.profile.inputMethods);
    if (!validation.valid) {
      // Retry: try to adapt mechanics with alternative input methods
      for (const invalid of validation.invalidMappings) {
        const mechanic = gameSpec.mechanics.find((m) => m.id === invalid.mechanicId);
        if (mechanic) {
          // Add all player methods as alternatives so the mechanic becomes accessible
          mechanic.alternativeInputMethods = [
            ...new Set([...mechanic.alternativeInputMethods, ...request.profile.inputMethods]),
          ];
        }
      }
      // Rebuild mappings after adaptation
      gameSpec.interactionMappings = buildInteractionMappings(
        gameSpec.mechanics,
        request.profile.inputMethods,
      );
    }

    // Step 6: Generate assets
    gameSpec.visualAssets = generateVisualAssets(genre, gameSpec.title);
    gameSpec.audioAssets = generateAudioAssets(genre, gameSpec.title);

    // Step 7: Build accessibility adaptations
    gameSpec.accessibilityAdaptations = buildAccessibilityAdaptations(
      gameSpec.mechanics,
      request.profile,
    );

    // Step 8: Store the original player description
    gameSpec.playerDescription = request.playerDescription;

    return {
      success: true,
      gameSpec,
      generationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Modify an existing game based on player feedback.
   *
   * Requirement 1.4 — regenerate within 15 seconds.
   */
  async modifyGame(
    gameId: string,
    modifications: string,
    profile: AccessibilityProfile,
  ): Promise<GameGenerationResult> {
    const startTime = Date.now();

    if (!modifications || modifications.trim().length === 0) {
      return {
        success: false,
        generationTimeMs: Date.now() - startTime,
        conflicts: [{ requirement1: 'modifications', requirement2: '', explanation: 'Modification description cannot be empty' }],
      };
    }

    // Detect genre from modification text (or keep existing)
    const genre = detectGenre(modifications);

    try {
      const gameSpec = await withTimeout(
        this.llmProvider.generateGameSpec(modifications, genre),
        MODIFICATION_TIMEOUT_MS,
      );

      // Override the ID to match the original game
      gameSpec.id = gameId;

      // Build interaction mappings
      gameSpec.interactionMappings = buildInteractionMappings(
        gameSpec.mechanics,
        profile.inputMethods,
      );

      // Generate assets
      gameSpec.visualAssets = generateVisualAssets(genre, gameSpec.title);
      gameSpec.audioAssets = generateAudioAssets(genre, gameSpec.title);

      // Build accessibility adaptations
      gameSpec.accessibilityAdaptations = buildAccessibilityAdaptations(
        gameSpec.mechanics,
        profile,
      );

      gameSpec.playerDescription = modifications;

      return {
        success: true,
        gameSpec,
        generationTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        generationTimeMs: Date.now() - startTime,
        conflicts: [{
          requirement1: 'modification',
          requirement2: '',
          explanation: error instanceof TimeoutError
            ? 'Game modification exceeded 15-second time limit'
            : `Game modification failed: ${(error as Error).message}`,
        }],
      };
    }
  }

  /**
   * Validate that all interactions in a GameSpec are achievable with the
   * given input methods.
   *
   * Requirement 1.7 — every interaction mapping must reference an input
   * method present in the player's declared input methods.
   */
  validateInteractions(spec: GameSpec, inputMethods: InputMethod[]): ValidationResult {
    const invalidMappings: InvalidMapping[] = [];

    // Check each mechanic has at least one mapping
    for (const mechanic of spec.mechanics) {
      const mapping = spec.interactionMappings.find((m) => m.mechanicId === mechanic.id);

      if (!mapping) {
        // No mapping exists — check if any compatible method exists
        const compatible = findCompatibleInputMethod(
          mechanic.requiredInputMethods,
          mechanic.alternativeInputMethods,
          inputMethods,
        );
        if (!compatible) {
          invalidMappings.push({
            mechanicId: mechanic.id,
            inputMethod: mechanic.requiredInputMethods[0] ?? ('unknown' as InputMethod),
            reason: `No compatible input method found for mechanic "${mechanic.name}". Required: ${mechanic.requiredInputMethods.join(', ')}. Player has: ${inputMethods.join(', ')}`,
          });
        }
      } else if (!inputMethods.includes(mapping.inputMethod)) {
        // Mapping exists but uses an input method the player doesn't have
        invalidMappings.push({
          mechanicId: mechanic.id,
          inputMethod: mapping.inputMethod,
          reason: `Interaction mapping uses "${mapping.inputMethod}" which is not in the player's input methods: ${inputMethods.join(', ')}`,
        });
      }
    }

    return {
      valid: invalidMappings.length === 0,
      invalidMappings,
    };
  }

  /**
   * Detect conflicting requirements in a player's game description.
   *
   * Requirement 1.8 — identify conflicts and ask the player to clarify.
   */
  detectConflicts(description: string): ConflictDetectionResult {
    const lower = description.toLowerCase();
    const conflicts: ConflictDescription[] = [];

    for (const pair of CONFLICT_PAIRS) {
      const has1 = pair.keywords1.some((kw) => lower.includes(kw));
      const has2 = pair.keywords2.some((kw) => lower.includes(kw));

      if (has1 && has2) {
        const matched1 = pair.keywords1.find((kw) => lower.includes(kw))!;
        const matched2 = pair.keywords2.find((kw) => lower.includes(kw))!;
        conflicts.push({
          requirement1: matched1,
          requirement2: matched2,
          explanation: pair.explanation,
        });
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }
}

// ---------------------------------------------------------------------------
// Timeout utility
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
