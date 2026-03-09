# WPILib Pose Estimator Notes

- Pose estimation fuses odometry and vision measurements.
- Vision timestamps must align with robot state history.
- Poor covariance tuning can destabilize estimates.

Common pitfall: applying stale camera data as if it were current.
