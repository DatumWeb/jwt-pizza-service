const config = require('./config.js');

class Logger {
  // Express middleware for HTTP request logging
  httpLogger = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
    // Shared logging function
    const logResponse = (body) => {
      let parsed;
      try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        parsed = body;
      }
  
      const logData = {
        authorized: !!req.headers.authorization,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ip: ip,
        req: req.body,
        res: parsed
      };
  
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
    };
  
    // Wrap res.send() to log all responses sent via res.send()
    const originalSend = res.send;
    res.send = (body) => {
      logResponse(body);
      res.send = originalSend;
      return originalSend.call(res, body);
    };
  
    // Wrap res.json() to log all responses sent via res.json()
    const originalJson = res.json;
    res.json = (body) => {
      logResponse(body);
      res.json = originalJson;
      return originalJson.call(res, body);
    };
  
    next();
  };
  

  // General logging method
  log(level, type, logData) {
    const labels = { component: config.logging.source, level: level, type: type };
    const values = [this.nowString(), JSON.stringify(this.sanitize(logData))];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  // Database query logging method
  dbLog(sql, params, time) {
    const logData = {
      sql,
      params: this.sanitizeParams(params),
      ms: time
    };
    this.log('info', 'db', logData);
  }
  

  // Factory service request logging method
  factoryLog(requestBody, responseBody, statusCode, error) {
    const logData = {
      request: requestBody,
      response: responseBody,
      status: statusCode,
      error: error ? error.message : undefined
    };
  
    const level = statusCode >= 400 || error ? 'warn' : 'info';
    this.log(level, 'factory', logData);
  }
  

  // Exception/error logging method
  exceptionLog(error, req) {
    const logData = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      request: req ? {
        method: req.method,
        path: req.originalUrl,
        headers: req.headers,
      } : undefined,
    };
    this.log('error', 'exception', logData);
  }

  // Convert HTTP status codes to log levels
  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  // Generate nanosecond timestamp string
  nowString() {
    // Date.now() returns milliseconds, multiply by 1,000,000 to get nanoseconds
    return (Date.now() * 1000000).toString();
  }

  // Sanitize log data to remove passwords and sensitive information
  sanitize(obj) {
    const clone = JSON.parse(JSON.stringify(obj));
  
    const clean = (o) => {
      if (o && typeof o === 'object') {
        for (const key of Object.keys(o)) {
          const lower = key.toLowerCase();
          if (lower.includes('password') || lower.includes('apikey') || lower.includes('token') || lower.includes('authorization')) {
            o[key] = '*****';
          } else {
            clean(o[key]);
          }
        }
      }
    };
  
    clean(clone);
    return clone;
  }
  

  // Sanitize database parameters (for params array)
  sanitizeParams(params) {
    if (!params || !Array.isArray(params)) return params;
    // Convert params to object for easier sanitization, but keep as array
    // We'll just sanitize password-like values in the array
    return params.map((param) => {
      if (typeof param === 'string' && (param.toLowerCase().includes('password') || param.length > 50)) {
        return '*****';
      }
      return param;
    });
  }

  // Send log event to Grafana Loki
  sendLogToGrafana(event) {
    // Check if logging is configured
    if (!config.logging || !config.logging.url || !config.logging.apiKey) {
      console.error('[Logger] Logging not configured. Missing config.logging.url or config.logging.apiKey');
      return;
    }

    const body = JSON.stringify(event);
    fetch(`${config.logging.url}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.userId}:${config.logging.apiKey}`,
      },
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`[Logger] Failed to send log to Grafana. Status: ${response.status}, URL: ${config.logging.url}`);
          return response.text().then((text) => {
            console.error(`[Logger] Response: ${text.substring(0, 200)}`);
          });
        }
      })
      .catch((error) => {
        // Log errors to help debug
        console.error(`[Logger] Failed to send log to Grafana: ${error.message}`);
        console.error(`[Logger] URL: ${config.logging.url}`);
        console.error(`[Logger] Error details:`, error);
      });
  }
}

module.exports = new Logger();

