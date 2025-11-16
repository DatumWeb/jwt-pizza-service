const config = require('./config.js');

class Logger {

  httpLogger = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let responseBody = null;
    let responseLogged = false;

    const logResponse = () => {
      if (responseLogged) return;
      responseLogged = true;
      
      try {
        const logData = {
          authorized: !!req.headers.authorization,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode || 200,
          ip,
          req: req.body || null,
          res: responseBody
        };

        const level = this.statusToLogLevel(res.statusCode || 200);
        this.log(level, "http", logData);
      } catch (error) {
        // Don't let logging errors break the response
        console.error("[Logger] Error in logResponse:", error.message);
      }
    };

    const originalSend = res.send.bind(res);
    res.send = function(body) {
      try {
        // Capture response body
        if (body !== undefined && body !== null) {
          try {
            responseBody = typeof body === 'string' ? JSON.parse(body) : body;
          } catch {
            responseBody = body;
          }
        }
      } catch {
        // Ignore parsing errors
      }
      const result = originalSend(body);
      setImmediate(logResponse);
      return result;
    };

    const originalJson = res.json.bind(res);
    res.json = function(body) {
      try {
        // Capture response body
        responseBody = body;
      } catch {
        // Ignore errors
      }
      const result = originalJson(body);
      setImmediate(logResponse);
      return result;
    };

    // Backup: log on response finish
    res.on('finish', () => {
      if (!responseLogged) {
        logResponse();
      }
    });

    next();
  };

  log(level, type, logData) {
    const labels = {
      component: config.logging.source,
      level,
      type
    };

    const sanitized = this.sanitize(logData);

    const logEvent = {
      streams: [
        {
          stream: labels,
          values: [
            [this.nowString(), JSON.stringify(sanitized)]
          ]
        }
      ]
    };

    this.sendLogToGrafana(logEvent);
  }

  dbLog(sql, params, time) {
    const logData = {
      sql,
      params: this.sanitizeParams(params),
      ms: time
    };
    this.log("info", "db", logData);
  }

  factoryLog(requestBody, responseBody, statusCode, error) {
    const logData = {
      request: requestBody,
      response: responseBody,
      status: statusCode,
      error: error ? error.message : undefined
    };

    const level = statusCode >= 400 || error ? "warn" : "info";
    this.log(level, "factory", logData);
  }

  exceptionLog(error, req) {
    const logData = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      request: req ? {
        method: req.method,
        path: req.originalUrl,
        headers: req.headers
      } : undefined
    };

    this.log("error", "exception", logData);
  }

  statusToLogLevel(status) {
    if (status >= 500) return "error";
    if (status >= 400) return "warn";
    return "info";
  }

  nowString() {
    return (Date.now() * 1_000_000).toString();
  }

  sanitize(obj) {
    if (!obj || typeof obj !== "object") return obj;
  
    const clone = structuredClone(obj);
  
    const clean = (o) => {
      for (const k of Object.keys(o)) {
        const val = o[k];
        const key = k.toLowerCase();
  
        if (
          key.includes("password") ||
          key.includes("token") ||
          key.includes("apikey") ||
          key.includes("authorization")
        ) {
          o[k] = "*****";
        } else if (val && typeof val === "object") {
          clean(val);
        }
      }
    };
  
    clean(clone);
    return clone;
  }
  
  sanitizeParams(params) {
    if (!Array.isArray(params)) return params;
    return params.map((x) =>
      typeof x === "string" && x.toLowerCase().includes("password")
        ? "*****"
        : x
    );
  }

  sendLogToGrafana(event) {
    if (!config.logging.url || !config.logging.apiKey) {
      console.error("[Logger] Logging not configured");
      return;
    }

    fetch(config.logging.url, {
      method: "POST",
      body: JSON.stringify(event),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.logging.userId}:${config.logging.apiKey}`
      }
    }).then((res) => {
      if (!res.ok) {
        console.error("[Logger] Failed to send log", res.status);
      }
    }).catch((e) => {
      console.error("[Logger] Error sending logs:", e.message);
    });
  }
}

module.exports = new Logger();
