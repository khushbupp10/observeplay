import { getPool } from '../pool';
import type { CompanionPlayerModel } from '../../types';

export class CompanionRepository {
  async upsertModel(model: CompanionPlayerModel): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO companion_player_models (player_id, mechanic_performance, last_synced_with_profile_learner)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE
       SET mechanic_performance = $2, last_synced_with_profile_learner = $3`,
      [model.playerId, JSON.stringify(model.mechanicPerformance), model.lastSyncedWithProfileLearner]
    );
  }

  async getModel(playerId: string): Promise<CompanionPlayerModel | null> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM companion_player_models WHERE player_id = $1',
      [playerId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRowToModel(result.rows[0]);
  }

  async deleteModel(playerId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM companion_player_models WHERE player_id = $1', [playerId]);
  }

  // --- Helpers ---

  private mapRowToModel(row: Record<string, unknown>): CompanionPlayerModel {
    return {
      playerId: row.player_id as string,
      mechanicPerformance: row.mechanic_performance as CompanionPlayerModel['mechanicPerformance'],
      lastSyncedWithProfileLearner: Number(row.last_synced_with_profile_learner),
    };
  }
}
