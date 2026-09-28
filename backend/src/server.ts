import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import 'express-async-errors';

// Load environment variables
dotenv.config();

// Import configurations
import { connectDatabase, closeDatabase, getDatabaseStatus, isDatabaseConnected } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { logger } from './config/logger'; 
import { configureGCS } from './config/gcs';
import { validateRequiredEnv } from './config/env';
import User from './models/User';

console.log('🚀 [SERVER_STARTUP] Version 5.0 - Media Migration Active');
logger.info('🚀 [SERVER_STARTUP] Version 5.0 - Media Migration Active');

// Import routes
import authRoutes from './routes/auth.routes';
import healthRoutes from './routes/health.routes';
import companyRoutes from './routes/company.routes';
import departmentRoutes from './routes/department.routes';
import userRoutes from './routes/user.routes';
import grievanceRoutes from './routes/grievance.routes';
import appointmentRoutes from './routes/appointment.routes';
import analyticsRoutes from './routes/analytics.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import importRoutes from './routes/import.routes';
import exportRoutes from './routes/export.routes';
import auditRoutes from './routes/audit.routes';
import dashboardRoutes from './routes/dashboard.routes';
import assignmentRoutes from './routes/assignment.routes';
import statusRoutes from './routes/status.routes';
import availabilityRoutes from './routes/availability.routes';
import chatbotFlowRoutes from './routes/chatbotFlow.routes';
import whatsappConfigRoutes from './routes/companyWhatsAppConfig.routes';
import emailConfigRoutes from './routes/companyEmailConfig.routes';
import leadRoutes from './routes/lead.routes';
import roleRoutes from './routes/role.routes';
import moduleRoutes from './routes/module.routes';
import whatsappTemplateRoutes from './routes/whatsappTemplate.routes';
import notificationRoutes from './routes/notification.routes';
import { startWhatsAppTemplateSyncCron } from './services/whatsappTemplateSyncCron';
import { startSlaEscalationCron } from './services/slaEscalationCron';
import { databaseSafetyContextMiddleware } from './utils/databaseSafety';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { tenantLimiter } from './middleware/rateLimiter';



const app: Application = express();
const PORT = process.env.PORT || 5001;
let startupInitializationPromise: Promise<void> | null = null;
let startupInitializationError: Error | null = null;

// Trust proxy (required when behind Vercel/nginx; fixes express-rate-limit X-Forwarded-For validation)
app.set('trust proxy', 1);

// Attach request context before all routes so destructive DB-operation logs include request metadata
app.use(databaseSafetyContextMiddleware);

// Custom logging middleware to see ALL traffic
app.use((req, res, next) => {
  logger.info(`🌐 Incoming Request: ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    logger.info(`📦 Headers: ${JSON.stringify(req.headers)}`);
  }
  next();
});

// Security - Configure helmet to allow WhatsApp webhook requests
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for webhook endpoints
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin requests from WhatsApp
}));

// CORS - Allow localhost in dev, and all Vercel deployments in production
const DEFAULT_FRONTEND_ORIGIN = 'https://connect.pugarch.in';
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'];
const frontendUrl = process.env.FRONTEND_URL;
const isProduction = process.env.NODE_ENV === 'production';

const normalizeOrigin = (o: string) => (o || '').replace(/\/+$/, '');

const corsOptions = {
  origin: !isProduction
    ? true // Allow all origins in development
    : (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
          cb(null, true);
          return;
        }
        
        const normalized = normalizeOrigin(origin);
        
        // 🔗 PugArch Multi-tenant & Vercel Support
        const ALLOWED_ORIGINS = [
          'https://connect.pugarch.in',
          'http://connect.pugarch.in',
          'https://sahaj.pugarch.in',
          'http://sahaj.pugarch.in',
          'https://connect-pugarch-backend.vercel.app',
          'https://connect-pugarch.vercel.app'
        ];

        // Check if explicitly allowed or matches environment variable
        const isExplicitlyAllowed = ALLOWED_ORIGINS.some(allowed => normalized === normalizeOrigin(allowed));

        // Check environment variable
        let isEnvAllowed = false;
        if (frontendUrl) {
          const envOrigins = frontendUrl.split(',').map(u => normalizeOrigin(u.trim())).filter(Boolean);
          isEnvAllowed = envOrigins.some(allowed => normalized === allowed || normalized.startsWith(allowed));
        }

        // Check for Vercel preview or PugArch subdomains
        const isSubdomainAllowed = normalized.endsWith('.vercel.app') || normalized.endsWith('.pugarch.in');

        if (isExplicitlyAllowed || isEnvAllowed || isSubdomainAllowed) {
          cb(null, true);
        } else {
          logger.warn(`CORS blocked origin: ${origin}`);
          cb(null, false);
        }
      },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limiting - protect against brute force and abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Increased to 2000 for dashboard polling
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Increased to 50 for auth
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/sso', authLimiter);

// Body parsing
const WEBHOOK_RAW_BODY_PATHS = ['/webhook', '/api/webhook', '/api/whatsapp'];

app.use(express.json({
  limit: '10mb',
  verify: (req: Request, _res: Response, buf: Buffer) => {
    const requestPath = req.originalUrl || req.url || '';
    const shouldCaptureRawBody = WEBHOOK_RAW_BODY_PATHS.some((path) =>
      requestPath.startsWith(path)
    );

    if (shouldCaptureRawBody) {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Per-tenant API rate limiting
app.use('/api', tenantLimiter);

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ================================
// Routes
// ================================

// On Vercel/serverless, ensure DB is connected before any /api route (avoids "users.findOne() buffering timed out")
const ensureDb = async (_req: Request, _res: Response, next: (err?: any) => void) => {
  try {
    if (startupInitializationPromise) {
      await startupInitializationPromise;
    }

    if (startupInitializationError) {
      throw startupInitializationError;
    }

    if (isDatabaseConnected()) return next();
    
    logger.info(`⏳ Middleware ensuring DB connection for: ${_req.url}`);
    await connectDatabase();
    next();
  } catch (e: any) {
    logger.error('❌ Middleware DB connection failed:', e.message);
    next(e);
  }
};
app.use('/api', ensureDb);

// Health check (basic)
app.get('/health', async (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  const { getUsersCollectionCount } = await import('./utils/databaseSafety');
  const usersCollectionCount = dbStatus.connected ? await getUsersCollectionCount() : 0;
  const maintenanceMode = !dbStatus.connected || usersCollectionCount === 0;

  res.json({
    status: maintenanceMode ? 'MAINTENANCE' : 'OK',
    maintenance: maintenanceMode,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    database: {
      ...dbStatus,
      usersCollectionCount
    },
    message: maintenanceMode 
      ? 'System is currently under maintenance or experiencing critical issues.' 
      : 'All systems operational'
  });
});

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Dashboard API Server is running'  });
});

// Webhook routes (must be before /api routes to avoid middleware blocking)
app.use('/webhook', whatsappRoutes);
app.use('/api/webhook', whatsappRoutes); // Added this to match your Meta config
app.use('/api/whatsapp', whatsappRoutes); // Standard Meta alias


// API routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/grievances', grievanceRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/chatbot-flows', chatbotFlowRoutes);
app.use('/api/whatsapp-config', whatsappConfigRoutes);
app.use('/api/email-config', emailConfigRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/templates', whatsappTemplateRoutes);
app.use('/api/notifications', notificationRoutes);

// ================================
// Error Handling
// ================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ================================
// Server Initialization
const init = async () => {
  validateRequiredEnv();

    // Configure GCS
    await configureGCS();

  // Connect to MongoDB
  await connectDatabase();

  const userCount = await User.countDocuments();
  if (userCount === 0) {
    logger.error('CRITICAL: users collection is empty at startup');

    if ((process.env.NODE_ENV === 'production' || process.env.VERCEL) && process.env.ALLOW_EMPTY_USERS_ON_STARTUP !== 'true') {
      throw new Error('Refusing to start against an empty users collection in production. Verify MONGODB_URI or set ALLOW_EMPTY_USERS_ON_STARTUP=true only for a fresh intentional install.');
    }
  }

  // 🚫 PRODUCTION SAFETY: Do NOT run syncIndexes on every serverless request.
  // This causes extreme overhead and connection timeouts on Vercel.
  /*
  if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    try {
      const Counter = (await import('./models/Counter')).default;
      const Grievance = (await import('./models/Grievance')).default;
      const Appointment = (await import('./models/Appointment')).default;
      const ChatbotFlow = (await import('./models/ChatbotFlow')).default;
      const Role = (await import('./models/Role')).default;

      await Counter.syncIndexes();
      await Grievance.syncIndexes();
      await Appointment.syncIndexes();
      await ChatbotFlow.syncIndexes();
      await Role.syncIndexes();
      logger.info('✅ MongoDB indexes synced');
    } catch (error: any) {
      logger.warn('⚠️ Index sync failed (will continue):', error.message);
    }
  }
  */

  // Connect to Redis (optional)
  try {
    await connectRedis();
  } catch (error: any) {
    // Redis is optional
  }

  // Initialize ID counters (for atomic ID generation)
  try {
    const { initializeCounters } = await import('./utils/idGenerator');
    await initializeCounters();
    logger.info('✅ ID counters initialized');

  } catch (error: any) {
    logger.warn('⚠️ Counter initialization failed (non-critical):', error.message);
  }
};

const runInitialization = (): Promise<void> => {
  if (!startupInitializationPromise) {
    startupInitializationPromise = init().catch((error: Error) => {
      startupInitializationError = error;
      throw error;
    });
  }

  return startupInitializationPromise;
};

// For local development
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const startServer = async () => {
    await runInitialization();
    
    // Create server instance
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      startWhatsAppTemplateSyncCron();
      startSlaEscalationCron();
    });

    // Production-grade error handling for port conflicts
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use`);
        logger.error('💡 Solutions:');
        logger.error('   1. Kill the process: taskkill /F /IM node.exe');
        logger.error('   2. Use a different port: set PORT=5001');
        logger.error('   3. Find process: netstat -ano | findstr :5000');
        
        // Try to gracefully shutdown
        setTimeout(() => {
          logger.info('⏳ Attempting graceful shutdown...');
          process.exit(1);
        }, 1000);
      } else if (error.code === 'EACCES') {
        logger.error(`❌ Permission denied to use port ${PORT}`);
        logger.error('💡 Try using a port above 1024 or run with elevated privileges');
        process.exit(1);
      } else {
        logger.error('❌ Failed to start HTTP server:', error);
        process.exit(1);
      }
    });

    // Handle server listening event
    server.on('listening', () => {
      const addr = server.address();
      const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;
      logger.info(`✅ Server listening on ${bind}`);
    });

    return server;
  };
  
  startServer().catch(err => {
    logger.error('❌ Server startup failed:', err);
    process.exit(1);
  });
} else {
  // In Vercel environment, init needs to be handled
  // We'll call it once at the top level if supported, or rely on lazy-loading
  runInitialization().catch(err => logger.error('Vercel initialization failed:', err));
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: Error) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await closeDatabase();
  await disconnectRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await closeDatabase();
  await disconnectRedis();
  process.exit(0);
});

export default app;
