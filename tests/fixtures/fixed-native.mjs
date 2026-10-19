import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { setTimeout } from "node:timers";
import {
  createFixedInputEditor,
  EditorRegistry,
} from "@kubohiroya/turbowarp-extension-data-editor";
import { createTurboWarpBlockEditorHost } from "@kubohiroya/turbowarp-extension-data-editor/turbowarp";
const require = createRequire(import.meta.url);
const gui = process.env.BLOCK_EDITOR_GUI_ROOT;
assert.ok(
  gui && path.isAbsolute(gui),
  "BLOCK_EDITOR_GUI_ROOT must identify the real GUI dependency checkout; native verification never skips.",
);
const vendor = path.join(gui, "node_modules");
const { JSDOM } = require(path.join(vendor, "jsdom"));
const Blocks = require(path.join(vendor, "scratch-vm/src/engine/blocks.js"));
const adapter = require(path.join(vendor, "scratch-vm/src/engine/adapter.js"));
const root = fileURLToPath(new URL("../../", import.meta.url));
const captured = [];
let info;
const scratch = {
  extensions: {
    unsandboxed: true,
    register(extension) {
      info = extension.getInfo();
    },
  },
  vm: { runtime: { on() {}, off() {} } },
  Cast: { toString: String, toNumber: Number },
  translate: (text) => (typeof text === "string" ? text : text.default),
  BlockType: { COMMAND: "command", REPORTER: "reporter" },
  ArgumentType: { STRING: "string", NUMBER: "number", COLOR: "color" },
  gui: {
    blockEditors: {
      apiVersion: 1,
      registerFixedInputEditor(options) {
        captured.push(options);
        return () => {};
      },
    },
  },
};
new Function(
  "Scratch",
  fs.readFileSync(path.join(root, "dist/svg-text.js"), "utf8"),
)(scratch);
assert.ok(info);
assert.ok(captured.length);
const xmlText = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const capturedInfo = info;
export const capturedOptions = captured;
export const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
export function ownerNative(opcode, seed = {}) {
  const dom = new JSDOM("<html><body></body></html>", {
    runScripts: "outside-only",
  });
  dom.window.eval(
    [
      "blockly_compressed_vertical.js",
      "blocks_compressed.js",
      "blocks_compressed_vertical.js",
      "msg/js/en.js",
    ]
      .map((file) =>
        fs.readFileSync(path.join(vendor, "scratch-blocks", file), "utf8"),
      )
      .join("\n") + "\nglobalThis.ScratchBlocks=Blockly;",
  );
  const B = dom.window.ScratchBlocks;
  const full = `${info.id}_${opcode}`;
  const blockInfo = info.blocks.find((b) => b.opcode === opcode);
  B.Blocks[full] = {
    init() {
      for (const name of Object.keys(blockInfo.arguments))
        this.appendValueInput(name);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
    },
  };
  for (const [name, menu] of Object.entries(info.menus))
    B.Blocks[`${info.id}_menu_${name}`] = {
      init() {
        this.appendDummyInput().appendField(
          new B.FieldDropdown(
            menu.items.map((item) =>
              typeof item === "string" ? [item, item] : [item.text, item.value],
            ),
          ),
          name,
        );
        this.setOutput(true);
      },
    };
  B.Blocks.owner_untrusted = {
    init() {
      class CustomField extends B.FieldTextInput {}
      this.appendDummyInput().appendField(new CustomField("unknown"), "TEXT");
      this.setOutput(true);
    },
  };
  const names = {};
  let xml = `<xml><block type="${full}" id="owner-root">`;
  for (const [name, argument] of Object.entries(blockInfo.arguments)) {
    const value = seed[name];
    if (value?.source === "missing") continue;
    if (value?.source === "reporter") {
      xml += `<value name="${name}"><block type="operator_equals" id="${name}-reporter"/></value>`;
      continue;
    }
    const type =
      value?.source === "unsupported"
        ? "owner_untrusted"
        : argument.menu
          ? `${info.id}_menu_${argument.menu}`
          : argument.type === "number"
            ? "math_number"
            : argument.type === "color"
              ? "colour_picker"
              : "text";
    const field =
      value?.source === "unsupported"
        ? "TEXT"
        : (argument.menu ??
          (argument.type === "number"
            ? "NUM"
            : argument.type === "color"
              ? "COLOUR"
              : "TEXT"));
    names[name] = field;
    xml += `<value name="${name}"><shadow type="${type}" id="${name}-shadow"><field name="${field}">${xmlText(value?.literal ?? argument.defaultValue ?? "")}</field></shadow></value>`;
  }
  xml += "</block></xml>";
  B.Events.disable();
  const workspace = new B.Workspace();
  const parent = B.Xml.domToBlock(B.Xml.textToDom(xml).firstChild, workspace);
  const vm = new EventEmitter();
  let dirty = 0;
  const runtime = {
    emitProjectChanged() {
      dirty++;
    },
    getTargetForStage: () => null,
    getEditingTarget: () => vm.editingTarget,
    emit() {},
    targets: [],
    requestBlocksUpdate() {},
  };
  const blocks = new Blocks(runtime);
  vm.runtime = runtime;
  vm.editingTarget = { id: "owner-target", blocks };
  runtime.targets = [vm.editingTarget];
  for (const b of adapter({ xml: B.Xml.blockToDom(parent) }))
    blocks.createBlock(b);
  dirty = 0;
  workspace.addChangeListener((event) => blocks.blocklyListen(event));
  B.Events.enable();
  workspace.clearUndo();
  const registry = new EditorRegistry();
  const options = captured.find((o) => o.opcodes.includes(full));
  assert.ok(options);
  const definition = createFixedInputEditor(options);
  const remove = registry.registerFixed(definition);
  const host = createTurboWarpBlockEditorHost({
    ScratchBlocks: B,
    workspace,
    vm,
    registry,
    enableFixedInputs: true,
    onError: (error) => {
      throw error;
    },
  });
  const reference = { targetId: "owner-target", blockId: parent.id };
  const open = () => registry.open(reference, host);
  const session = open();
  assert.ok(session);
  const field = (name) =>
    workspace.getBlockById(`${name}-shadow`)?.getField(names[name]);
  const value = (name) => field(name)?.getValue();
  const vmValue = (name) =>
    blocks.getBlock(`${name}-shadow`)?.fields[names[name]]?.value;
  const set = (name, value, buffer) => {
    const draft = session.getDraft();
    draft.inputs[name] = {
      value,
      changed: true,
      ...(buffer === undefined ? {} : { buffer }),
    };
    session.setDraft(draft);
  };
  const outside = (name, value) => {
    B.Events.disable();
    field(name).setValue(value);
    B.Events.enable();
    blocks.getBlock(`${name}-shadow`).fields[names[name]].value = value;
  };
  const read = () =>
    host.fixedInputs.readBlock(reference, registry.resolveFixed(full));
  const commit = (changes) =>
    host.fixedInputs.commit({
      expected: read(),
      changes,
      context: { consumerId: "owner-native", nowMs: 0, settings: null },
      signal: new globalThis.AbortController().signal,
    });
  const state = () => ({
    vm: JSON.parse(JSON.stringify(blocks._blocks)),
    undo: workspace.undoStack_.slice(),
    redo: workspace.redoStack_.slice(),
    dirty,
  });
  return {
    B,
    workspace,
    blocks,
    vm,
    host,
    registry,
    definition,
    session,
    reference,
    open,
    set,
    outside,
    read,
    commit,
    value,
    vmValue,
    state,
    dirty: () => dirty,
    close() {
      session.dispose();
      remove();
      host.dispose();
      B.Events.disable();
      workspace.dispose();
      B.Events.enable();
      dom.window.close();
    },
  };
}
