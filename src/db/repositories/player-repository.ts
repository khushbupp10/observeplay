import { getPool } from '../pool';
import type { Player, AccessibilityProfile } from '../../types';

export class PlayerRepository {
  async createPlayer(
    player: Omit<Player, 'profile' | 'consentState' | 'adaptationHistory' | 'companionModel'>
  ): Promise<string> {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO players (id, created_at, preferred_language, preferred_communication_channel)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [player.id, player.createdAt, player.preferredLanguage, player.preferredCommunicationChannel]
    );
    return result.rows[0].id;
  }

  async getPlayerById(id: string): Promise<Player | null> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.created_at, p.preferred_language, p.preferred_communication_channel,
              ap.profile_data, ap.version AS profile_version, ap.last_updated AS profile_last_updated,
              cs.consents, cs.last_updated AS consent_last_updated,
              cpm.mechanic_performance, cpm.last_synced_with_profile_learner
       FROM players p
       LEFT JOIN accessibility_profiles ap ON ap.player_id = p.id
       LEFT JOIN consent_states cs ON cs.player_id = p.id
       LEFT JOIN companion_player_models cpm ON cpm.player_id = p.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapRowToPlayer(result.rows[0]);
  }

  async updatePlayer(
    id: string,
    updates: { preferredLanguage?: string; preferredCommunicationChannel?: string }
  ): Promise<void> {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.preferredLanguage !== undefined) {
      setClauses.push(`preferred_language = $${idx++}`);
      values.push(updates.preferredLanguage);
    }
    if (updates.preferredCommunicationChannel !== undefined) {
      setClauses.push(`preferred_communication_channel = $${idx++}`);
      values.push(updates.preferredCommunicationChannel);
    }

    if (setClauses.length === 0) return;
    values.push(id);
    await pool.query(
      `UPDATE players SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      values
    );
  }

  async deletePlayer(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM players WHERE id = $1', [id]);
  }

  // --- Accessibility Profile ---

  async upsertProfile(profile: AccessibilityProfile): Promise<void> {
    const pool = getPool();
    const { playerId, version, lastUpdated, ...rest } = profile;
    await pool.query(
      `INSERT INTO accessibility_profiles (player_id, version, last_updated, profile_data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id) DO UPDATE
       SET version = $2, last_updated = $3, profile_data = $4`,
      [playerId, version, lastUpdated, JSON.stringify(rest)]
    );
  }

  async getProfile(playerId: string): Promise<AccessibilityProfile | null> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT player_id, version, last_updated, profile_data FROM accessibility_profiles WHERE player_id = $1',
      [playerId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRowToProfile(result.rows[0]);
  }

  async deleteProfile(playerId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM accessibility_profiles WHERE player_id = $1', [playerId]);
  }

  // --- Helpers ---

  private mapRowToProfile(row: Record<string, unknown>): AccessibilityProfile {
    const data = row.profile_data as Record<string, unknown>;
    return {
      playerId: row.player_id as string,
      version: row.version as number,
      lastUpdated: Number(row.last_updated),
      ...data,
    } as AccessibilityProfile;
  }

  private mapRowToPlayer(row: Record<string, unknown>): Player {
    const profile: AccessibilityProfile | undefined = row.profile_data
      ? this.mapRowToProfile(row)
      : undefined;

    const consentState = row.consents
      ? {
          playerId: row.id as string,
          consents: row.consents as Player['consentState']['consents'],
          lastUpdated: Number(row.consent_last_updated),
        }
      : { playerId: row.id as string, consents: {} as Player['consentState']['consents'], lastUpdated: 0 };

    const adaptationHistory = { playerId: row.id as string, entries: [] };

    const companionModel = row.mechanic_performance
      ? {
          playerId: row.id as string,
          mechanicPerformance: row.mechanic_performance as Player['companionModel']['mechanicPerformance'],
          lastSyncedWithProfileLearner: Number(row.last_synced_with_profile_learner),
        }
      : { playerId: row.id as string, mechanicPerformance: [], lastSyncedWithProfileLearner: 0 };

    return {
      id: row.id as string,
      createdAt: Number(row.created_at),
      profile: profile as AccessibilityProfile,
      consentState,
      adaptationHistory,
      companionModel,
      preferredLanguage: row.preferred_language as Player['preferredLanguage'],
      preferredCommunicationChannel: row.preferred_communication_channel as Player['preferredCommunicationChannel'],
    };
  }
}
