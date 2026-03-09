# WPILib Scheduler Notes

- Scheduler runs each robot loop and owns command lifecycle.
- Unexpected cancel/interrupt behavior usually means requirement conflicts.
- Use command naming and logging for debugging schedule churn.
