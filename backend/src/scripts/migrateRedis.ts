import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_HOST = process.env.REDIS_HOST;
const SOURCE_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const SOURCE_PASSWORD = process.env.REDIS_PASSWORD;
const SOURCE_DB = parseInt(process.env.REDIS_DB || '0', 10); // Migrate from current REDIS_DB (defaults to 0 if not set)

// New target Redis credentials
const DEST_HOST = '34.93.87.34';
const DEST_PORT = 6379;
const DEST_PASSWORD = 'F18K<X1in2.@'; // Configured with your target password
const DEST_DB = 1; // Destination database is DB 1

async function migrateData() {
  if (!SOURCE_HOST) {
    console.error('❌ Error: REDIS_HOST is not set in your .env file!');
    process.exit(1);
  }

  console.log(`🔌 Connecting to Source Redis (${SOURCE_HOST}:${SOURCE_PORT}, DB: ${SOURCE_DB})...`);
  const sourceRedis = new Redis({
    host: SOURCE_HOST,
    port: SOURCE_PORT,
    password: SOURCE_PASSWORD,
    db: SOURCE_DB,
  });

  console.log(`🔌 Connecting to Destination Redis (${DEST_HOST}:${DEST_PORT}, DB: ${DEST_DB})...`);
  const destRedis = new Redis({
    host: DEST_HOST,
    port: DEST_PORT,
    password: DEST_PASSWORD,
    db: DEST_DB,
  });

  console.log('🔄 Checking connection and starting migration...');
  
  let cursor = '0';
  let totalMigrated = 0;

  do {
    // Scan all keys from the source database (DB 0)
    const [nextCursor, keys] = await sourceRedis.scan(cursor, 'MATCH', '*');
    cursor = nextCursor;

    if (keys.length > 0) {
      for (const key of keys) {
        const exists = await destRedis.exists(key);
        if (exists === 1) {
          console.log(`⚠️  [Skip] Key "${key}" already exists on Destination DB ${DEST_DB}`);
          continue;
        }

        const type = await sourceRedis.type(key);
        const ttl = await sourceRedis.ttl(key);
        const restoreTtl = ttl < 0 ? null : ttl;

        try {
          if (type === 'string') {
            const value = await sourceRedis.getBuffer(key);
            if (value) {
              if (restoreTtl) {
                await destRedis.setex(key, restoreTtl, value);
              } else {
                await destRedis.set(key, value);
              }
            }
          } else if (type === 'hash') {
            const value = await sourceRedis.hgetallBuffer(key);
            if (Object.keys(value).length > 0) {
              await destRedis.hmset(key, value);
              if (restoreTtl) await destRedis.expire(key, restoreTtl);
            }
          } else if (type === 'list') {
            const value = await sourceRedis.lrangeBuffer(key, 0, -1);
            if (value.length > 0) {
              await destRedis.rpush(key, ...value);
              if (restoreTtl) await destRedis.expire(key, restoreTtl);
            }
          } else if (type === 'set') {
            const value = await sourceRedis.smembersBuffer(key);
            if (value.length > 0) {
              await destRedis.sadd(key, ...value);
              if (restoreTtl) await destRedis.expire(key, restoreTtl);
            }
          } else if (type === 'zset') {
            const value = await sourceRedis.zrangeBuffer(key, 0, -1, 'WITHSCORES');
            if (value.length > 0) {
              const args: any[] = [];
              for (let i = 0; i < value.length; i += 2) {
                const member = value[i];
                const score = parseFloat(value[i + 1].toString());
                args.push(score, member);
              }
              await destRedis.zadd(key, ...args);
              if (restoreTtl) await destRedis.expire(key, restoreTtl);
            }
          }
          console.log(`✅ [Migrated] Key: "${key}" (Type: ${type}, TTL: ${ttl}s)`);
          totalMigrated++;
        } catch (err: any) {
          console.error(`❌ Failed to migrate key "${key}" of type "${type}":`, err.message);
        }
      }
    }
  } while (cursor !== '0');

  console.log(`\n🎉 Cross-server migration completed successfully!`);
  console.log(`📊 Total keys copied from DB 0 to DB 1: ${totalMigrated}`);

  await sourceRedis.quit();
  await destRedis.quit();
}

migrateData().catch((error) => {
  console.error('❌ Migration failed with error:', error);
  process.exit(1);
});
