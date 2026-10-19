import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFixedInputEditor,
  EditorRegistry,
  sameFixedSnapshot,
  BlockEditorConflictError,
} from "@kubohiroya/turbowarp-extension-data-editor";
import type {
  BlockEditorHost,
  FixedBlockSnapshot,
  FixedInputEditorOptions,
  FixedHostCommitRequest,
  JsonObject,
  JsonValue,
} from "@kubohiroya/turbowarp-extension-data-editor";
import {
  fixedInputEditorOptions,
  fixedNumber,
  registerFixedInputEditors,
} from "../src/fixed-input-editors.js";
import { SvgTextExtension } from "../src/extension.js";
import definitions from "../src/block-definitions.json";
import previousGetInfo from "./fixtures/fixed-getinfo-before.json";
import schemas from "../schemas/block-editor-fixed-inputs.schema.json";

const options = fixedInputEditorOptions();
it("expands only NEW short color input to case-preserving six digits", async () => {
  const option = options[0]!;
  for (const [logical, encoded] of [
    ["#AbC", "#AAbbCC"],
    ["#ABCDEF", "#ABCDEF"],
  ]) {
    const f = fixture(option, {
      BACKGROUND: { literal: "#112233" },
      TEXT_COLOR: { literal: "#445566" },
      SIZE: { literal: "100" },
      ALIGN: { literal: "left" },
    });
    f.set("BACKGROUND", logical!);
    expect((await f.session.save()).status).toBe("saved");
    expect(f.requests[0]!.changes).toEqual([
      { argument: "BACKGROUND", value: encoded },
    ]);
    f.session.dispose();
    f.remove();
  }
  const old = fixture(option, {
    BACKGROUND: { literal: "#AbC" },
    TEXT_COLOR: { literal: "#DEF" },
    SIZE: { literal: "100" },
    ALIGN: { literal: "left" },
  });
  expect(await old.session.save()).toEqual({ status: "saved", changed: false });
  expect(old.args.BACKGROUND).toEqual({ kind: "literal", value: "#AbC" });
  expect(old.args.TEXT_COLOR).toEqual({ kind: "literal", value: "#DEF" });
  old.session.dispose();
  old.remove();
});
it("retains broader existing runtime colors and rejects new native-field alpha candidates atomically", async () => {
  const option = options[0]!;
  for (const raw of ["#AbCd", "#11223344", "transparent", "rebeccapurple"]) {
    const f = fixture(option, {
      BACKGROUND: { literal: raw },
      TEXT_COLOR: { literal: raw },
      SIZE: { literal: "100" },
      ALIGN: { literal: "left" },
    });
    const before = structuredClone(f.live.arguments);
    expect(await f.session.save()).toEqual({ status: "saved", changed: false });
    expect(f.live.arguments).toEqual(before);
    f.session.dispose();
    f.remove();
  }
  for (const candidate of ["#abcd", "#11223344"]) {
    const f = fixture(option, {
      BACKGROUND: { literal: "#112233" },
      TEXT_COLOR: { literal: "#445566" },
      SIZE: { literal: "100" },
      ALIGN: { literal: "left" },
    });
    const before = structuredClone(f.live.arguments);
    f.set("BACKGROUND", candidate);
    f.set("SIZE", 200, "200");
    expect((await f.session.save()).status).toBe("invalid");
    expect(f.requests).toHaveLength(0);
    expect(f.live.arguments).toEqual(before);
    f.session.dispose();
    f.remove();
  }
});
function scratch(api?: unknown) {
  return {
    ArgumentType: {
      NUMBER: "number",
      STRING: "string",
      COLOR: "color",
      BOOLEAN: "Boolean",
    },
    BlockType: {
      COMMAND: "command",
      REPORTER: "reporter",
      BOOLEAN: "Boolean",
      HAT: "hat",
    },
    translate: (v: unknown) =>
      typeof v === "string" ? v : (v as { default: string }).default,
    Cast: { toNumber: Number, toString: String },
    extensions: { unsandboxed: true },
    ...(api ? { gui: { blockEditors: api } } : {}),
  };
}
const invalidTokens = [
  "",
  " ",
  "0x10",
  "+1",
  "001",
  "1.",
  ".5",
  "1e",
  "1e999",
  "NaN",
  "Infinity",
];
function fixture(
  option: FixedInputEditorOptions,
  seed: Record<
    string,
    { literal?: string; source?: "reporter" | "unsupported" | "missing" }
  >,
  failCommit = false,
) {
  const definition = createFixedInputEditor(option);
  const registry = new EditorRegistry();
  const remove = registry.registerFixed(definition);
  const live: FixedBlockSnapshot = {
    targetId: "sprite",
    blockId: "fixed",
    opcode: option.opcodes[0]!,
    revision: "1",
    arguments: {},
    fixedContext: {
      contractId: option.contractId,
      contractRevision: option.contractRevision,
      generation: "g1",
      readOnlyArguments: option.readOnlyArguments ?? [],
      dependencies: option.dependencies ?? [],
      inputs: {},
    },
  };
  const args = live.arguments as Record<string, unknown>;
  const inputs = live.fixedContext.inputs as Record<string, unknown>;
  for (const [name, spec] of Object.entries(seed)) {
    const source = spec.source ?? "shadow";
    const role = option.readOnlyArguments?.includes(name)
      ? "readonly"
      : "editable";
    if (source === "reporter") args[name] = { kind: "reporter" };
    else if (source !== "missing")
      args[name] = { kind: "literal", value: spec.literal ?? "unsupported" };
    if (
      !option.bindings.some((binding) => binding.argument === name) &&
      !option.readOnlyArguments?.includes(name)
    )
      continue;
    inputs[name] = {
      source,
      role,
      ...(source === "unsupported" || source === "missing"
        ? { reason: "Unavailable standard field." }
        : {}),
      identity: `${name}:1`,
      ...(source === "shadow"
        ? { field: { blockId: `${name}:shadow`, name: "TEXT", type: "text" } }
        : {}),
    };
  }
  const requests: FixedHostCommitRequest[] = [];
  const invalidation = new Set<(error: unknown) => void>();
  const commit = (request: FixedHostCommitRequest) => {
    if (!sameFixedSnapshot(request.expected, live))
      throw new BlockEditorConflictError("changed");
    if (
      request.changes.some(
        (change) =>
          !definition.editableArguments.includes(change.argument) ||
          definition.readOnlyArguments.includes(change.argument),
      )
    )
      throw new Error("readonly patch");
    if (failCommit) throw new Error("commit rejected");
    for (const change of request.changes)
      args[change.argument] = { kind: "literal", value: change.value };
    requests.push(request);
  };
  const host: BlockEditorHost = {
    readBlock: () => live,
    commit: () => {
      throw new Error("legacy path");
    },
    fixedInputs: {
      capability: "fixed-inputs-v1",
      readBlock: () => live,
      commit,
      subscribeInvalidation: (_r, _d, listener) => {
        invalidation.add(listener);
        return () => {
          invalidation.delete(listener);
        };
      },
    },
  };
  const open = () => registry.open(live, host)!;
  const session = open();
  const set = (name: string, value: JsonValue, buffer?: string) => {
    const draft = session.getDraft();
    const entries = draft.inputs as JsonObject;
    entries[name] = {
      value,
      changed: true,
      ...(buffer === undefined ? {} : { buffer }),
    };
    session.setDraft(draft);
  };
  return {
    definition,
    registry,
    remove,
    live,
    args,
    inputs,
    requests,
    commit,
    session,
    set,
    open,
    invalidate: () => {
      for (const listener of invalidation) listener(new Error("scope changed"));
    },
  };
}

describe("fixed input owner contracts", () => {
  it("has exact planned bindings and canonical Schema provenance", () => {
    expect(options.flatMap((o) => o.bindings).length).toBe(4);
    for (const option of options) {
      const opcode = option.opcodes[0]!.slice(option.extensionId.length + 1);
      const block = definitions.blocks.find((b) => b.opcode === opcode)!;
      expect(block).toBeDefined();
      expect(option.bindings.map((b) => b.argument).sort()).toEqual(
        Object.keys(
          schemas.$defs[opcode as keyof typeof schemas.$defs].properties,
        ).sort(),
      );
      for (const binding of option.bindings) {
        expect(block.arguments).toHaveProperty(binding.argument);
        const factory = createFixedInputEditor(option);
        expect(factory.saveContract).toBe("prepared-fixed-v1");
        expect(binding.schemaBundle.root.artifact.role).toBe(
          "canonical-schema",
        );
        expect(binding.schemaBundle.root.artifact.source.symbol).toBe(
          `/$defs/${opcode}/properties/${binding.argument}`,
        );
      }
    }
  });
  it("registers only the optional capability at getInfo and leaves all metadata unchanged", () => {
    const calls: FixedInputEditorOptions[] = [];
    const removed = vi.fn();
    const events = new Map<string, () => void>();
    const runtime = {
      on: (name: string, fn: () => void) => events.set(name, fn),
      off: (name: string) => events.delete(name),
    };
    vi.stubGlobal(
      "Scratch",
      scratch({
        apiVersion: 1,
        registerFixedInputEditor: (o: FixedInputEditorOptions) => {
          calls.push(o);
          return removed;
        },
      }),
    );
    const extension = new SvgTextExtension(runtime as never);
    expect(calls).toHaveLength(0);
    expect(extension.getInfo()).toEqual(previousGetInfo);
    extension.getInfo();
    expect(calls).toHaveLength(options.length);
    expect(calls.map((o) => o.opcodes)).toEqual(options.map((o) => o.opcodes));
    events.get("RUNTIME_DISPOSED")?.();
    events.get("RUNTIME_DISPOSED")?.();
    expect(removed).toHaveBeenCalledTimes(options.length);
    vi.unstubAllGlobals();
  });
  it("keeps old hosts inert and rolls back partial registration", () => {
    for (const api of [
      undefined,
      { apiVersion: 1 },
      {
        apiVersion: 2,
        registerFixedInputEditor: () => {
          throw new Error();
        },
      },
    ])
      expect(registerFixedInputEditors(scratch(api), {})).toBeUndefined();
    const remove = vi.fn();
    let calls = 0;
    const api = {
      apiVersion: 1,
      registerFixedInputEditor: () => {
        if (calls++ === 1) throw new Error("registration failure");
        return remove;
      },
    };
    if (options.length > 1) {
      expect(() => registerFixedInputEditors(scratch(api), {})).toThrow();
      expect(remove).toHaveBeenCalledOnce();
    } else {
      const dispose = registerFixedInputEditors(
        scratch({ apiVersion: 1, registerFixedInputEditor: () => remove }),
        {},
      );
      dispose?.();
      dispose?.();
      expect(remove).toHaveBeenCalledOnce();
    }
  });
  it("validates numeric lexical input without buffer and retains valid numeric tokens", () => {
    const numeric = options
      .flatMap((o) => o.bindings)
      .filter((b) => b.control?.kind === "number");
    for (const binding of numeric)
      for (const token of invalidTokens) {
        expect(
          () =>
            binding.encode(token, {
              consumerId: "test",
              nowMs: 0,
              settings: null,
            }),
          `${binding.argument}:${token}`,
        ).toThrow();
        // Owner semantic validation also accepts finite legacy aliases in unchanged dependencies.
        if (["", " ", "1e", "1e999", "NaN", "Infinity"].includes(token)) {
          expect(
            binding.validateCandidate(
              token,
              { consumerId: "test", nowMs: 0, settings: null },
              {} as never,
            ),
          ).not.toHaveLength(0);
        }
      }
    for (const token of ["-0", "1e2", "1.25"]) {
      expect(fixedNumber(token)).toBe(Number(token));
      for (const binding of numeric)
        expect(
          binding.encode(token, {
            consumerId: "test",
            nowMs: 0,
            settings: null,
          }),
        ).toBe(token);
    }
    for (const binding of numeric)
      for (const raw of ["", " ", "Infinity", "NaN"]) {
        expect(() => binding.read(raw)).toThrow();
      }
  });
  it("retains every unchanged raw and reporter without invoking encode or runtime functions", async () => {
    for (const option of options) {
      const seed = Object.fromEntries(
        option.bindings.map((b) => [
          b.argument,
          {
            literal:
              b.control?.kind === "number"
                ? " 0x10 "
                : ((b.control?.choices?.[0]?.value as string) ?? "#AbC"),
          },
        ]),
      );
      for (const arg of option.readOnlyArguments ?? [])
        seed[arg] = { literal: "ready" };
      const f = fixture(option, seed);
      const before = structuredClone(f.live.arguments);
      expect(await f.session.save()).toEqual({
        status: "saved",
        changed: false,
      });
      expect(f.live.arguments).toEqual(before);
      expect(f.requests).toHaveLength(0);
      f.session.dispose();
      f.remove();
    }
  });
  it("makes standard numeric boundary validation match the canonical fixed Schema", () => {
    const ctx = { consumerId: "test", nowMs: 0, settings: null };
    for (const option of options)
      for (const binding of option.bindings) {
        if (binding.control?.kind !== "number") continue;
        const opcode = option.opcodes[0]!.slice(option.extensionId.length + 1);
        const property = (
          schemas.$defs as unknown as Record<
            string,
            {
              properties: Record<
                string,
                { minimum?: number; exclusiveMinimum?: number; type: string }
              >;
            }
          >
        )[opcode]!.properties[binding.argument]!;
        if (property.exclusiveMinimum === 0)
          expect(
            binding.validateCandidate("0", ctx, {} as never),
          ).not.toHaveLength(0);
        if (property.minimum === 0)
          expect(
            binding.validateCandidate("-1", ctx, {} as never),
          ).not.toHaveLength(0);
        if (property.type === "integer")
          expect(
            binding.validateCandidate("1.5", ctx, {} as never),
          ).not.toHaveLength(0);
        expect(binding.validateCandidate("2", ctx, {} as never)).toHaveLength(
          0,
        );
      }
  });
  it("has local docsURI anchors and linked fixed editing rules for every target", () => {
    const html = readFileSync(
      new URL("../docs/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain('id="fixed-input-editing"');
    for (const option of options) {
      const opcode = option.opcodes[0]!.slice(option.extensionId.length + 1);
      expect(html).toContain(`id="block-${opcode}"`);
      expect(html).toContain(`href="#block-${opcode}"`);
    }
    expect(html).toContain('href="#fixed-input-editing"');
  });
});

it("saves SVG color/number/menu together and retains FONT/STYLE and unknown old raws", async () => {
  const option = options[0]!;
  const f = fixture(option, {
    BACKGROUND: { literal: "#AbC" },
    TEXT_COLOR: { literal: "#575e75" },
    SIZE: { literal: " 1e2 " },
    ALIGN: { literal: "left" },
    FONT: { literal: "Legacy Font" },
    STYLE: { literal: "legacy" },
  });
  f.set("BACKGROUND", "#445566");
  f.set("TEXT_COLOR", "#112233");
  f.set("SIZE", -12.5, "-12.5");
  f.set("ALIGN", "right");
  expect((await f.session.save()).status).toBe("saved");
  expect(f.requests[0]!.changes).toHaveLength(4);
  expect(f.args.FONT).toEqual({ kind: "literal", value: "Legacy Font" });
  expect(f.args.STYLE).toEqual({ kind: "literal", value: "legacy" });
  const unknown = fixture(option, {
    BACKGROUND: { literal: "transparent" },
    TEXT_COLOR: { literal: "legacy-color" },
    SIZE: { literal: "" },
    ALIGN: { literal: "unknown" },
  });
  expect(await unknown.session.save()).toEqual({
    status: "saved",
    changed: false,
  });
  expect(unknown.requests).toHaveLength(0);
});

it("keeps the existing SIZE runtime fallback/clamp independent of the finite editing policy", () => {
  vi.stubGlobal("Scratch", scratch());
  const extension = new SvgTextExtension({ on: () => {} } as never);
  const normalize = (
    extension as unknown as { normalizeFontPercent: (value: unknown) => number }
  ).normalizeFontPercent.bind(extension);
  for (const value of ["", " ", "NaN", "Infinity"])
    expect(normalize(value)).toBe(100);
  expect(normalize(-12.5)).toBe(1);
  expect(normalize(1.25)).toBe(1.25);
  expect(normalize(1001)).toBe(1000);
  vi.unstubAllGlobals();
});
