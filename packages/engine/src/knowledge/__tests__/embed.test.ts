import { describe, it, expect } from 'vitest';
import { embed, cosine, EMBED_DIM } from '../embed';

describe('向量嵌入 embed / cosine', () => {
  it('确定性：相同输入产生相同向量', () => {
    expect(embed('深度学习 神经网络')).toEqual(embed('深度学习 神经网络'));
  });

  it('维度固定且 L2 归一化（模长=1）', () => {
    const v = embed('hello world 你好世界');
    expect(v).toHaveLength(EMBED_DIM);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 6);
  });

  it('不同文本产生不同向量', () => {
    const a = embed('苹果 水果 红色');
    const b = embed('火箭 发动机 推进');
    expect(cosine(a, b)).toBeLessThan(0.5);
  });

  it('余弦：相同文本≈1，中英文完全不交叠≈0', () => {
    const a = embed('机器学习 模型 训练');
    expect(cosine(a, embed('机器学习 模型 训练'))).toBeCloseTo(1, 6);
    const c = embed('机器学习 模型');
    const d = embed('rocket engine thrust');
    expect(cosine(c, d)).toBeLessThan(0.1);
  });

  it('语义相关度高于无关度（词面重叠）', () => {
    const base = embed('咖啡 提神 早晨 工作');
    const related = embed('清晨 喝咖啡 保持清醒 提升效率');
    const unrelated = embed('足球 比赛 进球 草坪');
    expect(cosine(base, related)).toBeGreaterThan(cosine(base, unrelated));
  });
});
