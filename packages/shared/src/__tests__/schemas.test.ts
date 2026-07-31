// 金额字段上界校验（PR-B「金额整数分」加固）：确保任一金额字段都不会接受天文数字，
// 避免前端的 Number 精度边界被后端 zod 放过后写入导致溢出 / 展示错乱。
import { describe, it, expect } from 'vitest';
import {
  recordTransactionSchema,
  recordIncomeSchema,
  recordAssetSchema,
  createDebtSchema,
  createBudgetSchema,
  updateBudgetSchema,
} from '../schemas';

const TOO_BIG = 1e15 + 1; // 刚好越过 .max(1e15)
const OK = 1e15; // 上界本身应被接受

describe('金额字段上界（PR-B）', () => {
  it('recordTransactionSchema 拒绝超过 1e15 的金额', () => {
    expect(recordTransactionSchema.safeParse({
      kind: 'expense',
      category: '餐饮',
      amount: TOO_BIG,
      occurredAt: '2020-01-01T00:00:00.000Z',
    }).success).toBe(false);
    expect(recordTransactionSchema.safeParse({
      kind: 'expense',
      category: '餐饮',
      amount: OK,
      occurredAt: '2020-01-01T00:00:00.000Z',
    }).success).toBe(true);
  });

  it('recordIncomeSchema 拒绝超过 1e15 的金额', () => {
    expect(recordIncomeSchema.safeParse({
      source: '工资',
      amount: TOO_BIG,
      receivedAt: '2020-01-01T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('recordAssetSchema 拒绝超过 1e15 的估值', () => {
    expect(recordAssetSchema.safeParse({
      name: '房产',
      assetClass: 'property',
      value: TOO_BIG,
      asOf: '2020-01-01T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('createDebtSchema 拒绝超过 1e15 的本金', () => {
    expect(createDebtSchema.safeParse({
      creditor: '银行',
      principal: TOO_BIG,
    }).success).toBe(false);
  });

  it('budget monthlyLimit 拒绝超过 1e15（create / update）', () => {
    expect(createBudgetSchema.safeParse({
      name: '月度预算',
      monthlyLimit: TOO_BIG,
    }).success).toBe(false);
    expect(updateBudgetSchema.safeParse({
      id: 'b1',
      monthlyLimit: TOO_BIG,
    }).success).toBe(false);
    expect(createBudgetSchema.safeParse({
      name: '月度预算',
      monthlyLimit: OK,
    }).success).toBe(true);
  });

  it('note 字段限制长度（防超大文本）', () => {
    const huge = 'x'.repeat(5001);
    expect(createBudgetSchema.safeParse({ name: 'n', monthlyLimit: 100, note: huge }).success).toBe(false);
  });
});
