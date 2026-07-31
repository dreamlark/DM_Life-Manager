import pino from 'pino';

/** 结构化 JSON 日志（开发期直接打到 stdout） */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
