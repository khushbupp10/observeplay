import { getPool } from '../pool';
import type { BarrierEvent } from '../../types';
import type { AdaptationHistoryEntry } from '../../types';

export class BarrierRepository {
  // --- Barrier Events ---

  async createBarrierEvent(event: BarrierEvent): Promise<string> {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO barrier_events
         (id, session_id, player_id, timestamp, type, severity,
          detected_element, detected_value, threshold_value,
          adaptation, adaptation_applied_at, adaptation_undone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        event.id,
        event.sessionId,
        event.playerId,
        event.timestamp,
        event.type,
        event.severity,
        JSON.stringify(event.detectedElement),
        JSON.stringify(event.detectedValue),
        JSON.stringify(event.thresholdValue),
        event.adaptation ? JSON.stringify(event.adaptation) : null,
        event.adaptationAppliedAt ?? null,
        event.adaptationUndone,
      ]
    );
    return result.rows[0].id;
  }

  async getBarrierEventsBySession(sessionId: string): Promise<BarrierEvent[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM barrier_events WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId]
    );
    return result.rows.map((r: Record<string, unknown>) => this.mapRowToBarrierEvent(r));
  }

  async getBarrierEventsByPlayer(playerId: string): Promise<BarrierEvent[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM barrier_events WHERE player_id = $1 ORDER BY timestamp ASC',
      [playerId]
    );
    return result.rows.map((r: Record<string, unknown>) => this.mapRowToBarrierEvent(r));
  }

  async updateAdaptationUndone(eventId: string, undone: boolean): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE barrier_events SET adaptation_undone = $1 WHERE id = $2',
      [undone, eventId]
    );
  }

  // --- Adaptation History ---

  async createAdaptationEntry(entry: AdaptationHistoryEntry & { playerId: string }): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO adaptation_history (player_id, barrier_type, adaptation_type, session_id, timestamp, accepted)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.playerId, entry.barrierType, entry.adaptationType, entry.sessionId, entry.timestamp, entry.accepted]
    );
  }

  async getAdaptationHistory(playerId: string): Promise<AdaptationHistoryEntry[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM adaptation_history WHERE player_id = $1 ORDER BY timestamp ASC',
      [playerId]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      barrierType: row.barrier_type as string,
      adaptationType: row.adaptation_type as string,
      sessionId: row.session_id as string,
      timestamp: Number(row.timestamp),
      accepted: row.accepted as boolean,
    }));
  }

  async getAdaptationHistoryByTypes(
    playerId: string,
    barrierType: string,
    adaptationType: string
  ): Promise<AdaptationHistoryEntry[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM adaptation_history
       WHERE player_id = $1 AND barrier_type = $2 AND adaptation_type = $3
       ORDER BY timestamp ASC`,
      [playerId, barrierType, adaptationType]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      barrierType: row.barrier_type as string,
      adaptationType: row.adaptation_type as string,
      sessionId: row.session_id as string,
      timestamp: Number(row.timestamp),
      accepted: row.accepted as boolean,
    }));
  }

  // --- Helpers ---

  private mapRowToBarrierEvent(row: Record<string, unknown>): BarrierEvent {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      playerId: row.player_id as string,
      timestamp: Number(row.timestamp),
      type: row.type as BarrierEvent['type'],
      severity: row.severity as BarrierEvent['severity'],
      detectedElement: row.detected_element as BarrierEvent['detectedElement'],
      detectedValue: row.detected_value,
      thresholdValue: row.threshold_value,
      adaptation: (row.adaptation as BarrierEvent['adaptation']) ?? undefined,
      adaptationAppliedAt: row.adaptation_applied_at ? Number(row.adaptation_applied_at) : undefined,
      adaptationUndone: row.adaptation_undone as boolean,
    };
  }
}
