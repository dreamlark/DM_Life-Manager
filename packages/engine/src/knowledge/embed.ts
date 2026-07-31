/**
 * 本地确定性向量嵌入（lexical embedding / 哈希技巧）。
 *
 * 设计取舍：沙箱无网络下载神经网络模型（transformers.js / 外部 API 均不可达），
 * 这里用离线、零依赖、可复现的词袋哈希向量 + L2 归一化，配合余弦相似度做"真实"
 * 向量检索。中文按单字 + 二元组切分，英文/数字按词切分，能捕捉词面重叠语义。
 *
 * 该模块不依赖任何外部资源，`embed()` 可整体替换为神经网络 embedder
 * （如 all-MiniLM / bge-small-zh），其余检索链路无需改动。
 */

export const EMBED_DIM = 256;

/** 对文本生成固定维度、L2 归一化的向量 */
export function embed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of tokenize(text)) {
    const idx = hashToken(tok) % EMBED_DIM;
    vec[idx] = (vec[idx] ?? 0) + 1; // 词频累加（TF）
  }
  // L2 归一化：归一化后两向量点积即余弦相似度
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] = (vec[i] ?? 0) / norm;
  }
  return vec;
}

/**
 * 余弦相似度。输入向量均已 L2 归一化时，点积即余弦；
 * 为健壮性仍按定义计算 dot / (|a|*|b|)。
 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  // 英文 / 数字词（小写）
  const en = text.toLowerCase().match(/[a-z0-9]+/g);
  if (en) out.push(...en);
  // 中文按单字 + 相邻二元组切分（提升中文语义重叠召回）
  const cjk = text.match(/[一-鿿]/g);
  if (cjk) {
    out.push(...cjk);
    for (let i = 0; i < cjk.length - 1; i++) out.push(cjk[i]! + cjk[i + 1]!);
  }
  return out;
}

/** FNV-1a 32 位哈希，分布均匀、确定性强 */
function hashToken(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
