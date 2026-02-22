const {
  projectOperatorHealth,
  projectOperatorMetrics
} = require("../../observability/diagnostics");

function projectHealthDiagnostics(input = {}) {
  return projectOperatorHealth(input);
}

function projectMetricsDiagnostics(input = {}) {
  return projectOperatorMetrics(input);
}

module.exports = {
  projectHealthDiagnostics,
  projectMetricsDiagnostics
};
