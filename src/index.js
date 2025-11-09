const app = require('./service.js');
const metrics = require('./metrics.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  // Start metrics reporting every 10 seconds
  metrics.startMetricsReporting(60000);
});
