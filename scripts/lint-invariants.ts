// Invariant lint (AGENTS.md §5): the "Never" rules a type check and Biome can't see, checked on the syntax tree of
// every file under src instead of by hand once per prompt. Exit 0: clean, prints nothing. Exit 1: violations printed,
// one per line as path:line: rule: message.
//   status-write          license_request.status is written only in src/server/licensing/state-machine.ts (an
//                         update(licenseRequest).set(...) elsewhere must be an object literal without `status`).
//   payments-in-tx        no call to the payments domain (src/server/payments/{index,registry,connect}) inside a
//                         transaction callback. Calls made through a helper the callback invokes are not followed.
//   postings-fetch        no fetch() under src/server/postings or src/lib/postings: pasted links are parsed, never
//                         fetched (07 D67).
//   vitest-in-src         only test files under src import vitest.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "..");
const STATE_MACHINE = "src/server/licensing/state-machine.ts";
const PAYMENT_MODULES = new Set(
  ["index", "registry", "connect"].map((m) => `src/server/payments/${m}`),
);
const POSTINGS_DIRS = ["src/server/postings/", "src/lib/postings/"];
const TEST_FILE = /\.test\.tsx?$/;
/** A file none of the rules' words appear in can't break one: it isn't parsed. */
const RULE_WORDS = /transaction|licenseRequest|fetch|vitest/;

function sourceFiles(): string[] {
  // A pathspec's * also matches "/": every .ts and .tsx file at any depth.
  const out = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "src/*.ts", "src/*.tsx"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

/** An import specifier as a path from the repo root without its extension, or null for a package. */
function resolveImport(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return path.join("src", specifier.slice(2));
  if (!specifier.startsWith(".")) return null;
  return path.join(path.dirname(file), specifier).replace(/\.tsx?$/, "");
}

/** The local names bound to the payments domain's exports, and namespace imports of it. */
function paymentNames(file: string, sf: ts.SourceFile) {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const target = resolveImport(file, statement.moduleSpecifier.text);
    if (
      !target ||
      !(PAYMENT_MODULES.has(target) || PAYMENT_MODULES.has(`${target}/index`))
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return { names, namespaces };
}

function isTransactionCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "transaction"
  );
}

/** `.update(licenseRequest)` somewhere in a call chain's receiver. */
function updatesLicenseRequest(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "update" &&
      current.arguments.length === 1 &&
      current.arguments[0] !== undefined &&
      ts.isIdentifier(current.arguments[0]) &&
      current.arguments[0].text === "licenseRequest"
    ) {
      return true;
    }
    if (!ts.isPropertyAccessExpression(callee)) return false;
    current = callee.expression;
  }
  return false;
}

/** `file`'s violations, as path:line: rule: message lines. */
function check(file: string): string[] {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  if (!RULE_WORDS.test(text)) return [];
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const flag = (node: ts.Node, rule: string, message: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push(`${file}:${line + 1}: ${rule}: ${message}`);
  };
  const isTest = TEST_FILE.test(file);
  const payments = paymentNames(file, sf);

  for (const statement of sf.statements) {
    if (
      !isTest &&
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "vitest"
    ) {
      flag(
        statement,
        "vitest-in-src",
        "only *.test.ts(x) files import vitest; test fixtures belong under tests/",
      );
    }
  }

  const isPaymentCall = (call: ts.CallExpression): boolean => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return payments.names.has(callee.text);
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression)
    ) {
      return payments.namespaces.has(callee.expression.text);
    }
    return false;
  };

  const visit = (node: ts.Node, inTransaction: boolean): void => {
    if (ts.isCallExpression(node)) {
      if (inTransaction && isPaymentCall(node)) {
        flag(
          node,
          "payments-in-tx",
          "a payments call inside a transaction: claim, commit, then call (07 D24)",
        );
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "set" &&
        file !== STATE_MACHINE &&
        updatesLicenseRequest(callee.expression)
      ) {
        const values = node.arguments[0];
        const writesStatus =
          !values ||
          !ts.isObjectLiteralExpression(values) ||
          values.properties.some(
            (p) =>
              ts.isSpreadAssignment(p) ||
              (p.name !== undefined &&
                (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
                p.name.text === "status"),
          );
        if (writesStatus) {
          flag(
            node,
            "status-write",
            "license_request.status changes only through the state machine",
          );
        }
      }
      if (
        POSTINGS_DIRS.some((dir) => file.startsWith(dir)) &&
        ((ts.isIdentifier(callee) && callee.text === "fetch") ||
          (ts.isPropertyAccessExpression(callee) &&
            callee.name.text === "fetch"))
      ) {
        flag(
          node,
          "postings-fetch",
          "pasted links are parsed and matched by id, never fetched (07 D67)",
        );
      }
      if (isTransactionCall(node)) {
        visit(node.expression, inTransaction);
        for (const arg of node.arguments) visit(arg, true);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, inTransaction));
  };
  visit(sf, false);
  return violations;
}

const violations = sourceFiles().flatMap(check);
for (const line of violations) console.log(line);
process.exit(violations.length > 0 ? 1 : 0);
