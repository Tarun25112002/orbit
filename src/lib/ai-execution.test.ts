import { describe, expect, it } from "vitest";
import { parseAiExecutionTrace } from "@/lib/ai-execution";

describe("ai-execution", () => {
  it("normalizes run_command when command contains inline args", () => {
    const trace = parseAiExecutionTrace({
      operations: [
        {
          type: "run_command",
          command: "npm run dev -- --host 0.0.0.0",
        },
      ],
    });

    expect(trace?.operations).toEqual([
      {
        type: "run_command",
        command: "npm",
        commandArgs: ["run", "dev", "--", "--host", "0.0.0.0"],
      },
    ]);
  });

  it("merges inline and explicit command args for run_command", () => {
    const trace = parseAiExecutionTrace({
      operations: [
        {
          type: "run_command",
          command: "npm run dev",
          commandArgs: ["--", "--port", "4173"],
        },
      ],
    });

    expect(trace?.operations).toEqual([
      {
        type: "run_command",
        command: "npm",
        commandArgs: ["run", "dev", "--", "--port", "4173"],
      },
    ]);
  });

  it("normalizes background command keys", () => {
    const trace = parseAiExecutionTrace({
      operations: [
        {
          type: "start_background_command",
          key: " Dev Server ",
          command: "pnpm run dev",
        },
      ],
    });

    expect(trace?.operations).toEqual([
      {
        type: "start_background_command",
        key: "dev-server",
        command: "pnpm",
        commandArgs: ["run", "dev"],
      },
    ]);
  });

  it("rejects invalid path operations", () => {
    const trace = parseAiExecutionTrace({
      operations: [
        {
          type: "create_file",
          path: "../secrets.txt",
        },
      ],
    });

    expect(trace).toBeNull();
  });

  it("caps parsed operations to the configured limit", () => {
    const operations = Array.from({ length: 250 }, (_, index) => ({
      type: "create_file",
      path: `src/generated-${index}.ts`,
    }));

    const trace = parseAiExecutionTrace({ operations });

    expect(trace).not.toBeNull();
    expect(trace?.operations).toHaveLength(200);
  });
});
