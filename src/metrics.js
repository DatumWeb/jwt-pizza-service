const config = require('./config');
const os = require('os');

// Metrics stored in memory
const requests = {}; // { method: count }
let endpointLatencies = []; // Array of { endpoint, latency }
const activeUsers = new Set(); // Set of user IDs

// Counters (monotonic, cumulative)
let authSuccessCount = 0;
let authFailureCount = 0;

let pizzaSoldCount = 0;
let pizzaCreationFailures = 0;
let pizzaRevenue = 0; // Total cumulative revenue

let pizzaCreationLatencies = []; // Array of latencies in ms

// Middleware to track HTTP requests
function requestTracker(req, res, next) {
  const startTime = Date.now();
  const method = req.method;

  // Track request count by method (cumulative forever)
  requests[method] = (requests[method] || 0) + 1;

  res.on('finish', () => {
    const latency = Date.now() - startTime;
    const endpoint = `${req.method} ${req.path}`;
    endpointLatencies.push({ endpoint, latency });

    if (endpointLatencies.length > 1000) {
      endpointLatencies.shift();
    }
  });

  next();
}

// Track authentication attempts
function trackAuthAttempt(success) {
  if (success) {
    authSuccessCount++;
  } else {
    authFailureCount++;
  }
}

// Track active user (when they log in)
function trackActiveUser(userId) {
  activeUsers.add(userId);
}

// Track user logout
function trackUserLogout(userId) {
  activeUsers.delete(userId);
}

// Track pizza purchase
function trackPizzaPurchase(success, latency, price) {
  if (success) {
    pizzaSoldCount++;
    pizzaRevenue += price || 0;
  } else {
    pizzaCreationFailures++;
  }

  if (latency !== undefined) {
    pizzaCreationLatencies.push(latency);
    if (pizzaCreationLatencies.length > 1000) {
      pizzaCreationLatencies.shift();
    }
  }
}

// System metrics
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Math.min(100, Math.max(0, cpuUsage * 100));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return Math.min(100, Math.max(0, memoryUsage));
}

// Calculate average latency
function getAverageLatency(latencies) {
  if (latencies.length === 0) return 0;
  const sum = latencies.reduce((acc, l) => acc + (typeof l === 'number' ? l : l.latency), 0);
  return Math.round(sum / latencies.length);
}

// Create a metric object
function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: String(attributes[key]) },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

// Send metrics to Grafana
function sendMetricToGrafana(metrics) {
  if (metrics.length === 0) return;

  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  const authHeader = config.metrics.apiKey.includes(':')
    ? `Basic ${Buffer.from(config.metrics.apiKey).toString('base64')}`
    : `Bearer ${config.metrics.apiKey}`;

  fetch(`${config.metrics.url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        return response.text().then((text) => {
          console.error(`Failed to push metrics. Status: ${response.status}`);
          console.error(`Response: ${text}`);
          throw new Error(`HTTP status: ${response.status} - ${text}`);
        });
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error.message);
    });
}

// Collect and send all metrics periodically
function sendMetricsPeriodically(period = 10000) {
  const timer = setInterval(() => {
    try {
      const metrics = [];

      //
      // HTTP REQUESTS (cumulative)
      //
      Object.keys(requests).forEach((method) => {
        metrics.push(createMetric(
          'http_requests_total',
          requests[method],
          '1',
          'sum',
          'asInt',
          { method }
        ));
      });

      const totalRequests = Object.values(requests).reduce((a, b) => a + b, 0);
      metrics.push(createMetric(
        'http_requests_total',
        totalRequests,
        '1',
        'sum',
        'asInt',
        { method: 'ALL' }
      ));

      //
      // ACTIVE USERS (gauge)
      //
      metrics.push(createMetric('active_users', activeUsers.size, '1', 'gauge', 'asInt', {}));

      //
      // AUTH COUNTERS (cumulative)
      //
      metrics.push(createMetric('auth_attempts_total', authSuccessCount, '1', 'sum', 'asInt', { status: 'success' }));
      metrics.push(createMetric('auth_attempts_total', authFailureCount, '1', 'sum', 'asInt', { status: 'failure' }));

      //
      // SYSTEM METRICS (gauges)
      //
      metrics.push(createMetric('cpu_usage_percent', getCpuUsagePercentage(), '%', 'gauge', 'asDouble', {}));
      metrics.push(createMetric('memory_usage_percent', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {}));

      //
      // PIZZA METRICS (cumulative — ALWAYS SENT)
      //
      metrics.push(createMetric('pizza_sold_total', pizzaSoldCount, '1', 'sum', 'asInt', {}));
      metrics.push(createMetric('pizza_creation_failures_total', pizzaCreationFailures, '1', 'sum', 'asInt', {}));
      metrics.push(createMetric('pizza_revenue_total', pizzaRevenue, '1', 'sum', 'asDouble', {}));

      //
      // LATENCY METRICS (gauges)
      //
      const avgEndpointLatency = getAverageLatency(endpointLatencies);
      if (avgEndpointLatency > 0) {
        metrics.push(createMetric('endpoint_latency_ms', avgEndpointLatency, 'ms', 'gauge', 'asInt', {}));
      }

      const avgPizzaLatency = getAverageLatency(pizzaCreationLatencies);
      if (avgPizzaLatency > 0) {
        metrics.push(createMetric('pizza_creation_latency_ms', avgPizzaLatency, 'ms', 'gauge', 'asInt', {}));
      }

      sendMetricToGrafana(metrics);

      // Keep latency arrays small
      if (endpointLatencies.length > 100) endpointLatencies = endpointLatencies.slice(-50);
      if (pizzaCreationLatencies.length > 100) pizzaCreationLatencies = pizzaCreationLatencies.slice(-50);

      // NOTE: NO COUNTERS ARE EVER RESET NOW (correct Prometheus-style)

    } catch (error) {
      console.error('Error sending metrics:', error);
    }
  }, period);

  return timer;
}

// Start periodic reporting
let metricsTimer = null;

function startMetricsReporting(period = 60000) {
  if (metricsTimer) {
    clearInterval(metricsTimer);
  }
  metricsTimer = sendMetricsPeriodically(period);
}

module.exports = {
  requestTracker,
  trackAuthAttempt,
  trackActiveUser,
  trackUserLogout,
  trackPizzaPurchase,
  startMetricsReporting,
};
