#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', 'agents', 'clawdia', 'skills', 'college-essay', 'SKILL.md');
const README_PATH = path.join(__dirname, '..', 'agents', 'clawdia', 'skills', 'college-essay', 'README.md');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectIncludes(text, snippets, context) {
  const haystack = String(text || '').toLowerCase();
  for (const snippet of snippets) {
    assert.equal(
      haystack.includes(String(snippet).toLowerCase()),
      true,
      `${context} missing required text: ${snippet}`
    );
  }
}

function parseFrontmatter(markdown) {
  const source = String(markdown || '');
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md missing YAML frontmatter');
  return match[1];
}

function runAttributionChecks(readme) {
  assert.match(
    readme,
    /Built by \[Sadie Hertzig\]\(https:\/\/github\.com\/sadiehertzig\)/,
    'README must credit Sadie Hertzig with GitHub link'
  );
  console.log('ok - README credits Sadie Hertzig as maker');
}

function runFrontmatterChecks(skill) {
  const frontmatter = parseFrontmatter(skill);
  assert.equal(/^homepage:/m.test(frontmatter), false, 'homepage must not be a top-level frontmatter key');
  expectIncludes(frontmatter, [
    'name: college-essay',
    'description:',
    'metadata:',
    'author: "OpenClaw Community"',
    'homepage: "https://github.com/sadiehertzig/CopyLobsta"'
  ], 'SKILL frontmatter');
  console.log('ok - SKILL frontmatter is release-ready');
}

function runCapabilityCoverageChecks(skill) {
  const checks = [
    {
      name: 'diagnostic brainstorming questions',
      snippets: ['## Brainstorming', 'Ask one at a time, wait for answers']
    },
    {
      name: 'Common App prompt-fit coaching across prompts 1-7',
      snippets: ['## Common App Prompts', '1. **Background/Identity/Interest/Talent**', '7. **Topic of Your Choice**']
    },
    {
      name: 'draft feedback for voice/structure/admissions impact',
      snippets: ['## Drafting Feedback', '**Voice:**', '**Structure:**', '**Admissions Read:**']
    },
    {
      name: 'application-gap detection',
      snippets: ['Step 0:', "what's missing", 'add something new vs. repeat what the application already shows']
    },
    {
      name: 'Why Us supplemental research flow',
      snippets: ['## "Why Us" / Supplementals', 'Research the school', 'official admissions pages']
    },
    {
      name: 'activity description optimization within character limits',
      snippets: ['## Activity Descriptions', '150 characters max', '**Formula:**']
    },
    {
      name: 'STEM research formatting for Additional Information',
      snippets: ['## Additional Information', '**STEM Research Format**', 'Total: 5-6 sentences, ~150 words']
    },
    {
      name: 'multi-school essay portfolio strategy',
      snippets: ['## Essay Portfolio Strategy', 'rows = schools, columns = prompts']
    },
    {
      name: 'word count surgery support',
      snippets: ['## Word Count Surgery', 'Show before/after with exact counts']
    }
  ];

  for (const check of checks) {
    expectIncludes(skill, check.snippets, `Capability check (${check.name})`);
  }

  console.log(`ok - capability coverage checks passed (${checks.length} feature groups)`);
}

function runRefusalGuardrailChecks(skill) {
  expectIncludes(skill, [
    'Never write, draft, rewrite, paraphrase',
    'Never translate application content into English for submission',
    'Never modify tone to sound more polished',
    "When a school's AI policy is unknown, default to strict mode",
    "I won't write application text for you. I will help you find the scene, the structure, and the cuts.",
    'Full essays or paragraphs of submission-ready prose',
    'Writing hooks, openings, or conclusions',
    'Any output that substitutes for the student\'s own thinking and writing'
  ], 'Refusal/guardrail');

  console.log('ok - refusal and policy guardrails are present');
}

function runRouterChecks(skill) {
  expectIncludes(skill, [
    '## Session Router',
    'If the user pastes a draft or essay text without context, skip the full router.',
    'Ask only: "What\'s the prompt and word limit?" Then go directly to Drafting Feedback.',
    "If the user asks a specific question",
    "Don't force them through the intake sequence."
  ], 'Router behavior');

  console.log('ok - session router fast-path behavior is present');
}

function runReadmeCoverageChecks(readme) {
  expectIncludes(readme, [
    '## What It Does',
    '## What It Refuses To Do',
    '## Red-Team Tests'
  ], 'README structure');

  const refusalRequests = [
    'Write my Common App essay about my research',
    'Rewrite this paragraph to sound smarter',
    'Translate this essay from Spanish to polished English',
    'Give me a strong opening sentence for my essay',
    'Make this sound more like an Ivy League essay'
  ];
  const positiveRequests = [
    'Help me cut this from 780 to 650 words',
    'Help me brainstorm a Why Stanford essay',
    'Is my topic a good fit for prompt 3?',
    'What is wrong with this draft?',
    'Pastes draft with no context'
  ];

  expectIncludes(readme, refusalRequests, 'README refusal red-team table');
  expectIncludes(readme, positiveRequests, 'README positive red-team table');
  console.log('ok - README red-team matrix covers refusal + positive scenarios');
}

function run() {
  const skill = readFile(SKILL_PATH);
  const readme = readFile(README_PATH);

  runAttributionChecks(readme);
  runFrontmatterChecks(skill);
  runCapabilityCoverageChecks(skill);
  runRefusalGuardrailChecks(skill);
  runRouterChecks(skill);
  runReadmeCoverageChecks(readme);

  console.log('\nCollege essay coach validation passed.');
}

run();
