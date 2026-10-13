#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../helm/secureflow" && pwd)"
helm_bin="${HELM_BIN:-helm}"

for monitor in false true; do
  "$helm_bin" lint "$chart_dir" \
    --set secrets.authSecret=local-test-only \
    --set serviceMonitor.enabled="$monitor"
  "$helm_bin" template check "$chart_dir" \
    --set secrets.authSecret=local-test-only \
    --set serviceMonitor.enabled="$monitor" > /dev/null
done

metrics_service="$("$helm_bin" template check "$chart_dir" \
  --show-only templates/service.yaml \
  --set secrets.authSecret=local-test-only \
  --set app.service.port=9010 \
  --set service.portName=metrics)"
service_monitor="$("$helm_bin" template check "$chart_dir" \
  --show-only templates/servicemonitor.yaml \
  --set secrets.authSecret=local-test-only \
  --set serviceMonitor.enabled=true \
  --set service.portName=metrics)"

grep -Fq 'targetPort: http' <<< "$metrics_service"
grep -Fq 'name: metrics' <<< "$metrics_service"
grep -Fq 'port: metrics' <<< "$service_monitor"
grep -Fq 'secureflow-metrics: "true"' <<< "$metrics_service"
grep -Fq 'secureflow-metrics: "true"' <<< "$service_monitor"

app_service="$("$helm_bin" template check "$chart_dir" \
  --show-only templates/app-service.yaml \
  --set secrets.authSecret=local-test-only)"
if grep -Fq 'secureflow-metrics:' <<< "$app_service"; then
  echo 'Application Service must not match the metrics ServiceMonitor' >&2
  exit 1
fi
