import type { SupportedLanguage } from '../types/common';
import type { GameAction, GameEntityRef, GameState } from '../types/game';
import type {
  DialogueContext,
  DialogueTurn,
  CommandInterpretation,
  GameStateResponse,
  ClarificationRequest,
  AmbiguityDescription,
} from '../types/dialogue';

// ---------------------------------------------------------------------------
// NLU Provider abstraction (swappable between real NLU APIs and rule-based)
// ---------------------------------------------------------------------------

export interface NLUProvider {
  /** Classify intent from a tokenized utterance */
  classifyIntent(tokens: string[], language: SupportedLanguage): IntentClassification;
  /** Detect the language of an utterance */
  detectLanguage(utterance: string): SupportedLanguage;
}

export type IntentType = 'command' | 'query' | 'meta';

export interface IntentClassification {
  type: IntentType;
  action: string; // e.g. 'move', 'pick_up', 'use', 'attack', 'inventory', 'help'
  confidence: number;
}

// ---------------------------------------------------------------------------
// Command verb / query keyword maps per language
// ---------------------------------------------------------------------------

const COMMAND_VERBS: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    move: 'move', go: 'move', walk: 'move', run: 'move', travel: 'move',
    pick: 'pick_up', grab: 'pick_up', take: 'pick_up', collect: 'pick_up',
    use: 'use', activate: 'use', apply: 'use',
    attack: 'attack', fight: 'attack', hit: 'attack', strike: 'attack',
    open: 'open', close: 'close', drop: 'drop', throw: 'throw',
    talk: 'talk', speak: 'talk', equip: 'equip', wear: 'equip',
    examine: 'examine', look: 'examine', inspect: 'examine',
  },
  es: {
    mover: 'move', ir: 'move', caminar: 'move', correr: 'move',
    recoger: 'pick_up', tomar: 'pick_up', agarrar: 'pick_up',
    usar: 'use', activar: 'use', atacar: 'attack', golpear: 'attack',
    abrir: 'open', cerrar: 'close', soltar: 'drop', lanzar: 'throw',
    hablar: 'talk', equipar: 'equip', examinar: 'examine', mirar: 'examine',
  },
  fr: {
    déplacer: 'move', aller: 'move', marcher: 'move', courir: 'move',
    ramasser: 'pick_up', prendre: 'pick_up', attraper: 'pick_up',
    utiliser: 'use', activer: 'use', attaquer: 'attack', frapper: 'attack',
    ouvrir: 'open', fermer: 'close', lâcher: 'drop', lancer: 'throw',
    parler: 'talk', équiper: 'equip', examiner: 'examine', regarder: 'examine',
  },
  de: {
    bewegen: 'move', gehen: 'move', laufen: 'move', rennen: 'move',
    aufheben: 'pick_up', nehmen: 'pick_up', greifen: 'pick_up',
    benutzen: 'use', aktivieren: 'use', angreifen: 'attack', schlagen: 'attack',
    öffnen: 'open', schließen: 'close', fallen: 'drop', werfen: 'throw',
    sprechen: 'talk', ausrüsten: 'equip', untersuchen: 'examine', ansehen: 'examine',
  },
  ja: {
    移動: 'move', 行く: 'move', 歩く: 'move', 走る: 'move',
    拾う: 'pick_up', 取る: 'pick_up',
    使う: 'use', 攻撃: 'attack', 開く: 'open', 閉じる: 'close',
    落とす: 'drop', 投げる: 'throw', 話す: 'talk', 装備: 'equip',
    調べる: 'examine', 見る: 'examine',
  },
};

const QUERY_KEYWORDS: Record<SupportedLanguage, string[]> = {
  en: ['what', 'where', 'how', 'which', 'who', 'inventory', 'options', 'status', 'describe'],
  es: ['qué', 'dónde', 'cómo', 'cuál', 'quién', 'inventario', 'opciones', 'estado'],
  fr: ['quoi', 'où', 'comment', 'quel', 'qui', 'inventaire', 'options', 'état'],
  de: ['was', 'wo', 'wie', 'welche', 'wer', 'inventar', 'optionen', 'status'],
  ja: ['何', 'どこ', 'どう', 'どの', 'だれ', 'インベントリ', 'オプション', '状態'],
};

const META_KEYWORDS: Record<SupportedLanguage, Record<string, string>> = {
  en: { help: 'help', undo: 'undo', quit: 'quit', exit: 'quit', save: 'save', pause: 'pause' },
  es: { ayuda: 'help', deshacer: 'undo', salir: 'quit', guardar: 'save', pausa: 'pause' },
  fr: { aide: 'help', annuler: 'undo', quitter: 'quit', sauvegarder: 'save', pause: 'pause' },
  de: { hilfe: 'help', rückgängig: 'undo', beenden: 'quit', speichern: 'save', pause: 'pause' },
  ja: { ヘルプ: 'help', 元に戻す: 'undo', 終了: 'quit', セーブ: 'save', ポーズ: 'pause' },
};

const MULTI_STEP_SEPARATORS = ['and then', 'then', ' and '];

const PRONOUNS = ['there', 'that', 'it', 'them', 'this', 'here'];


// ---------------------------------------------------------------------------
// Language detection heuristics
// ---------------------------------------------------------------------------

const LANGUAGE_INDICATORS: Record<SupportedLanguage, RegExp[]> = {
  ja: [/[\u3040-\u309F]/, /[\u30A0-\u30FF]/, /[\u4E00-\u9FFF]/],
  es: [/\b(el|la|los|las|un|una|de|en|que|por|con|para|como|pero|más|este|esta)\b/i, /[áéíóúñ¿¡]/],
  fr: [/\b(le|la|les|un|une|de|du|des|en|que|pour|avec|dans|sur|est|sont|ce|cette)\b/i, /[àâçéèêëîïôùûü]/],
  de: [/\b(der|die|das|ein|eine|und|ist|von|zu|mit|auf|für|den|dem|des|nicht|sich)\b/i, /[äöüß]/],
  en: [/\b(the|is|are|was|were|have|has|do|does|will|would|can|could|my|your|this|that)\b/i],
};

function detectLanguage(utterance: string): SupportedLanguage {
  // Japanese characters are very distinctive — check first
  for (const pattern of LANGUAGE_INDICATORS.ja) {
    if (pattern.test(utterance)) return 'ja';
  }
  // Score each remaining language
  const scores: Partial<Record<SupportedLanguage, number>> = {};
  for (const lang of ['es', 'fr', 'de', 'en'] as SupportedLanguage[]) {
    scores[lang] = 0;
    for (const pattern of LANGUAGE_INDICATORS[lang]) {
      const matches = utterance.match(new RegExp(pattern, 'gi'));
      if (matches) scores[lang]! += matches.length;
    }
  }
  let best: SupportedLanguage = 'en';
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score! > bestScore) {
      bestScore = score!;
      best = lang as SupportedLanguage;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(utterance: string): string[] {
  return utterance
    .toLowerCase()
    .replace(/[.,!?;:'"()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// Rule-based NLU Provider
// ---------------------------------------------------------------------------

export class RuleBasedNLUProvider implements NLUProvider {
  classifyIntent(tokens: string[], language: SupportedLanguage): IntentClassification {
    // Check meta keywords first
    const metaMap = META_KEYWORDS[language] ?? META_KEYWORDS.en;
    for (const token of tokens) {
      if (metaMap[token]) {
        return { type: 'meta', action: metaMap[token], confidence: 0.9 };
      }
    }

    // Check query keywords
    const queryKws = QUERY_KEYWORDS[language] ?? QUERY_KEYWORDS.en;
    for (const token of tokens) {
      if (queryKws.includes(token)) {
        return { type: 'query', action: 'query', confidence: 0.85 };
      }
    }
    // Also check if utterance ends with '?'
    // (tokens won't have it, but we check the original via the action fallback)

    // Check command verbs (exact match first, then substring for CJK languages)
    const verbMap = COMMAND_VERBS[language] ?? COMMAND_VERBS.en;
    for (const token of tokens) {
      if (verbMap[token]) {
        return { type: 'command', action: verbMap[token], confidence: 0.85 };
      }
    }
    // Substring match — needed for languages like Japanese where verbs are
    // embedded in tokens without whitespace separation
    for (const token of tokens) {
      for (const [verb, action] of Object.entries(verbMap)) {
        if (token.includes(verb) && token !== verb) {
          return { type: 'command', action, confidence: 0.75 };
        }
      }
    }

    // Fallback: try English verbs regardless of detected language
    if (language !== 'en') {
      for (const token of tokens) {
        if (COMMAND_VERBS.en[token]) {
          return { type: 'command', action: COMMAND_VERBS.en[token], confidence: 0.6 };
        }
      }
    }

    return { type: 'command', action: 'unknown', confidence: 0.3 };
  }

  detectLanguage(utterance: string): SupportedLanguage {
    return detectLanguage(utterance);
  }
}

// ---------------------------------------------------------------------------
// Helper: extract target entity from tokens + game state
// ---------------------------------------------------------------------------

function extractTarget(
  tokens: string[],
  gameState: GameState,
  context: DialogueContext,
): GameEntityRef | null {
  // Try to match entity names from game state
  for (const entity of gameState.entities) {
    const entityNameLower = entity.name.toLowerCase();
    const entityWords = entityNameLower.split(/\s+/);
    // Check if all words of the entity name appear in the tokens
    if (entityWords.every((w) => tokens.includes(w))) {
      return entity;
    }
  }
  // Single-word partial match
  for (const entity of gameState.entities) {
    const entityNameLower = entity.name.toLowerCase();
    for (const token of tokens) {
      if (entityNameLower.includes(token) && token.length > 2) {
        return entity;
      }
    }
  }
  // Substring match for CJK — check if any token contains an entity name
  for (const entity of gameState.entities) {
    const entityNameLower = entity.name.toLowerCase();
    for (const token of tokens) {
      if (token.includes(entityNameLower) && entityNameLower.length > 0) {
        return entity;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: resolve pronouns from dialogue context
// ---------------------------------------------------------------------------

function resolvePronouns(
  tokens: string[],
  context: DialogueContext,
): string[] {
  return tokens.map((token) => {
    if (PRONOUNS.includes(token)) {
      const resolved = context.referenceMap.get(token);
      if (resolved) return resolved.name.toLowerCase();
      // Fallback: try generic "it"/"that" → most recent entity
      const lastTurn = [...context.history].reverse().find(
        (t) => t.referencedEntities.length > 0,
      );
      if (lastTurn && lastTurn.referencedEntities.length > 0) {
        const entity = lastTurn.referencedEntities[lastTurn.referencedEntities.length - 1];
        return entity.name.toLowerCase();
      }
    }
    return token;
  });
}

// ---------------------------------------------------------------------------
// Helper: decompose multi-step commands
// ---------------------------------------------------------------------------

function decomposeMultiStep(utterance: string): string[] {
  let parts = [utterance];
  for (const sep of MULTI_STEP_SEPARATORS) {
    const newParts: string[] = [];
    for (const part of parts) {
      const lowerPart = part.toLowerCase();
      let idx = 0;
      let lastSplit = 0;
      while (idx < lowerPart.length) {
        const sepIdx = lowerPart.indexOf(sep, idx);
        if (sepIdx === -1) break;
        // For " and " separator, make sure it's not "and then" (already handled)
        if (sep === ' and ' && lowerPart.substring(sepIdx).startsWith(' and then')) {
          idx = sepIdx + 1;
          continue;
        }
        const before = part.substring(lastSplit, sepIdx).trim();
        if (before) newParts.push(before);
        lastSplit = sepIdx + sep.length;
        idx = lastSplit;
      }
      const remaining = part.substring(lastSplit).trim();
      if (remaining) newParts.push(remaining);
    }
    parts = newParts.length > 0 ? newParts : parts;
  }
  return parts.filter((p) => p.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Helper: validate action against game state
// ---------------------------------------------------------------------------

interface ValidationFailure {
  reason: string;
  alternatives: GameAction[];
}

function validateAction(
  action: GameAction,
  gameState: GameState,
): ValidationFailure | null {
  // Check if target entity exists in game state
  const entityExists = gameState.entities.some((e) => e.id === action.target.id);
  if (!entityExists) {
    const alternatives = gameState.entities.slice(0, 3).map((e, i) => ({
      type: action.type,
      target: e,
      parameters: action.parameters,
      sequenceIndex: i,
    }));
    return {
      reason: `Cannot find "${action.target.name}" in the current area`,
      alternatives,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: build invalid action explanation with alternatives
// ---------------------------------------------------------------------------

function buildInvalidExplanation(
  action: GameAction,
  failure: ValidationFailure,
  language: SupportedLanguage,
): string {
  const prefixes: Record<SupportedLanguage, { invalid: string; try: string }> = {
    en: { invalid: "I can't do that.", try: 'You could try' },
    es: { invalid: 'No puedo hacer eso.', try: 'Podrías intentar' },
    fr: { invalid: 'Je ne peux pas faire ça.', try: 'Vous pourriez essayer' },
    de: { invalid: 'Das kann ich nicht tun.', try: 'Du könntest versuchen' },
    ja: { invalid: 'それはできません。', try: '代わりに試せること' },
  };
  const p = prefixes[language] ?? prefixes.en;
  const altNames = failure.alternatives.map((a) => `"${a.target.name}"`).join(', ');
  return `${p.invalid} ${failure.reason}. ${p.try}: ${altNames}`;
}

// ---------------------------------------------------------------------------
// Helper: build query response from game state
// ---------------------------------------------------------------------------

function buildQueryResponse(
  tokens: string[],
  gameState: GameState,
  language: SupportedLanguage,
): GameStateResponse {
  const joined = tokens.join(' ');

  // Inventory query
  if (joined.includes('inventory') || joined.includes('items') || joined.includes('inventario') || joined.includes('inventaire') || joined.includes('inventar') || joined.includes('インベントリ')) {
    const items = gameState.entities.filter((e) => e.type === 'item');
    const itemNames = items.map((e) => e.name).join(', ');
    const answer = items.length > 0
      ? `You have: ${itemNames}`
      : 'Your inventory is empty.';
    return { answer, referencedEntities: items, confidence: 0.9 };
  }

  // Options / what can I do
  if (joined.includes('option') || joined.includes('can i') || joined.includes('what') || joined.includes('opciones') || joined.includes('オプション')) {
    const entities = gameState.entities.slice(0, 5);
    const names = entities.map((e) => e.name).join(', ');
    const answer = `Available targets: ${names}. Current area: ${gameState.currentSegment}.`;
    return { answer, referencedEntities: entities, confidence: 0.8 };
  }

  // Where am I
  if (joined.includes('where') || joined.includes('dónde') || joined.includes('où') || joined.includes('wo') || joined.includes('どこ')) {
    return {
      answer: `You are in: ${gameState.currentSegment}.`,
      referencedEntities: [],
      confidence: 0.85,
    };
  }

  // Generic fallback
  const entities = gameState.entities.slice(0, 3);
  return {
    answer: `Current area: ${gameState.currentSegment}. Nearby: ${entities.map((e) => e.name).join(', ')}.`,
    referencedEntities: entities,
    confidence: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Helper: update reference map from actions
// ---------------------------------------------------------------------------

function updateReferenceMap(
  context: DialogueContext,
  entities: GameEntityRef[],
): void {
  if (entities.length === 0) return;
  const last = entities[entities.length - 1];
  // Map pronouns to the most recently referenced entity
  context.referenceMap.set('it', last);
  context.referenceMap.set('that', last);
  context.referenceMap.set('this', last);
  context.referenceMap.set('them', last);
  // Location-type entities also map to "there"/"here"
  if (last.type === 'location' || last.type === 'area' || last.type === 'room') {
    context.referenceMap.set('there', last);
    context.referenceMap.set('here', last);
  }
}

// ---------------------------------------------------------------------------
// NL Controller Service
// ---------------------------------------------------------------------------

export class NLControllerService {
  private nluProvider: NLUProvider;

  constructor(nluProvider?: NLUProvider) {
    this.nluProvider = nluProvider ?? new RuleBasedNLUProvider();
  }

  /**
   * Interpret a player utterance in context.
   * Pipeline: tokenize → resolve pronouns → classify intent →
   *   decompose multi-step → validate against game state → execute or clarify
   */
  async interpretCommand(
    utterance: string,
    context: DialogueContext,
    gameState: GameState,
  ): Promise<CommandInterpretation> {
    const trimmed = utterance.trim();
    if (!trimmed) {
      return {
        actions: [],
        confidence: 0,
        requiresClarification: true,
        clarificationQuestion: 'I didn\'t catch that. Could you say that again?',
      };
    }

    // Detect language (use context language if already set, otherwise detect)
    const language = context.language ?? this.nluProvider.detectLanguage(trimmed);

    // Decompose multi-step commands
    const steps = decomposeMultiStep(trimmed);

    const allActions: GameAction[] = [];
    let overallConfidence = 1.0;
    let sequenceIndex = 0;

    for (const step of steps) {
      const tokens = tokenize(step);
      if (tokens.length === 0) continue;

      // Resolve pronouns
      const resolvedTokens = resolvePronouns(tokens, context);

      // Classify intent
      const intent = this.nluProvider.classifyIntent(resolvedTokens, language);

      // Handle query intent — delegate to queryGameState
      if (intent.type === 'query') {
        const response = await this.queryGameState(step, context, gameState);
        // Record in dialogue history
        context.history.push({
          speaker: 'player',
          utterance: step,
          timestamp: Date.now(),
          referencedEntities: response.referencedEntities,
        });
        context.history.push({
          speaker: 'system',
          utterance: response.answer,
          timestamp: Date.now(),
          referencedEntities: response.referencedEntities,
        });
        // Return as a "no-action" interpretation with the answer as clarification
        return {
          actions: [],
          confidence: response.confidence,
          requiresClarification: false,
          clarificationQuestion: response.answer,
        };
      }

      // Handle meta intent
      if (intent.type === 'meta') {
        const metaAction: GameAction = {
          type: `meta_${intent.action}`,
          target: { id: 'system', type: 'system', name: 'system' },
          parameters: {},
          sequenceIndex,
        };
        allActions.push(metaAction);
        sequenceIndex++;
        overallConfidence = Math.min(overallConfidence, intent.confidence);
        continue;
      }

      // Command intent — extract target
      const target = extractTarget(resolvedTokens, gameState, context);

      if (!target) {
        // Ambiguous — can't find target
        const entityNames = gameState.entities.slice(0, 5).map((e) => `"${e.name}"`).join(', ');
        return {
          actions: allActions,
          confidence: intent.confidence * 0.5,
          requiresClarification: true,
          clarificationQuestion: `I'm not sure what you're referring to. Did you mean one of these: ${entityNames}?`,
        };
      }

      const action: GameAction = {
        type: intent.action,
        target,
        parameters: {},
        sequenceIndex,
      };

      // Validate against game state
      const failure = validateAction(action, gameState);
      if (failure) {
        const explanation = buildInvalidExplanation(action, failure, language);
        // Record in history
        context.history.push({
          speaker: 'player',
          utterance: trimmed,
          timestamp: Date.now(),
          referencedEntities: [target],
        });
        context.history.push({
          speaker: 'system',
          utterance: explanation,
          timestamp: Date.now(),
          referencedEntities: failure.alternatives.map((a) => a.target),
        });
        return {
          actions: failure.alternatives,
          confidence: intent.confidence * 0.4,
          requiresClarification: true,
          clarificationQuestion: explanation,
        };
      }

      allActions.push(action);
      overallConfidence = Math.min(overallConfidence, intent.confidence);
      sequenceIndex++;
    }

    // Update dialogue context
    const referencedEntities = allActions
      .filter((a) => a.target.id !== 'system')
      .map((a) => a.target);

    context.history.push({
      speaker: 'player',
      utterance: trimmed,
      timestamp: Date.now(),
      referencedEntities,
    });

    updateReferenceMap(context, referencedEntities);

    return {
      actions: allActions,
      confidence: overallConfidence,
      requiresClarification: false,
    };
  }

  /**
   * Query game state via natural language.
   */
  async queryGameState(
    question: string,
    context: DialogueContext,
    gameState: GameState,
  ): Promise<GameStateResponse> {
    const language = context.language ?? this.nluProvider.detectLanguage(question);
    const tokens = tokenize(question);
    const resolvedTokens = resolvePronouns(tokens, context);
    const response = buildQueryResponse(resolvedTokens, gameState, language);

    // Update context
    updateReferenceMap(context, response.referencedEntities);

    return response;
  }

  /**
   * Generate a clarification request for ambiguous commands.
   */
  requestClarification(ambiguity: AmbiguityDescription): ClarificationRequest {
    const options = ambiguity.possibleInterpretations.length > 0
      ? ambiguity.possibleInterpretations
      : ambiguity.conflictingEntities.map((e) => e.name);

    return {
      question: `I'm not sure what you mean by "${ambiguity.utterance}". Did you mean one of these?`,
      options,
      context: ambiguity.conflictingEntities.map((e) => e.name).join(', '),
    };
  }
}
