import { describe, expect, it } from "vitest";
import { withoutThinking } from "@/lib/dossier-ai";

function run(chunks: string[]) {
  let out = "";
  const push = withoutThinking((text) => (out += text));
  for (const chunk of chunks) push(chunk);
  return out;
}

describe("withoutThinking", () => {
  it("passes plain answers through", () => {
    expect(run(["## Resumo", " executivo\n", "a < b"])).toBe("## Resumo executivo\na < b");
  });

  it("drops a reasoning block split across chunks", () => {
    expect(run(["<thi", "nk>planejando", " o texto</th", "ink>\n\n## Resumo", " ok"])).toBe("## Resumo ok");
  });

  it("drops an empty reasoning block", () => {
    expect(run(["<think>\n\n</think>\n\n", "Texto"])).toBe("Texto");
  });
});
