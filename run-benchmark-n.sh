#!/usr/bin/env bash
#
# Run the external benchmark suite N times and collect results.
# Outputs per-run JSON to benchmark-results/run-<N>/ and a summary CSV.
#
# Usage:
#   bash run-benchmark-n.sh 5              # 5 runs, all external tests
#   bash run-benchmark-n.sh 10 cloudflare  # 10 runs, cloudflare only
#   bash run-benchmark-n.sh 5 creepjs      # 5 runs, creepjs only
#
# Results:
#   benchmark-results/run-001/   (test-results JSON files for run 1)
#   benchmark-results/run-002/
#   ...
#   benchmark-results/variance-summary.json
#

set -euo pipefail

N=${1:-5}
FILTER=${2:-}

RESULTS_DIR="benchmark-results"
SUMMARY_FILE="$RESULTS_DIR/variance-summary.json"

mkdir -p "$RESULTS_DIR"

echo "=== Benchmark variance test: $N runs ==="
echo "Filter: ${FILTER:-all external tests}"
echo ""

# Build filter argument
FILTER_ARG=""
if [ -n "$FILTER" ]; then
  FILTER_ARG="-g $FILTER"
fi

passed=0
failed=0

for i in $(seq 1 "$N"); do
  run_dir="$RESULTS_DIR/run-$(printf '%03d' "$i")"
  mkdir -p "$run_dir"

  echo "--- Run $i/$N ---"

  # Clear test-results from previous run
  rm -f test-results/benchmark-*.json test-results/cloudflare-*.png 2>/dev/null || true

  # Run the benchmark
  if npx playwright test --project=external $FILTER_ARG 2>&1 | tee "$run_dir/output.log"; then
    echo "  Run $i: PASS"
    ((passed++)) || true
  else
    echo "  Run $i: FAIL (see $run_dir/output.log)"
    ((failed++)) || true
  fi

  # Copy all benchmark JSON results into the run directory
  cp test-results/benchmark-*.json "$run_dir/" 2>/dev/null || true
  cp test-results/cloudflare-*.png "$run_dir/" 2>/dev/null || true

  echo ""
done

echo "=== Results: $passed passed, $failed failed out of $N runs ==="
echo ""

# Generate variance summary
echo "Generating variance summary..."

# Collect all benchmark JSON files across runs into a summary
node -e "
const fs = require('fs');
const path = require('path');

const resultsDir = '$RESULTS_DIR';
const n = $N;
const summary = { totalRuns: n, passed: $passed, failed: $failed, metrics: {} };

for (let i = 1; i <= n; i++) {
  const runDir = path.join(resultsDir, 'run-' + String(i).padStart(3, '0'));
  if (!fs.existsSync(runDir)) continue;

  const files = fs.readdirSync(runDir).filter(f => f.startsWith('benchmark-') && f.endsWith('.json'));
  for (const file of files) {
    const key = file.replace('benchmark-', '').replace('.json', '');
    if (!summary.metrics[key]) summary.metrics[key] = { runs: [] };

    try {
      const data = JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf-8'));
      summary.metrics[key].runs.push({
        run: i,
        status: data.status,
        preRotation: data.preRotation,
        postRotation: data.postRotation,
        sessionStable: data.sessionStable,
        rotationChanged: data.rotationChanged,
      });
    } catch (e) {
      summary.metrics[key].runs.push({ run: i, status: 'error', error: e.message });
    }
  }
}

// Compute per-metric variance for numeric values
for (const [key, metric] of Object.entries(summary.metrics)) {
  const values = {};
  for (const run of metric.runs) {
    if (!run.preRotation) continue;
    for (const [k, v] of Object.entries(run.preRotation)) {
      if (typeof v === 'number') {
        if (!values[k]) values[k] = [];
        values[k].push(v);
      }
    }
  }
  metric.numericVariance = {};
  for (const [k, arr] of Object.entries(values)) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    const stddev = Math.sqrt(variance);
    metric.numericVariance[k] = {
      n: arr.length,
      min: Math.min(...arr),
      max: Math.max(...arr),
      mean: parseFloat(mean.toFixed(4)),
      stddev: parseFloat(stddev.toFixed(4)),
      values: arr,
    };
  }
}

fs.writeFileSync('$SUMMARY_FILE', JSON.stringify(summary, null, 2));
console.log('Summary written to $SUMMARY_FILE');
"

echo ""
echo "Done. Results in $RESULTS_DIR/"
echo "  Per-run data: $RESULTS_DIR/run-NNN/"
echo "  Variance summary: $SUMMARY_FILE"
