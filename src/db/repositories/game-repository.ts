import { getPool } from '../pool';
import type { GameSpec } from '../../types';

export interface GameSessionRow {
  id: string;
  playerId: string;
  gameSpecId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  sessionData: Record<string, unknown>;
}

export class GameRepository {
  // --- GameSpec ---

  async createGameSpec(spec: GameSpec): Promise<string> {
    const pool = getPool();
    const {
      id, genre, title, description, playerDescription, createdAt,
      estimatedPlayTimeMinutes, difficultyLevel,
      rules, winConditions, mechanics, interactionMappings,
      visualAssets, audioAssets, accessibilityAdaptations,
    } = spec;

    const specData = {
      rules, winConditions, mechanics, interactionMappings,
      visualAssets, audioAssets, accessibilityAdaptations,
    };

    const result = await pool.query(
      `INSERT INTO game_specs (id, genre, title, description, player_description, created_at,
         spec_data, estimated_play_time_minutes, difficulty_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [id, genre, title, description, playerDescription, createdAt,
       JSON.stringify(specData), estimatedPlayTimeMinutes, difficultyLevel]
    );
    return result.rows[0].id;
  }

  async getGameSpecById(id: string): Promise<GameSpec | null> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM game_specs WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToGameSpec(result.rows[0]);
  }

  async deleteGameSpec(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM game_specs WHERE id = $1', [id]);
  }

  // --- GameSession ---

  async createSession(session: GameSessionRow): Promise<string> {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO game_sessions (id, player_id, game_spec_id, started_at, ended_at, status, session_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [session.id, session.playerId, session.gameSpecId, session.startedAt,
       session.endedAt, session.status, JSON.stringify(session.sessionData)]
    );
    return result.rows[0].id;
  }

  async getSessionById(id: string): Promise<GameSessionRow | null> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToSession(result.rows[0]);
  }

  async getSessionsByPlayer(playerId: string): Promise<GameSessionRow[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM game_sessions WHERE player_id = $1 ORDER BY started_at DESC',
      [playerId]
    );
    return result.rows.map((r: Record<string, unknown>) => this.mapRowToSession(r));
  }

  async updateSessionStatus(id: string, status: GameSessionRow['status'], endedAt?: number): Promise<void> {
    const pool = getPool();
    if (endedAt !== undefined) {
      await pool.query(
        'UPDATE game_sessions SET status = $1, ended_at = $2 WHERE id = $3',
        [status, endedAt, id]
      );
    } else {
      await pool.query('UPDATE game_sessions SET status = $1 WHERE id = $2', [status, id]);
    }
  }

  // --- Helpers ---

  private mapRowToGameSpec(row: Record<string, unknown>): GameSpec {
    const specData = row.spec_data as Record<string, unknown>;
    return {
      id: row.id as string,
      genre: row.genre as GameSpec['genre'],
      title: row.title as string,
      description: row.description as string,
      playerDescription: row.player_description as string,
      createdAt: Number(row.created_at),
      estimatedPlayTimeMinutes: row.estimated_play_time_minutes as number,
      difficultyLevel: row.difficulty_level as GameSpec['difficultyLevel'],
      rules: specData.rules as GameSpec['rules'],
      winConditions: specData.winConditions as GameSpec['winConditions'],
      mechanics: specData.mechanics as GameSpec['mechanics'],
      interactionMappings: specData.interactionMappings as GameSpec['interactionMappings'],
      visualAssets: specData.visualAssets as GameSpec['visualAssets'],
      audioAssets: specData.audioAssets as GameSpec['audioAssets'],
      accessibilityAdaptations: specData.accessibilityAdaptations as GameSpec['accessibilityAdaptations'],
    };
  }

  private mapRowToSession(row: Record<string, unknown>): GameSessionRow {
    return {
      id: row.id as string,
      playerId: row.player_id as string,
      gameSpecId: row.game_spec_id as string,
      startedAt: Number(row.started_at),
      endedAt: row.ended_at ? Number(row.ended_at) : null,
      status: row.status as GameSessionRow['status'],
      sessionData: (row.session_data ?? {}) as Record<string, unknown>,
    };
  }
}
