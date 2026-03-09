# CTRE Phoenix 6 (Deep Dive)

## 🆕 Phoenix 6 Paradigm
- **Signals & Configs:** Uses a "Setter" and "Getter" pattern. Use `TalonFXConfiguration` objects.
- **Status Signals:** Use `StatusSignal<T>` for high-frequency data. Call `refresh()` before reading.
- **Units:** Phoenix 6 uses standard SI units (Rotations, Seconds, Volts, Amps) instead of arbitrary native units.

## 🚗 Drivetrain & Motors
- **Neutral Mode:** `MotorOutput.NeutralMode = NeutralModeValue.Brake`.
- **Stator Current Limits:** Better than Supply limits for protecting motor windings. Use `CurrentLimits.StatorCurrentLimitEnable = true`.
- **Supply Current Limits:** Protects your breakers and battery. Set `CurrentLimits.SupplyCurrentLimit = 40`.

## 🎯 Control Modes
- **DutyCycleOut:** Percent output (0.0 to 1.0).
- **PositionVoltage:** Precise position control using a Voltage-based PID.
- **VelocityVoltage:** Precise velocity control.
- **MotionMagic:** Trapezoidal profiling (S-Curve) for smooth movement. Requires `MotionMagicCruiseVelocity` and `MotionMagicAcceleration`.

## 📡 CAN Bus Optimization
- **CAN FD:** Supports faster update rates if using a CANivore.
- **Update Rates:** Change frequency of signals with `setUpdateFrequency()`.
- **Bus Names:** Default is `rio`, but use your CANivore name if applicable.
