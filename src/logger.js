const config = require('./config.js');

class Logger {

  httpLogger = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const logResponse = (body) => {
      let parsed = body;
      try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        // If parsing fails, use original body (may not be JSON)
      }

      const logData = {
        authorized: !!req.headers.authorization,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ip,
        req: req.body,
        res: parsed
      };

      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, "http", logData);
    };

    const originalSend = res.send;
    res.send = (body) => {
      logResponse(body);
      res.send = originalSend;
      return originalSend.call(res, body);
    };

    const originalJson = res.json;
    res.json = (body) => {
      logResponse(body);
      res.json = originalJson;
      return originalJson.call(res, body);
    };

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
