// Invariant lint (AGENTS.md §5): the "Never" rules a type check and Biome can't see, checked on the syntax tree of
// every file under src instead of by hand once per prompt. Exit 0: clean, prints nothing. Exit 1: violations printed,
// one per line as path:line: rule: message.
//   status-write          license_request.status is written only in src/server/licensing/state-machine.ts (an
//                         update(licenseRequest).set(...) elsewhere, the table under any import name or as
//                         schema.licenseRequest, must be an object literal without `status`).
//   payments-in-tx        no call to the payments domain (src/server/payments/{index,registry,connect}) inside a
//                         transaction callback: an imported function, a namespace import's, or a method of a driver
//                         held in a variable set from paymentsDriver(…) or typed PaymentsDriver. Calls made through a
//                         helper the callback invokes are not followed.
//   postings-fetch        no fetch() under src/server/postings or src/lib/postings: pasted links are parsed, never
//                         fetched (07 D67).
//   vitest-in-src         only test files under src import vitest.
//   redacted-action       every function a "use server" file exports has the body `return redactErrors(event, …)`:
//                         a failed query's bound values never reach Next's log (02 §9.9, 07 D47).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "..");
const STATE_MACHINE = "src/server/licensing/state-machine.ts";
const PAYMENT_MODULES = new Set(
  ["index", "registry", "connect"].map((m) => `src/server/payments/${m}`),
);
const DRIVER_FACTORY = "paymentsDriver";
const DRIVER_TYPE = "PaymentsDriver";
const LICENSE_REQUEST = "licenseRequest";
const POSTINGS_DIRS = ["src/server/postings/", "src/lib/postings/"];
const TEST_FILE = /\.test\.tsx?$/;
/** A file none of the rules' words appear in can't break one: it isn't parsed. */
const RULE_WORDS = /transaction|licenseRequest|fetch|vitest|use server/;

function sourceFiles(): string[] {
  // A pathspec's * also matches "/": every .ts and .tsx file at any depth. A tracked file deleted but not staged is
  // still listed: only the files on disk are read.
  const out = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "src/*.ts", "src/*.tsx"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((file) => file !== "" && existsSync(path.join(ROOT, file)));
}

/** An import specifier as a path from the repo root without its extension, or null for a package. */
function resolveImport(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return path.join("src", specifier.slice(2));
  if (!specifier.startsWith(".")) return null;
  return path.join(path.dirname(file), specifier).replace(/\.tsx?$/, "");
}

/** A named value import: the module it comes from (resolveImport's path, null for a package) and the export's name. */
type NamedImport = { module: string | null; exported: string };

/** The file's value imports: each local name's, and the namespace imports with their modules. */
function importsOf(file: string, sf: ts.SourceFile) {
  const named = new Map<string, NamedImport>();
  const namespaces = new Map<string, string | null>();
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const module = resolveImport(file, statement.moduleSpecifier.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, module);
    } else if (bindings) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        named.set(element.name.text, {
          module,
          exported: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  return { named, namespaces };
}

const isPaymentModule = (module: string | null | undefined) =>
  module != null &&
  (PAYMENT_MODULES.has(module) || PAYMENT_MODULES.has(`${module}/index`));

/** The names a payments driver is held under: a variable set from paymentsDriver(…), or a variable or parameter typed PaymentsDriver. */
function driverNames(
  sf: ts.SourceFile,
  paymentExport: (callee: ts.Expression) => string | null,
): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name)
    ) {
      const typed =
        node.type !== undefined &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === DRIVER_TYPE;
      const made =
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        paymentExport(node.initializer.expression) === DRIVER_FACTORY;
      if (typed || made) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isTransactionCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "transaction"
  );
}

/** `.update(table)` somewhere in a call chain's receiver, `table` one of `tables` or `….licenseRequest`. */
function updatesLicenseRequest(
  node: ts.Expression,
  tables: ReadonlySet<string>,
): boolean {
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    const callee = current.expression;
    const [table, ...rest] = current.arguments;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "update" &&
      table !== undefined &&
      rest.length === 0 &&
      ((ts.isIdentifier(table) && tables.has(table.text)) ||
        (ts.isPropertyAccessExpression(table) &&
          table.name.text === LICENSE_REQUEST))
    ) {
      return true;
    }
    if (!ts.isPropertyAccessExpression(callee)) return false;
    current = callee.expression;
  }
  return false;
}

function isUseServer(sf: ts.SourceFile): boolean {
  const [first] = sf.statements;
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

/** A function body that is exactly `return redactErrors(…)`. */
function returnsRedacted(body: ts.Block | undefined): boolean {
  const [only, ...rest] = body?.statements ?? [];
  if (only === undefined || rest.length > 0 || !ts.isReturnStatement(only)) {
    return false;
  }
  const call = only.expression;
  return (
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "redactErrors"
  );
}

/** A statement that exports a value (a type, an interface or a type-only export brings nothing to run). */
function exportsValue(statement: ts.Statement): boolean {
  if (
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement)
  ) {
    return false;
  }
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  if (ts.isExportAssignment(statement)) return true;
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

/** `file`'s violations, `text` its contents, as path:line: rule: message lines. */
export function violationsIn(file: string, text: string): string[] {
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
  const imports = importsOf(file, sf);
  const tables = new Set([LICENSE_REQUEST]);
  for (const [local, { exported }] of imports.named) {
    if (exported === LICENSE_REQUEST) tables.add(local);
  }

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

  if (isUseServer(sf)) {
    for (const statement of sf.statements) {
      if (!exportsValue(statement)) continue;
      if (
        ts.isFunctionDeclaration(statement) &&
        returnsRedacted(statement.body)
      ) {
        continue;
      }
      flag(
        statement,
        "redacted-action",
        "export each Server Action as an async function whose body is `return redactErrors(event, …)` (02 §9.9, 07 D47)",
      );
    }
  }

  /** The payments export `callee` names (an imported function, or a namespace import's member), or null. */
  const paymentExport = (callee: ts.Expression): string | null => {
    if (ts.isIdentifier(callee)) {
      const imported = imports.named.get(callee.text);
      return isPaymentModule(imported?.module)
        ? (imported?.exported ?? null)
        : null;
    }
    return ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      isPaymentModule(imports.namespaces.get(callee.expression.text))
      ? callee.name.text
      : null;
  };
  // Read only for a method call inside a transaction: the walk over the whole file is spared everywhere else.
  let drivers: Set<string> | undefined;
  const isPaymentCall = (call: ts.CallExpression): boolean => {
    const callee = call.expression;
    if (paymentExport(callee) !== null) return true;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression)
    ) {
      return false;
    }
    drivers ??= driverNames(sf, paymentExport);
    return drivers.has(callee.expression.text);
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
        updatesLicenseRequest(callee.expression, tables)
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

if (require.main === module) {
  const violations = sourceFiles().flatMap((file) =>
    violationsIn(file, readFileSync(path.join(ROOT, file), "utf8")),
  );
  for (const line of violations) console.log(line);
  process.exit(violations.length > 0 ? 1 : 0);
}
