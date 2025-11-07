const config = require('./config');
const os = require('os');

// Metrics stored in memory
const requests = {}; // { method: count }
let endpointLatencies = []; // Array of { endpoint, latency }
const activeUsers = new Set(); // Set of user IDs
let authSuccessCount = 0;
let authFailureCount = 0;
let pizzaSoldCount = 0;
let pizzaCreationFailures = 0;
let pizzaRevenue = 0; // Total revenue in the reporting period
let pizzaCreationLatencies = []; // Array of latencies in ms

// Middleware to track HTTP requests
function requestTracker(req, res, next) {
  const startTime = Date.now();
  const method = req.method;
  
  // Track request count by method
  requests[method] = (requests[method] || 0) + 1;
  
  // Track latency
  res.on('finish', () => {
    const latency = Date.now() - startTime;
    const endpoint = `${req.method} ${req.path}`;
    endpointLatencies.push({ endpoint, latency });
    // Keep only last 1000 latencies to avoid memory issues
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
    // Keep only last 1000 latencies
    if (pizzaCreationLatencies.length > 1000) {
      pizzaCreationLatencies.shift();
    }
  }
}

// Get system metrics
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

  // Use Basic auth if API key contains ':', otherwise use Bearer
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
      } else {
        console.log(`Successfully sent ${metrics.length} metrics to Grafana`);
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

      // HTTP requests by method
      Object.keys(requests).forEach((method) => {
        metrics.push(createMetric('http_requests_total', requests[method], '1', 'sum', 'asInt', { method }));
      });

      // Total requests
      const totalRequests = Object.values(requests).reduce((sum, count) => sum + count, 0);
      if (totalRequests > 0) {
        metrics.push(createMetric('http_requests_total', totalRequests, '1', 'sum', 'asInt', { method: 'ALL' }));
      }

      // Active users
      metrics.push(createMetric('active_users', activeUsers.size, '1', 'gauge', 'asInt', {}));
      console.log(`[Metrics] Active users: ${activeUsers.size}`);

      // Authentication metrics
      if (authSuccessCount > 0) {
        metrics.push(createMetric('auth_attempts_total', authSuccessCount, '1', 'sum', 'asInt', { status: 'success' }));
      }
      if (authFailureCount > 0) {
        metrics.push(createMetric('auth_attempts_total', authFailureCount, '1', 'sum', 'asInt', { status: 'failure' }));
      }

      // System metrics
      const cpuUsage = getCpuUsagePercentage();
      const memoryUsage = getMemoryUsagePercentage();
      metrics.push(createMetric('cpu_usage_percent', cpuUsage, '%', 'gauge', 'asDouble', {}));
      metrics.push(createMetric('memory_usage_percent', memoryUsage, '%', 'gauge', 'asDouble', {}));
      console.log(`[Metrics] CPU: ${cpuUsage.toFixed(2)}%, Memory: ${memoryUsage.toFixed(2)}%`);

      // Pizza metrics
      if (pizzaSoldCount > 0) {
        metrics.push(createMetric('pizza_sold_total', pizzaSoldCount, '1', 'sum', 'asInt', {}));
      }
      if (pizzaCreationFailures > 0) {
        metrics.push(createMetric('pizza_creation_failures_total', pizzaCreationFailures, '1', 'sum', 'asInt', {}));
      }
      if (pizzaRevenue > 0) {
        metrics.push(createMetric('pizza_revenue_total', pizzaRevenue, '1', 'sum', 'asDouble', {}));
      }

      // Latency metrics
      const avgEndpointLatency = getAverageLatency(endpointLatencies);
      if (avgEndpointLatency > 0) {
        metrics.push(createMetric('endpoint_latency_ms', avgEndpointLatency, 'ms', 'gauge', 'asInt', {}));
        console.log(`[Metrics] Endpoint latency: ${avgEndpointLatency}ms (from ${endpointLatencies.length} requests)`);
      } else {
        console.log(`[Metrics] No endpoint latency data (${endpointLatencies.length} latencies recorded)`);
      }

      const avgPizzaLatency = getAverageLatency(pizzaCreationLatencies);
      if (avgPizzaLatency > 0) {
        metrics.push(createMetric('pizza_creation_latency_ms', avgPizzaLatency, 'ms', 'gauge', 'asInt', {}));
      }

      sendMetricToGrafana(metrics);

      // Reset counters for next period
      // Reset request counts
      Object.keys(requests).forEach((method) => {
        requests[method] = 0;
      });
      
      // Reset auth counters
      authSuccessCount = 0;
      authFailureCount = 0;
      
      // Reset pizza counters
      pizzaSoldCount = 0;
      pizzaCreationFailures = 0;
      pizzaRevenue = 0;
      
      // Clear latency arrays (keep recent data for averaging)
      if (endpointLatencies.length > 100) {
        endpointLatencies = endpointLatencies.slice(-50); // Keep last 50
      }
      if (pizzaCreationLatencies.length > 100) {
        pizzaCreationLatencies = pizzaCreationLatencies.slice(-50); // Keep last 50
      }
    } catch (error) {
      console.error('Error sending metrics:', error);
    }
  }, period);

  return timer;
}

// Start periodic reporting
let metricsTimer = null;

function startMetricsReporting(period = 10000) {
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

