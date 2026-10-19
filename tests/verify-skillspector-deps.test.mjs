// Testes do verificador de dependências fixadas do SkillSpector
// (scripts/verify-skillspector-deps.mjs). Só funções puras de parsing/análise —
// sem spawn de processos, rede ou leitura de relatórios do scanner.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeName,
  parseConstraints,
  parseFreezeOutput,
  checkEnvironment,
} from "../scripts/verify-skillspector-deps.mjs";

test("normalizeName aplica a convenção PEP 503", () => {
  assert.equal(normalizeName("PyYAML"), "pyyaml");
  assert.equal(normalizeName("Foo_Bar.baz"), "foo-bar-baz");
  assert.equal(normalizeName("foo--bar__baz"), "foo-bar-baz");
  assert.equal(normalizeName("  Rich  "), "rich");
  assert.equal(normalizeName("zope.interface"), "zope-interface");
});

test("parseConstraints aceita pins com marcador, comentários e linhas vazias", () => {
  const text = [
    "# cabeçalho",
    "colorama==0.4.6 ; sys_platform == 'win32'",
    "   # via click",
    "",
    "PyYAML==6.0.3",
  ].join("\n");
  assert.deepEqual(parseConstraints(text), [
    { name: "colorama", version: "0.4.6", marker: "sys_platform == 'win32'" },
    { name: "pyyaml", version: "6.0.3", marker: "" },
  ]);
});

test("parseConstraints falha em linha que não é pin exato", () => {
  assert.throws(() => parseConstraints("tqdm>=4\n"), /não é um pin exato/);
  assert.throws(() => parseConstraints("tqdm\n"), /não é um pin exato/);
});

test("parseConstraints falha em nome duplicado após normalização", () => {
  assert.throws(() => parseConstraints("PyYAML==6.0.3\npyyaml==6.0.2\n"), /duplicada/);
});

test("parseConstraints falha em arquivo sem entradas", () => {
  assert.throws(() => parseConstraints("# nada\n\n"), /sem entradas/);
});

test("parseFreezeOutput aceita linhas name==version e ignora linhas vazias", () => {
  const installed = parseFreezeOutput("Foo==1.0\n\nbar-baz==2.0.post0\nzope.interface==5.4.0\n");
  assert.deepEqual([...installed], [
    ["foo", "1.0"],
    ["bar-baz", "2.0.post0"],
    ["zope-interface", "5.4.0"],
  ]);
});

test("parseFreezeOutput falha em linha não interpretável", () => {
  assert.throws(() => parseFreezeOutput("sem-versao\n"), /não interpretável/);
  assert.throws(() => parseFreezeOutput("foo==\n"), /não interpretável/);
  assert.throws(() => parseFreezeOutput("foo==1.0 extra\n"), /não interpretável/);
});

test("parseFreezeOutput falha em duplicata após normalização", () => {
  assert.throws(() => parseFreezeOutput("SkillSpector==2.13.0\nskillspector==2.13.0\n"), /duplicado/);
});

test("parseFreezeOutput falha em ambiente sem pacotes", () => {
  assert.throws(() => parseFreezeOutput("\n \n"), /sem pacotes/);
});

const CONSTRAINTS = parseConstraints(["foo==1.0", "bar==2.0 ; sys_platform == 'win32'"].join("\n"));

test("checkEnvironment ok: conta dependências e lista condicional não aplicável", () => {
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.0"],
  ]);
  const { depCount, skippedConditional } = checkEnvironment(CONSTRAINTS, installed, {
    pythonMinor: "3.12",
    expectedMinor: "3.12",
  });
  assert.equal(depCount, 1);
  assert.deepEqual(skippedConditional, ["bar==2.0 ; sys_platform == 'win32'"]);
});

test("checkEnvironment falha se o pacote principal não está instalado", () => {
  const installed = new Map([["foo", "1.0"]]);
  assert.throws(() => checkEnvironment(CONSTRAINTS, installed), /pacote principal ausente/);
});

test("checkEnvironment falha em versão divergente do pin", () => {
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.1"],
  ]);
  assert.throws(() => checkEnvironment(CONSTRAINTS, installed), /lock exige 1\.0/);
});

test("checkEnvironment falha em pacote extra fora do lock", () => {
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.0"],
    ["extra", "9.9"],
  ]);
  assert.throws(() => checkEnvironment(CONSTRAINTS, installed), /fora do lock fixado.*extra==9\.9/);
});

test("checkEnvironment falha em pin incondicional ausente", () => {
  const entries = parseConstraints("foo==1.0\nbaz==3.0\n");
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.0"],
  ]);
  assert.throws(
    () => checkEnvironment(entries, installed),
    /pin\(s\) do lock ausente.*baz==3\.0 \(incondicional\)/,
  );
});

test("checkEnvironment falha em pin condicional aplicável ao Linux ausente", () => {
  const entries = parseConstraints("foo==1.0\nqux==1.5 ; sys_platform == 'linux'\n");
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.0"],
  ]);
  assert.throws(() => checkEnvironment(entries, installed), /marcador aplicável ao Linux/);
});

test("checkEnvironment falha em Python divergente e ignora condicional win32", () => {
  const installed = new Map([
    ["skillspector", "2.13.0"],
    ["foo", "1.0"],
  ]);
  const { skippedConditional } = checkEnvironment(CONSTRAINTS, installed, {
    pythonMinor: "3.12",
    expectedMinor: "3.12",
  });
  assert.equal(skippedConditional.length, 1);
  assert.throws(
    () => checkEnvironment(CONSTRAINTS, installed, { pythonMinor: "3.13", expectedMinor: "3.12" }),
    /Python do ambiente é 3\.13, esperado 3\.12/,
  );
});
