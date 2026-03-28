import { getPool } from '../pool';
import type { Paper, PaperMetadata, PaperSummary, ChunkEmbedding } from '../../types';

export class PaperRepository {
  async createPaper(paper: Paper): Promise<string> {
    const pool = getPool();
    const embeddingStr = paper.fullTextEmbedding.length > 0
      ? `[${paper.fullTextEmbedding.join(',')}]`
      : null;

    const result = await pool.query(
      `INSERT INTO papers (id, title, authors, abstract, publication_date, journal, doi,
         references, summary, full_text_embedding, indexed_at, status, failed_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11, $12, $13)
       RETURNING id`,
      [
        paper.id,
        paper.metadata.title,
        JSON.stringify(paper.metadata.authors),
        paper.metadata.abstract,
        paper.metadata.publicationDate ?? null,
        paper.metadata.journal ?? null,
        paper.metadata.doi ?? null,
        JSON.stringify(paper.metadata.references),
        JSON.stringify(paper.summary),
        embeddingStr,
        paper.indexedAt,
        paper.status,
        JSON.stringify(paper.failedFields),
      ]
    );

    // Insert chunk embeddings
    if (paper.chunkEmbeddings.length > 0) {
      await this.insertChunks(paper.id, paper.chunkEmbeddings);
    }

    return result.rows[0].id;
  }

  async getPaperById(id: string): Promise<Paper | null> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM papers WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;

    const chunks = await this.getChunksByPaperId(id);
    return this.mapRowToPaper(result.rows[0], chunks);
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM papers WHERE doi = $1', [doi]);
    if (result.rows.length === 0) return null;

    const chunks = await this.getChunksByPaperId(result.rows[0].id as string);
    return this.mapRowToPaper(result.rows[0], chunks);
  }

  async findByTitleSimilarity(title: string): Promise<Paper[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM papers
       WHERE to_tsvector('english', title) @@ plainto_tsquery('english', $1)
       LIMIT 10`,
      [title]
    );
    return Promise.all(
      result.rows.map(async (row: Record<string, unknown>) => {
        const chunks = await this.getChunksByPaperId(row.id as string);
        return this.mapRowToPaper(row, chunks);
      })
    );
  }

  async searchByEmbedding(embedding: number[], limit: number = 10): Promise<Paper[]> {
    const pool = getPool();
    const embeddingStr = `[${embedding.join(',')}]`;
    const result = await pool.query(
      `SELECT *, full_text_embedding <=> $1::vector AS distance
       FROM papers
       WHERE full_text_embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT $2`,
      [embeddingStr, limit]
    );
    return Promise.all(
      result.rows.map(async (row: Record<string, unknown>) => {
        const chunks = await this.getChunksByPaperId(row.id as string);
        return this.mapRowToPaper(row, chunks);
      })
    );
  }

  async searchChunksByEmbedding(
    embedding: number[],
    limit: number = 10
  ): Promise<Array<ChunkEmbedding & { paperId: string }>> {
    const pool = getPool();
    const embeddingStr = `[${embedding.join(',')}]`;
    const result = await pool.query(
      `SELECT paper_id, section_title, text, start_offset, end_offset
       FROM paper_chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $2`,
      [embeddingStr, limit]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      paperId: row.paper_id as string,
      sectionTitle: row.section_title as string,
      text: row.text as string,
      embedding: [],
      startOffset: row.start_offset as number,
      endOffset: row.end_offset as number,
    }));
  }

  async deletePaper(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM papers WHERE id = $1', [id]);
  }

  // --- Chunk helpers ---

  private async insertChunks(paperId: string, chunks: ChunkEmbedding[]): Promise<void> {
    const pool = getPool();
    for (const chunk of chunks) {
      const embeddingStr = chunk.embedding.length > 0
        ? `[${chunk.embedding.join(',')}]`
        : null;
      await pool.query(
        `INSERT INTO paper_chunks (paper_id, section_title, text, embedding, start_offset, end_offset)
         VALUES ($1, $2, $3, $4::vector, $5, $6)`,
        [paperId, chunk.sectionTitle, chunk.text, embeddingStr, chunk.startOffset, chunk.endOffset]
      );
    }
  }

  private async getChunksByPaperId(paperId: string): Promise<ChunkEmbedding[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT section_title, text, start_offset, end_offset FROM paper_chunks WHERE paper_id = $1 ORDER BY start_offset',
      [paperId]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      sectionTitle: row.section_title as string,
      text: row.text as string,
      embedding: [],
      startOffset: row.start_offset as number,
      endOffset: row.end_offset as number,
    }));
  }

  // --- Mapping ---

  private mapRowToPaper(row: Record<string, unknown>, chunks: ChunkEmbedding[]): Paper {
    const metadata: PaperMetadata = {
      title: row.title as string,
      authors: row.authors as string[],
      abstract: row.abstract as string,
      publicationDate: (row.publication_date as string) ?? undefined,
      journal: (row.journal as string) ?? undefined,
      doi: (row.doi as string) ?? undefined,
      references: row.references as string[],
    };

    const summary = row.summary as PaperSummary;

    return {
      id: row.id as string,
      metadata,
      summary,
      fullTextEmbedding: [],
      chunkEmbeddings: chunks,
      indexedAt: Number(row.indexed_at),
      status: row.status as Paper['status'],
      failedFields: row.failed_fields as string[],
    };
  }
}
