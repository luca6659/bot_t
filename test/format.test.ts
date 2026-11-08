import assert from "node:assert/strict";
import { test } from "node:test";
import { esc, formatRub, kopecksFromDb, normalizePhone, parseList, parseRub } from "../src/views/format.js";

test("parseRub понимает обычный ввод и отклоняет мусор", () => {
  assert.equal(parseRub("1500"), 150000);
  assert.equal(parseRub("1 500,50"), 150050);
  assert.equal(parseRub("1500 ₽"), 150000);
  assert.equal(parseRub("1500 руб"), 150000);
  assert.equal(parseRub("0.1"), 10);
  assert.equal(parseRub("19.99"), 1999);
  for (const bad of ["", "abc", "-5", "1.234", "1e5", "12,3,4"]) assert.equal(parseRub(bad), null, bad);
});

test("деньги не теряют копейки", () => {
  assert.equal(kopecksFromDb("19.99"), 1999);
  assert.equal(kopecksFromDb("1234.10"), 123410);
  assert.equal(formatRub(150000).replace(/\s/g, " "), "1 500 ₽");
  assert.equal(formatRub(1999), "19,99 ₽");
});

test("телефон, списки и экранирование", () => {
  assert.equal(normalizePhone("+7 (900) 123-45-67"), "+79001234567");
  assert.equal(normalizePhone("123"), null);
  assert.deepEqual(parseList("10 см, 15 см,, 10 см"), ["10 см", "15 см"]);
  assert.deepEqual(parseList("-"), []);
  assert.equal(esc("<b>&"), "&lt;b&gt;&amp;");
});
