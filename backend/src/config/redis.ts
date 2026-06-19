import Redis from 'ioredis';
import { logger } from './logger';

let redisClient: Redis | null = null;
let errorLogCount = 0;
let connectionStarted = false;

const redisOptions = {
  keyPrefix: process.env.REDIS_PREFIX || '',
  db: parseInt(process.env.REDIS_DB || '1', 10),
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  connectTimeout: 3000,
  retryStrategy(times: number) {
    // Stop retrying after 15 attempts (~75s total) to prevent log flooding
    if (times > 15) {
      logger.warn('Redis max reconnect attempts reached; switching to in-memory fallback permanently');
      return null;
    }
    return Math.min(times * 300, 5000);
  },
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

const getRedisInstance = () => {
  if (process.env.REDIS_HOST) {
    return new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      ...redisOptions
    });
  }
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, redisOptions);
  }
  return null;
};

redisClient = getRedisInstance();

if (redisClient) {
  redisClient.on('connect', () => {
    logger.info('Redis client initiating connection');
  });
  redisClient.on('ready', () => {
    errorLogCount = 0; // reset error log count on successful connection
    logger.info(`Redis connection established and ready (prefix: ${process.env.REDIS_PREFIX || 'none'}, tls: ${process.env.REDIS_TLS || 'false'})`);
  });
  redisClient.on('error', error => {
    errorLogCount += 1;
    if (errorLogCount <= 3) {
      logger.warn(`Redis connection failed or disconnected: ${error.message || error}; using in-memory fallback where available`);
    }
  });
  redisClient.on('end', () => {
    logger.warn('Redis connection closed permanently');
  });
}

export const connectRedis = async (): Promise<Redis | null> => {
  if (!redisClient || connectionStarted || redisClient.status === 'ready') return redisClient;
  connectionStarted = true;

  try {
    await redisClient.connect();
    logger.info(`Redis connected (prefix: ${process.env.REDIS_PREFIX || 'none'}, tls: ${process.env.REDIS_TLS || 'false'})`);
    return redisClient;
  } catch (error: any) {
    logger.warn(`Redis unavailable: ${error.message || error}; continuing with fallback mode`);
    return null;
  }
};

export const getRedisClient = (): Redis | null => {
  return redisClient;
};

export const isRedisConnected = (): boolean => {
  return redisClient !== null && redisClient.status === 'ready';
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error('Error closing Redis connection:', error);
    } finally {
      redisClient = null;
    }
  }
};

