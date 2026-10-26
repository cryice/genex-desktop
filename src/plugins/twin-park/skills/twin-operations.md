# Twin operations applications

Keep four runtime concerns separate: telemetry samples, historical replay, alarms and commands. A dashboard reads normalized IR data and never talks to a renderer node directly.

- Telemetry shows value, unit, timestamp and quality.
- Replay selects a bounded time window and declares its clock.
- Alarms include severity, active state, source device and acknowledgement history.
- Commands require permission, explicit confirmation and an audit record before dispatch.

Disconnected, stale and bad-quality states are visible and never silently treated as zero.
