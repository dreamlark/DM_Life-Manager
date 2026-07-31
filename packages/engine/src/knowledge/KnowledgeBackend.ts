import { embed, cosine } from './embed';
import * as repo from '../modules/notes/repository';

/**
 * KnowledgeBackend 端口。
 * 真实向量检索已由本地确定性 embed + 余弦相似度实现（详见 embed.ts 说明）。
 * 摄入（写入 embedding）在 notes/command 中完成，这里只负责「检索」。
 */
export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface KnowledgeBackendPort {
  semanticSearch(query: string, k?: number): Promise<SearchHit[]>;
}

function snippet(body: string, max = 80): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

class LocalAdapter implements KnowledgeBackendPort {
  async semanticSearch(query: string, k = 5): Promise<SearchHit[]> {
    const qvec = embed(query);
    const rows = repo.listEmbeddedNotes();
    const hits: SearchHit[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: snippet(r.bodyMarkdown),
      score: cosine(qvec, JSON.parse(r.embedding) as number[]),
    }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

export const knowledgeBackend: KnowledgeBackendPort = new LocalAdapter();
