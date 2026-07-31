import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { initDb, dbPath } from '../../db/client';
import { migrate } from '../../db/migrate';
import { seedDomains } from '../../db/seed';
import * as notesCommand from '../../modules/notes/command';
import { knowledgeBackend } from '../KnowledgeBackend';

describe('KnowledgeBackend 真实向量检索', () => {
  beforeAll(async () => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
    await initDb();
    migrate();
    seedDomains();
    // 摄入 3 条不同主题笔记（摄入时即生成 embedding，不再是占位）
    notesCommand.ingestNote({
      title: '咖啡冲泡技巧',
      bodyMarkdown: '手冲咖啡需要注意水温和研磨度，早晨喝咖啡能提神',
      kind: 'notebook',
    });
    notesCommand.ingestNote({
      title: '火箭发射原理',
      bodyMarkdown: '火箭依靠发动机产生推力，克服重力进入轨道',
      kind: 'notebook',
    });
    notesCommand.ingestNote({
      title: '咖啡与工作效率',
      bodyMarkdown: '上班前喝一杯咖啡有助于保持清醒，提升工作专注',
      kind: 'notebook',
    });
  });

  it('摄入即生成 embedding，语义检索把最相关排前、最无关排后', async () => {
    const hits = await knowledgeBackend.semanticSearch('咖啡 提神 早晨', 5);
    expect(hits).toHaveLength(3);
    const titles = hits.map((h) => h.title);
    // 火箭主题最不相关，应排在末尾；首条不应是火箭
    expect(titles[titles.length - 1]).toBe('火箭发射原理');
    expect(hits[0].title).not.toBe('火箭发射原理');
    // 首条应是共享「咖啡+提神+早晨」最多的笔记
    expect(hits[0].title).toBe('咖啡冲泡技巧');
  });

  it('k 限制返回数量', async () => {
    const hits = await knowledgeBackend.semanticSearch('咖啡', 1);
    expect(hits).toHaveLength(1);
  });

  it('分数按相似度降序', async () => {
    const hits = await knowledgeBackend.semanticSearch('咖啡 提神', 5);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it('仅对已摄入（有 embedding）的笔记检索；无关查询仍全部参与排序', async () => {
    const hits = await knowledgeBackend.semanticSearch('足球 草坪 进球', 5);
    expect(hits).toHaveLength(3);
    // 分数都偏低（无足球内容），但检索不报错、排序稳定
    expect(hits.every((h) => h.score >= 0 && h.score <= 1)).toBe(true);
  });
});
