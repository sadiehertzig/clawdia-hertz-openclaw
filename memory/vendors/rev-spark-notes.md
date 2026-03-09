# REV SPARK MAX & REVLib (Deep Dive)

## 🔧 Initialization & Config
- **Persist Settings:** Always use `burnFlash()` after configuration, but only at the end of the config block to save flash wear.
- **Factory Reset:** Use `restoreFactoryDefaults()` before applying new configs to ensure a clean state.
- **Inversion:** Set motor inversion with `setInverted(true/false)`. Note that this is stored in flash.

## 📈 Closed-Loop Control (PID)
- **Controller Object:** Get the `SparkMaxPIDController` via `m_motor.getPIDController()`.
- **Gains:** Set P, I, D, and FF (Feed Forward) for specific slots. 
- **Slot Usage:** Use different slots for different profiles (e.g., Slot 0 for Position, Slot 1 for Velocity).
- **IZone:** Crucial for preventing integral windup. Set a range where `kI` is allowed to accumulate.

## 🛡️ Safety & Guardrails
- **Current Limits:** `setSmartCurrentLimit(40)` (Amps). Default is 80A, which is high for many mechanisms.
- **Soft Limits:** `setSoftLimit(direction, rotationLimit)`. Enable with `enableSoftLimit(direction, true)`.
- **Idle Mode:** `setIdleMode(IdleMode.kBrake)` vs `kCoast`. Use Brake for arms/elevators.
- **Ramp Rates:** `setOpenLoopRampRate(seconds)` and `setClosedLoopRampRate(seconds)`. Helps prevent drivetrain lurching.

## 📊 Feedback & Sensors
- **Encoders:** NEOs use the built-in hall effect encoder. Set conversion factors with `setPositionConversionFactor()` and `setVelocityConversionFactor()`.
- **Absolute Encoders:** SPARK MAX supports Duty Cycle encoders (like REV Through Bore) via the Data Port.
