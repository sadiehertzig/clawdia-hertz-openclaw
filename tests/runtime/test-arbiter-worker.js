#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { arbiterWorker, analyzeCode, detectSafetyRelevance } = require('../../agents/arbiter/arbiter_worker');

function testApproveCleanCode() {
  const result = arbiterWorker({
    request_id: 'test-arb-1',
    intent: 'subsystem_or_command_draft',
    user_message: 'write intake subsystem',
    dossier: {
      worker_outputs: {
        builder: {
          code_blocks: [{
            language: 'java',
            path: 'Intake.java',
            code: [
              'public class IntakeSubsystem extends SubsystemBase {',
              '  private final TalonFX motor = new TalonFX(1);',
              '',
              '  public IntakeSubsystem() {',
              '    motor.getConfigurator().apply(new TalonFXConfiguration().withCurrentLimits(new CurrentLimitsConfigs().withStatorCurrentLimit(60)));',
              '    motor.setNeutralMode(NeutralModeValue.Brake);',
              '  }',
              '',
              '  @Override',
              '  public void periodic() {}',
              '}'
            ].join('\n')
          }],
          student_facing_explanation: 'Draft intake'
        }
      }
    }
  });

  assert.equal(result.status, 'success');
  assert.equal(result.verdict, 'approve');
  assert.equal(result.contract_flags.reviewed, true);
  assert.equal(result.contract_flags.implementation_safe, true);
}

function testReviseWithConcerns() {
  const result = arbiterWorker({
    request_id: 'test-arb-2',
    intent: 'subsystem_or_command_draft',
    user_message: 'write shooter subsystem',
    dossier: {
      worker_outputs: {
        builder: {
          code_blocks: [{
            language: 'java',
            path: 'Shooter.java',
            code: [
              'public class ShooterSubsystem extends SubsystemBase {',
              '  private final TalonFX motor = new TalonFX(2);',
              '  public void spin(double speed) { motor.set(speed); }',
              '}'
            ].join('\n')
          }],
          student_facing_explanation: 'Draft shooter'
        }
      }
    }
  });

  assert.equal(result.status, 'success');
  assert.equal(result.verdict, 'revise');
  assert.ok(result.concern_list.length > 0, 'should have concerns for missing current limit/neutral mode');
  assert.ok(result.revised_output, 'should provide revised output');
  assert.equal(result.contract_flags.reviewed, true);
}

function testEscalateSafetyCritical() {
  const result = arbiterWorker({
    request_id: 'test-arb-3',
    intent: 'sensor_or_can_fault',
    user_message: 'CAN bus brownout and motor stall',
    dossier: {
      worker_outputs: {
        builder: {
          code_blocks: [{
            language: 'java',
            path: 'Motor.java',
            code: 'private final TalonFX motor = new TalonFX(1);\nmotor.set(speed);'
          }],
          student_facing_explanation: 'Motor fix'
        }
      }
    }
  });

  assert.equal(result.status, 'success');
  assert.equal(result.verdict, 'escalate');
  assert.equal(result.contract_flags.escalated, true);
  assert.equal(result.contract_flags.reviewed, false);
}

function testNoCodeApprove() {
  const result = arbiterWorker({
    request_id: 'test-arb-4',
    intent: 'api_docs_lookup',
    user_message: 'What is TalonFX constructor?',
    dossier: { worker_outputs: {} }
  });

  assert.equal(result.verdict, 'approve');
  assert.equal(result.contract_flags.reviewed, true);
}

function testAnalyzeCodeDetectsConcerns() {
  const concerns = analyzeCode([{
    code: 'private final CANSparkMax motor = new CANSparkMax(1, MotorType.kBrushless);'
  }]);

  assert.ok(concerns.some((c) => c.id === 'no_current_limit'));
  assert.ok(concerns.some((c) => c.id === 'no_neutral_mode'));
}

function testDetectSafetyRelevance() {
  assert.equal(detectSafetyRelevance('motor brownout issue', ''), true);
  assert.equal(detectSafetyRelevance('write intake', 'sensor_or_can_fault'), true);
  assert.equal(detectSafetyRelevance('write intake', 'subsystem_or_command_draft'), false);
}

function testCheckerFailedAddsConcern() {
  const result = arbiterWorker({
    request_id: 'test-arb-5',
    intent: 'subsystem_or_command_draft',
    user_message: 'write subsystem',
    dossier: {
      worker_outputs: {
        builder: {
          code_blocks: [{ language: 'java', path: 'A.java', code: 'class A {}' }],
          student_facing_explanation: 'draft'
        },
        checker: { overall_status: 'fail' }
      }
    }
  });

  assert.ok(result.concern_list.some((c) => c.id === 'checker_failed'));
}

function run() {
  testApproveCleanCode();
  console.log('ok - approve clean code');

  testReviseWithConcerns();
  console.log('ok - revise with concerns');

  testEscalateSafetyCritical();
  console.log('ok - escalate safety-critical');

  testNoCodeApprove();
  console.log('ok - no-code approve');

  testAnalyzeCodeDetectsConcerns();
  console.log('ok - analyzeCode detects missing config');

  testDetectSafetyRelevance();
  console.log('ok - safety relevance detection');

  testCheckerFailedAddsConcern();
  console.log('ok - checker failure adds concern');

  console.log('\nRan 7 tests.');
}

run();
