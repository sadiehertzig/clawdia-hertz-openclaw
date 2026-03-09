# Telemetry Format

Minimum per request:

- `request_id`
- `intent`
- `answer_mode`
- `stage_status`
- `elapsed_time_ms_by_stage`
- `serving_model_by_stage`
- `fallback_events`
- `worker_trace`
- `final_status`
- `self_improvement.telemetry`
- `self_improvement.quality_evaluation`
- `self_improvement.outcome`
- `worker_outputs.patternscout.source_receipts`
- `worker_outputs.patternscout.freshness_badge`

These fields are persisted in request dossiers under `runtime_state/dossiers/sessions/*`.
