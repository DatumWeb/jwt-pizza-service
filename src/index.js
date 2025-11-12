const app = require('./service.js');
const metrics = require('./metrics.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`🚀 JWT Pizza Service listening on port ${port}`);
  // 🟢 Start periodic push to Grafana Cloud
  metrics.startMetricsReporting(60000);
});
