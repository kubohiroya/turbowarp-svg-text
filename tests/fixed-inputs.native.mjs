import assert from "node:assert/strict";
import test from "node:test";
import { ownerNative, flush } from "./fixtures/fixed-native.mjs";
test("real SVG owner saves COLOR/NUMBER/MENU through native Blockly VM with one undo group", async (t) => {
  const f = ownerNative("defineStyle");
  t.after(f.close);
  const before = f.state();
  f.set("BACKGROUND", "#445566");
  f.set("TEXT_COLOR", "#112233");
  f.set("SIZE", 125.5, "125.5");
  f.set("ALIGN", "right");
  assert.deepEqual(await f.session.save(), { status: "saved", changed: true });
  for (const [name, value] of Object.entries({
    BACKGROUND: "#445566",
    TEXT_COLOR: "#112233",
    SIZE: "125.5",
    ALIGN: "right",
  })) {
    assert.equal(f.value(name), value);
    assert.equal(f.vmValue(name), value);
  }
  assert.equal(f.value("FONT"), "Helvetica");
  assert.equal(f.value("STYLE"), "default");
  assert.equal(f.dirty(), 1);
  assert.equal(f.workspace.undoStack_.length, 4);
  assert.equal(new Set(f.workspace.undoStack_.map((e) => e.group)).size, 1);
  f.workspace.undo(false);
  await flush();
  assert.equal(f.vmValue("SIZE"), "100");
  assert.equal(f.vmValue("ALIGN"), "left");
  f.workspace.undo(true);
  await flush();
  assert.equal(f.vmValue("SIZE"), "125.5");
  assert.equal(f.vmValue("ALIGN"), "right");
  assert.notDeepEqual(f.state().vm, before.vm);
});
test("real SVG owner numeric rejection leaves VM undo dirty and original colors untouched", async (t) => {
  const f = ownerNative("defineStyle");
  t.after(f.close);
  const before = f.state();
  f.set("BACKGROUND", "#445566");
  f.set("SIZE", "0x10");
  assert.equal((await f.session.save()).status, "invalid");
  assert.deepEqual(f.state(), before);
});

test("new SVG short hex expands to six digits and six-digit case remains exact", async () => {
  for (const [logical, stored] of [
    ["#AbC", "#AAbbCC"],
    ["#ABCDEF", "#ABCDEF"],
  ]) {
    const f = ownerNative("defineStyle");
    try {
      f.set("BACKGROUND", logical);
      assert.equal((await f.session.save()).status, "saved");
      assert.equal(f.value("BACKGROUND"), stored);
      assert.equal(f.vmValue("BACKGROUND"), stored);
    } finally {
      f.close();
    }
  }
});

test("existing short/alpha/transparent SVG color raw survives native no-op without setter normalization", async () => {
  for (const raw of ["#AbC", "#AbCd", "#11223344", "transparent"]) {
    const f = ownerNative("defineStyle");
    try {
      // Seed legacy storage directly: loading it through today's setter would normalize/reject it.
      f.workspace.getBlockById("BACKGROUND-shadow").getField("COLOUR").colour_ =
        raw;
      f.blocks.getBlock("BACKGROUND-shadow").fields.COLOUR.value = raw;
      f.session.dispose();
      const session = f.open();
      const before = f.state();
      assert.deepEqual(await session.save(), {
        status: "saved",
        changed: false,
      });
      assert.deepEqual(f.state(), before);
      assert.equal(f.value("BACKGROUND"), raw);
      assert.equal(f.vmValue("BACKGROUND"), raw);
      session.dispose();
    } finally {
      f.close();
    }
  }
});
