const express = require('express');
const { authRouter, setAuthUser } = require('./routes/authRouter.js');
const orderRouter = require('./routes/orderRouter.js');
const franchiseRouter = require('./routes/franchiseRouter.js');
const userRouter = require('./routes/userRouter.js');
const version = require('./version.json');
const config = require('./config.js');
const metrics = require('./metrics.js');
const logger = require('./logger.js');

const app = express();
app.use(express.json());
app.use(logger.httpLogger);
app.use(metrics.requestTracker);
app.use(setAuthUser);
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

const apiRouter = express.Router();
app.use('/api', apiRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/order', orderRouter);
apiRouter.use('/franchise', franchiseRouter);

apiRouter.use('/docs', (req, res) => {
  res.json({
    version: version.version,
    endpoints: [...authRouter.docs, ...userRouter.docs, ...orderRouter.docs, ...franchiseRouter.docs],
    config: { factory: config.factory.url, db: config.db.connection.host },
  });
});

// Debug endpoint to test logging
apiRouter.get('/debug/logging', (req, res) => {
  const hasLoggingConfig = !!(config.logging && config.logging.url && config.logging.apiKey);
  logger.log('info', 'debug', { 
    message: 'Logging test endpoint called',
    hasLoggingConfig,
    loggingUrl: config.logging?.url ? 'configured' : 'missing',
    loggingUserId: config.logging?.userId || 'missing',
    timestamp: new Date().toISOString()
  });
  res.json({
    status: 'ok',
    logging: {
      configured: hasLoggingConfig,
      url: config.logging?.url ? 'configured' : 'missing',
      userId: config.logging?.userId || 'missing',
      source: config.logging?.source || 'missing',
    },
    message: 'Test log sent to Grafana. Check Grafana Explorer with component="jwt-pizza-service" and type="debug"'
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'welcome to JWT Pizza',
    version: version.version,
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    message: 'unknown endpoint',
  });
});

// Default error handler for all exceptions and errors.
app.use((err, req, res, next) => {
  // Log the exception
  logger.exceptionLog(err, req);
  
  res.status(err.statusCode ?? 500).json({ message: err.message, stack: err.stack });
  next();
});

module.exports = app;
