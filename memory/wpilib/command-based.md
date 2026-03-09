# WPILib Command-Based Architecture

## 🏛️ Structure
- **Subsystems:** Singletons that wrap hardware (Speed Controllers, Sensors). Own the `periodic()` method for telemetry.
- **Commands:** State machines (initialize, execute, isFinished, end). MUST `addRequirements(subsystem)` to lock hardware.

## 🏭 Command Factories (Modern WPILib)
- **RunCommand:** Repeatedly calls a function.
- **InstantCommand:** Runs once.
- **SequentialCommandGroup:** Runs commands in order.
- **ParallelCommandGroup:** Runs commands simultaneously.
- **ParallelDeadlineGroup:** Runs all, ends when the FIRST one ends.
- **ParallelRaceGroup:** Runs all, ends when ANY one ends.

## 🎮 Operator Interface (OI)
- **CommandXboxController:** Use triggers/buttons to schedule commands.
- **Triggers:** `controller.a().onTrue(command)`.
- **Default Commands:** Use `subsystem.setDefaultCommand(command)` for things like Drivetrain teleop.

## ⚙️ Lifecycle
- **Initialize:** Setup code (reset encoders, set setpoints).
- **Execute:** Periodic logic (calculating PID, updating motor power).
- **isFinished:** Termination condition (reached goal, timer up).
- **End:** Cleanup (stop motors, retract pistons). `interrupted` boolean tells you why it ended.
