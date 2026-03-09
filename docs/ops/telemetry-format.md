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

These fields are persisted in request dossiers under `runtime_state/dossiers/sessions/*`.
