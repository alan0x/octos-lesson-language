import test from "node:test";
import assert from "node:assert/strict";
import { bindUi, disposeBoardUiLocale, inheritUiLocale, setBoardUiLocale, ui } from "../src/ui-localization.js";

function element(parentElement: Element | null = null): Element {
  return { parentElement, ownerDocument: parentElement?.ownerDocument ?? {}, isConnected: true } as Element;
}

test("language switches update explicit labels without recreating controls or touching authored text", () => {
  const root=element(), button=element(root), authored=element(root);
  setBoardUiLocale(root,"zh-CN");
  let label="", updates=0;
  bindUi(root,button,"text",()=>{label=ui(root,"探索");updates++;});
  const courseText="原始课程内容 x²";
  assert.equal(label,"探索");
  setBoardUiLocale(root,"en-US");
  assert.equal(label,"Explore");
  assert.equal(updates,2);
  assert.equal(authored.parentElement,root);
  assert.equal(courseText,"原始课程内容 x²");
  setBoardUiLocale(root,"en-US");
  assert.equal(updates,2);
  setBoardUiLocale(root,"zh-CN");
  assert.equal(label,"探索");
});

test("board locales are independent and portalled controls inherit their board", () => {
  const first=element(), second=element(), dialog=element();
  setBoardUiLocale(first,"en-US");setBoardUiLocale(second,"zh-CN");
  inheritUiLocale(dialog,first);
  assert.equal(ui(dialog,"复位"),"Reset");
  assert.equal(ui(second,"复位"),"复位");
  assert.equal(ui(dialog,"{label}，{sides} 边",{label:"ABC",sides:3}),"ABC, 3 sides");
});

test("disposed boards release label callbacks", () => {
  const root=element(), button=element(root);
  setBoardUiLocale(root,"zh-CN");
  let updates=0;
  bindUi(root,button,"text",()=>{updates++;});
  disposeBoardUiLocale(root);
  setBoardUiLocale(root,"en-US");
  assert.equal(updates,1);
});
