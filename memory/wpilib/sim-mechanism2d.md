# WPILib Physics Simulation & Mechanism2d

## Physics Simulation Classes
WPILib provides ready-made physics models for common FRC mechanisms:

- **FlywheelSim** — simulates a spinning mass (shooter wheels, intake rollers).
  ```java
  FlywheelSim sim = new FlywheelSim(DCMotor.getNEO(1), gearRatio, momentOfInertia);
  ```
- **SingleJointedArmSim** — simulates a pivoting arm with gravity.
  ```java
  SingleJointedArmSim sim = new SingleJointedArmSim(
    DCMotor.getNEO(1), gearRatio, moi, armLengthMeters,
    minAngleRads, maxAngleRads, simulateGravity, startingAngleRads);
  ```
- **ElevatorSim** — simulates a linear elevator with gravity.
  ```java
  ElevatorSim sim = new ElevatorSim(
    DCMotor.getNEO(2), gearRatio, massKg, drumRadiusMeters,
    minHeightMeters, maxHeightMeters, simulateGravity, startingHeightMeters);
  ```
- **DifferentialDrivetrainSim** — full drivetrain physics for tank drive.

## DCMotor Models
- `DCMotor.getNEO(numMotors)` — REV NEO brushless
- `DCMotor.getFalcon500(numMotors)` — CTRE Falcon 500
- `DCMotor.getNeo550(numMotors)` — REV NEO 550
- `DCMotor.getCIM(numMotors)` — CIM motor
- Always pass the correct number of motors for ganged setups.

## Using Physics Sims in simulationPeriodic()
```java
@Override
public void simulationPeriodic() {
  // Feed the motor voltage into the sim
  flywheelSim.setInputVoltage(motor.get() * RobotController.getBatteryVoltage());
  // Advance the sim by one timestep
  flywheelSim.update(0.020);
  // Write the sim state back to the encoder
  encoderSim.setRate(flywheelSim.getAngularVelocityRPM() / 60.0);
}
```

## Mechanism2d Visualization
- `Mechanism2d` is a 2D canvas widget displayed in Glass/SmartDashboard.
- Add `MechanismLigament2d` objects to visualize arms, elevators, or custom linkages.
- Update ligament angles/lengths in `simulationPeriodic()` to animate the visualization.
- Publish via `SmartDashboard.putData("Mechanism", mechanism2d)`.

## Common Errors
1. **Wrong gear ratio** — sim gear ratio must match physical robot. Off by one stage = wildly wrong speeds.
2. **Wrong moment of inertia** — use CAD values or WPILib's `Units` helpers. Wrong MOI = unrealistic acceleration.
3. **Forgetting `sim.update(dt)`** — the sim won't advance without this call every loop.
4. **Not feeding voltage** — must call `sim.setInputVoltage()` with actual motor output, not just a setpoint.
5. **Battery voltage** — use `RobotController.getBatteryVoltage()`, not a hardcoded 12.0. Sim models brownout.
