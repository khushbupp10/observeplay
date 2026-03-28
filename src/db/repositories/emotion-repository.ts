import { getPool } from '../pool';
import type { EmotionStateLog } from '../../types';

export class EmotionRepository {
  async createLog(log: EmotionStateLog): Promise<string> {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO emotion_state_logs (session_id, player_id, entries)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [log.sessionId, log.playerId, JSON.stringify(log.entries)]
    );
    return result.rows[0].id;
  }

  async getLogBySession(sessionId: string): Promise<EmotionStateLog | null> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM emotion_state_logs WHERE session_id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRowToLog(result.rows[0]);
  }

  async getLogsByPlayer(playerId: string): Promise<EmotionStateLog[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM emotion_state_logs WHERE player_id = $1 ORDER BY session_id',
      [playerId]
    );
    return result.rows.map((r: Record<string, unknown>) => this.mapRowToLog(r));
  }

  async appendEntries(
    sessionId: string,
    entries: EmotionStateLog['entries']
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE emotion_state_logs
       SET entries = entries || $1::jsonb
       WHERE session_id = $2`,
      [JSON.stringify(entries), sessionId]
    );
  }

  async deleteLogsByPlayer(playerId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM emotion_state_logs WHERE player_id = $1', [playerId]);
  }

  // --- Helpers ---

  private mapRowToLog(row: Record<string, unknown>): EmotionStateLog {
    return {
      sessionId: row.session_id as string,
      playerId: row.player_id as string,
      entries: row.entries as EmotionStateLog['entries'],
    };
  }
}
