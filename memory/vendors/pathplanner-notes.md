# PathPlanner (Deep Dive)

## 🗺️ Configuration
- **RobotConfig:** Must match your `DriveSubsystem` constants (Mass, MOI, Wheelbase, Wheel Radius, Max Linear/Angular Velocity).
- **AutoBuilder:** The primary way to integrate PathPlanner. Requires your `getPose`, `resetPose`, `getChassisSpeeds`, and `outputChassisSpeeds` methods.

## 🛠️ Auto Creation
- **Named Commands:** Register your commands by name (e.g., `"IntakeCommand"`) BEFORE loading paths.
- **Pathfinding:** Use `PathfindingCommand` for on-the-fly navigation around obstacles.

## 🔄 Mirroring & Alliance
- **Alliance Mirroring:** PathPlanner handles the flip from Red to Blue automatically if your starting pose and `resetPose` logic are correct.
- **Target Pose:** Always use the PathPlanner `getStartingHolonomicPose()` to ensure you start exactly where the trajectory begins.
