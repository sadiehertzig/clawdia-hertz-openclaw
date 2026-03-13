# WPILib Robot Simulation

## Running the Simulator
- `./gradlew simulateJava` launches the robot in desktop simulation mode.
- Requires a desktop JDK (not the RoboRIO cross-compiler). Most GradleRIO projects include this automatically.
- The HALSim GUI (Glass) opens by default, showing a virtual driver station and device widgets.
- To use a specific HALSim extension: `./gradlew simulateJava -PhalsimExtensions=halsim_gui,halsim_ws_server`

## SimDevice / SimDouble API
- **SimDevice:** Wraps a hardware abstraction so the sim can read/write its values.
- **SimDouble:** A simulated double-precision value exposed through a SimDevice.
- Pattern for wrapping a motor controller in sim:
  ```java
  // In your subsystem constructor
  if (RobotBase.isSimulation()) {
    SimDevice simDevice = SimDevice.create("MyMotor", port);
    simSpeed = simDevice.createDouble("speed", SimDevice.Direction.kBidir, 0.0);
  }
  ```
- The Glass GUI auto-discovers all SimDevices and shows editable widgets.

## Subsystem Lifecycle Hooks
- `simulationInit()` — called once when robot enters simulation mode. Set up sim models here.
- `simulationPeriodic()` — called every 20ms loop in sim. Update physics models and feed sensor values here.
- These are methods on `SubsystemBase` — override them in your subsystem class.

## HALSim Extensions
- `halsim_gui` (Glass) — default GUI for interacting with simulated devices.
- `halsim_ws_server` — WebSocket server for external sim tools (e.g., web dashboards).
- `halsim_ds_socket` — connects to a real Driver Station over the network.
- Extensions are configured in `build.gradle` under `wpi.sim.addGui()`, `wpi.sim.addWebsocketsServer()`, etc.

## "Works in Sim but Not on Robot" Checklist
1. **CAN IDs wrong or duplicated** — sim ignores CAN addressing; real robot does not.
2. **Motor inversion** — sim motors may not reflect physical inversion. Check `setInverted()`.
3. **Sensor direction** — encoders can read backwards on real hardware. Verify sign conventions.
4. **RobotBase.isSimulation() guards** — code inside these blocks never runs on the real robot.
5. **Timing differences** — sim runs at perfect 20ms; real robot has jitter and CAN latency.
6. **Missing vendor sim support** — not all vendor libraries support simulation (check CTRE/REV release notes).
7. **Network Tables** — sim NT server runs on localhost; real robot is at 10.TE.AM.2.
