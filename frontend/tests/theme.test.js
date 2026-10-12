import test from "node:test";
import assert from "node:assert/strict";
import { initialTheme } from "../src/theme.js";

test("saved light/dark preference wins over OS preference", () => {
  assert.equal(initialTheme({getItem: () => "light"}, true), "light");
  assert.equal(initialTheme({getItem: () => "dark"}, false), "dark");
});
test("missing, invalid or blocked storage falls back to OS", () => {
  for (const storage of [undefined, {getItem: () => null}, {getItem: () => "invalid"}, {getItem: () => {throw Error("blocked");}}]) {
    assert.equal(initialTheme(storage, true), "dark");
    assert.equal(initialTheme(storage, false), "light");
  }
});
