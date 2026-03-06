# WPILib Command-Based Quick Rules

## Core pieces
- Subsystem: owns hardware
- Command: performs actions using subsystems
- RobotContainer: button bindings + auto chooser

## Rules
- Commands must addRequirements(subsystem)
- Only one command can control a subsystem at a time
- Set a default command for drive subsystem

## Common Issues
- Button does nothing → binding issue
- Command cancels → subsystem conflict
