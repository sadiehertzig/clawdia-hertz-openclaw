'use strict';

/**
 * Builder worker — code drafting for FRC robotics.
 *
 * Produces student-facing explanations and code blocks based on intent,
 * retrieval evidence, and librarian facts. Builder NEVER marks output as
 * reviewed — only Arbiter can do that.
 */

const JAVA_IMPORTS = {
  subsystem: [
    'import edu.wpi.first.wpilibj2.command.SubsystemBase;',
    'import com.ctre.phoenix6.hardware.TalonFX;',
    'import com.revrobotics.CANSparkMax;'
  ],
  command: [
    'import edu.wpi.first.wpilibj2.command.Command;',
    'import edu.wpi.first.wpilibj2.command.Commands;'
  ],
  autonomous: [
    'import com.pathplanner.lib.auto.AutoBuilder;',
    'import edu.wpi.first.math.geometry.Pose2d;'
  ],
  vision: [
    'import org.photonvision.PhotonCamera;',
    'import edu.wpi.first.math.geometry.Transform3d;'
  ]
};

const TEMPLATE_HINTS = {
  subsystem_or_command_draft: 'subsystem',
  autonomous_or_pathing: 'autonomous',
  vision_problem: 'vision',
  build_deploy_error: 'command',
  sensor_or_can_fault: 'subsystem'
};

function inferCodeCategory(intent, userMessage) {
  const msg = String(userMessage || '').toLowerCase();
  if (TEMPLATE_HINTS[intent]) return TEMPLATE_HINTS[intent];
  if (/subsystem|motor|intake|shooter|elevator|arm|climb/.test(msg)) return 'subsystem';
  if (/command|trigger|button|schedule/.test(msg)) return 'command';
  if (/auto|path|trajectory|pose|odometry/.test(msg)) return 'autonomous';
  if (/camera|vision|limelight|photon|april/.test(msg)) return 'vision';
  return 'command';
}

function gatherContext(payload) {
  const retrieval = payload?.retrieval_sources || [];
  const dossierOutputs = payload?.dossier?.worker_outputs || {};
  const librarianOut = dossierOutputs.librarian || {};
  const patternscoutOut = dossierOutputs.patternscout || {};

  return {
    facts: Array.isArray(librarianOut.facts) ? librarianOut.facts : [],
    key_apis: Array.isArray(librarianOut.key_apis) ? librarianOut.key_apis : [],
    sources: Array.isArray(librarianOut.sources) ? librarianOut.sources : [],
    matches: Array.isArray(patternscoutOut.matches) ? patternscoutOut.matches : [],
    retrieval_sources: retrieval
  };
}

function buildExplanation(intent, userMessage, context) {
  const parts = [];
  parts.push(`This is a draft implementation for your ${intent.replace(/_/g, ' ')} request.`);

  if (context.facts.length > 0) {
    parts.push(`\nKey facts from documentation:\n${context.facts.slice(0, 5).map((f) => `- ${f}`).join('\n')}`);
  }

  if (context.key_apis.length > 0) {
    parts.push(`\nRelevant APIs:\n${context.key_apis.slice(0, 5).map((a) => `- ${a}`).join('\n')}`);
  }

  parts.push('\n**Note:** This code is a draft and has NOT been reviewed. Do not deploy without Arbiter review.');

  return parts.join('\n');
}

function buildCodeBlocks(category, userMessage, context) {
  const msg = String(userMessage || '').toLowerCase();
  const imports = JAVA_IMPORTS[category] || JAVA_IMPORTS.command;
  const blocks = [];

  // Extract a meaningful name from the user message
  const nameMatch = msg.match(/(?:write|create|generate|make|build)\s+(?:a\s+|an?\s+)?(?:frc\s+)?(\w+)/);
  const rawName = nameMatch ? nameMatch[1] : category;
  const className = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  if (category === 'subsystem') {
    blocks.push({
      language: 'java',
      path: `src/main/java/frc/robot/subsystems/${className}Subsystem.java`,
      code: [
        'package frc.robot.subsystems;',
        '',
        ...imports,
        '',
        `public class ${className}Subsystem extends SubsystemBase {`,
        `  // TODO: Replace with actual motor controller and ports`,
        `  private final TalonFX motor = new TalonFX(0);`,
        '',
        `  public ${className}Subsystem() {`,
        '    // Configure motor defaults',
        '    // Set neutral mode, current limits at startup',
        '  }',
        '',
        '  public void run(double speed) {',
        '    motor.set(speed);',
        '  }',
        '',
        '  public void stop() {',
        '    motor.set(0);',
        '  }',
        '',
        '  @Override',
        '  public void periodic() {',
        '    // Telemetry updates',
        '  }',
        '}'
      ].join('\n')
    });
  } else if (category === 'command') {
    blocks.push({
      language: 'java',
      path: `src/main/java/frc/robot/commands/${className}Command.java`,
      code: [
        'package frc.robot.commands;',
        '',
        ...imports,
        '',
        `// Draft command — requires review before deployment`,
        `public class ${className}Command extends Command {`,
        `  public ${className}Command() {`,
        '    // Add subsystem requirements',
        '  }',
        '',
        '  @Override',
        '  public void execute() {',
        '    // TODO: implement',
        '  }',
        '',
        '  @Override',
        '  public boolean isFinished() {',
        '    return false;',
        '  }',
        '}'
      ].join('\n')
    });
  } else if (category === 'autonomous') {
    blocks.push({
      language: 'java',
      path: `src/main/java/frc/robot/autos/${className}Auto.java`,
      code: [
        'package frc.robot.autos;',
        '',
        ...imports,
        '',
        `// Draft autonomous — requires review and path tuning`,
        `public class ${className}Auto {`,
        `  public static Command create() {`,
        '    return AutoBuilder.followPath(/* path name */);',
        '  }',
        '}'
      ].join('\n')
    });
  } else if (category === 'vision') {
    blocks.push({
      language: 'java',
      path: `src/main/java/frc/robot/vision/${className}Vision.java`,
      code: [
        'package frc.robot.vision;',
        '',
        ...imports,
        '',
        `// Draft vision pipeline — requires review and calibration`,
        `public class ${className}Vision {`,
        '  private final PhotonCamera camera;',
        '',
        `  public ${className}Vision(String cameraName) {`,
        '    this.camera = new PhotonCamera(cameraName);',
        '  }',
        '',
        '  public boolean hasTarget() {',
        '    return camera.getLatestResult().hasTargets();',
        '  }',
        '}'
      ].join('\n')
    });
  }

  // Add context-sourced code snippets if available
  for (const match of (context.matches || []).slice(0, 2)) {
    if (match.excerpt && match.excerpt.length > 30) {
      blocks.push({
        language: 'java',
        path: match.path || 'reference_snippet',
        code: `// Reference from ${match.source_id || 'retrieval'}:\n// ${match.excerpt.slice(0, 400)}`
      });
    }
  }

  return blocks;
}

function builderWorker(payload) {
  const requestId = payload?.request_id || null;
  const intent = String(payload?.intent || 'subsystem_or_command_draft');
  const userMessage = String(payload?.user_message || '');
  const started = Date.now();

  const context = gatherContext(payload);
  const category = inferCodeCategory(intent, userMessage);

  const student_facing_explanation = buildExplanation(intent, userMessage, context);
  const code_blocks = buildCodeBlocks(category, userMessage, context);
  const facts = context.facts.slice(0, 8);

  const elapsed = Date.now() - started;

  return {
    request_id: requestId,
    status: 'success',
    kind: 'draft',
    summary: `Builder produced ${code_blocks.length} code block(s) for ${category} category`,
    student_facing_explanation,
    code_blocks,
    facts,
    warnings: [],
    // Builder must NEVER claim review
    contract_flags: {
      reviewed: false,
      escalated: false,
      implementation_safe: false,
      pattern_only: false
    },
    telemetry_hints: { elapsed_time_ms: elapsed }
  };
}

module.exports = { builderWorker, inferCodeCategory, gatherContext };
