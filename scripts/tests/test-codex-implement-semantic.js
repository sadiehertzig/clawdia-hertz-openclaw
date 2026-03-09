#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");

function extractFinalStatus(logText) {
  const matches = [...logText.matchAll(/^FINAL_STATUS:\s*(success|failure)\s*$/gim)];
  if (matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1][1].toLowerCase();
}

function evaluateSemanticResult({ exitCode, readLog }) {
  let semanticStatus = "success";
  let summary = "codex implementation run completed";

  if (exitCode !== 0) {
    semanticStatus = "error";
    summary = "codex implementation run failed";
  } else {
    let logText;

    try {
      logText = readLog();
    } catch (err) {
      semanticStatus = "error";
      summary = "codex implementation run completed but log output could not be read";
      logText = null;
    }

    if (logText !== null) {
      const finalStatus = extractFinalStatus(logText);

      if (finalStatus === "failure") {
        semanticStatus = "error";
        summary = "codex implementation run completed but reported task failure";
      } else if (finalStatus === "success") {
        semanticStatus = "success";
        summary = "codex implementation run completed";
      } else {
        semanticStatus = "error";
        summary = "codex implementation run completed without a final status marker";
      }
    }
  }

  return {
    status: semanticStatus,
    summary
  };
}

function testSuccess() {
  const result = evaluateSemanticResult({
    exitCode: 0,
    readLog: () => "stuff\nFINAL_STATUS: success\n"
  });

  assert.deepStrictEqual(result, {
    status: "success",
    summary: "codex implementation run completed"
  });
}

function testFailure() {
  const result = evaluateSemanticResult({
    exitCode: 0,
    readLog: () => "stuff\nFINAL_STATUS: failure\n"
  });

  assert.deepStrictEqual(result, {
    status: "error",
    summary: "codex implementation run completed but reported task failure"
  });
}

function testMissingMarker() {
  const result = evaluateSemanticResult({
    exitCode: 0,
    readLog: () => "stuff\nno final marker here\n"
  });

  assert.deepStrictEqual(result, {
    status: "error",
    summary: "codex implementation run completed without a final status marker"
  });
}

function testLastMarkerWins() {
  const result = evaluateSemanticResult({
    exitCode: 0,
    readLog: () => "FINAL_STATUS: success\nmiddle\nFINAL_STATUS: failure\n"
  });

  assert.deepStrictEqual(result, {
    status: "error",
    summary: "codex implementation run completed but reported task failure"
  });
}

function testUnreadableLog() {
  const result = evaluateSemanticResult({
    exitCode: 0,
    readLog: () => {
      throw new Error("ENOENT: missing log");
    }
  });

  assert.deepStrictEqual(result, {
    status: "error",
    summary: "codex implementation run completed but log output could not be read"
  });
}

function run() {
  testSuccess();
  console.log("ok - success");

  testFailure();
  console.log("ok - failure");

  testMissingMarker();
  console.log("ok - missing marker");

  testLastMarkerWins();
  console.log("ok - last marker wins");

  testUnreadableLog();
  console.log("ok - unreadable/missing log");

  console.log("\nRan 5 tests.");
}

run();