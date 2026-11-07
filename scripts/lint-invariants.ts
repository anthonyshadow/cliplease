// Invariant lint (AGENTS.md §5): the "Never" rules a type check and Biome can't see, checked on the syntax tree of
// every file under src instead of by hand once per prompt. Exit 0: clean, prints nothing. Exit 1: violations printed,
// one per line as path:line: rule: message.
//   status-write          license_request.status is written only in src/server/licensing/state-machine.ts (an
//                         update(licenseRequest).set(...) elsewhere, the table under any import name or as
//                         schema.licenseRequest, must be an object literal without `status`).
//   payments-in-tx        no call that reaches Stripe inside a transaction callback: a payments-domain export
//                         (src/server/payments/{index,registry,connect}), imported or through a namespace import; a
//                         method of a driver held in a variable set from paymentsDriver(…) or typed PaymentsDriver; or
//                         a function that reaches one of those, one of the file's own top-level functions or an
//                         imported one, followed across src (callsOutIndex).
//   postings-fetch        no fetch() under src/server/postings or src/lib/postings: pasted links are parsed, never
//                         fetched (07 D67).
//   vitest-in-src         only test files under src import vitest.
//   redacted-action       every function a "use server" file exports has the body `return redactErrors(event, …)`:
//                         a failed query's bound values never reach Next's log (02 §9.9, 07 D47).
//   video-lock            creating, authorizing or approving a request reads availability under the video's lock (07
//                         D110, D111): an insert into license_request, an "authorized" transition, and every
//                         assertStillLicensable or getLicenseAvailability call not given `db`, comes after a
//                         lockVideoForLicensing call in its own function (not an earlier callback's), or sits in an
//                         unexported same-file helper every call of which does; in a function that takes
//                         the lock, no request row lock, transition or license_request write comes before it (the
//                         video first, everywhere); and each path in LOCKED_PATHS still takes the lock and reads
//                         availability, directly or through a same-file helper, and each of its files still exists.
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
const RULE_WORDS =
  /transaction|licenseRequest|fetch|vitest|use server|LicenseAvailability|StillLicensable|ForLicensing/;
const VIDEO_LOCK = "lockVideoForLicensing";
/** The availability reads a decision makes under the video's lock (07 D110). */
const LOCKED_READS = new Set([
  "assertStillLicensable",
  "getLicenseAvailability",
]);
/** Calls that lock or write a license_request row, or move one: never before the video's lock in the same function. */
const ROW_LOCKERS = new Set(["applyTransition", "lockHeld"]);
/**
 * The paths that create, authorize, extend, approve or decline under the lock (07 D110, D111), file → function: each
 * must keep both the lock and an availability read. A renamed or moved path fails until it is listed again.
 */
const LOCKED_PATHS: Readonly<Record<string, readonly string[]>> = {
  "src/server/licensing/requests.ts": ["saveRequest", "decideAuthorization"],
  "src/server/licensing/checkout-hold.ts": ["extendCheckoutHold"],
  "src/server/licensing/state-machine.ts": ["takeCaptureClaim"],
  "src/server/licensing/availability.ts": [
    "declineReasonFor",
    "hasExclusiveConflict",
  ],
};

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
    if (
      touchesLicenseRequest(current, "update", tables) &&
      current.arguments.length === 1
    ) {
      return true;
    }
    const callee = current.expression;
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

/** Each module (its path without the extension) → the functions it exports that reach Stripe. */
export type CallsOutIndex = ReadonlyMap<string, ReadonlySet<string>>;

const moduleOf = (file: string) => file.replace(/\.tsx?$/, "");

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Whether a call in `sf` reaches Stripe: a payments-domain export, a function `index` lists for its module, one of the
 * file's own functions in `local`, or a method of a payments driver the file holds.
 */
function stripeCallTest(
  sf: ts.SourceFile,
  imports: ReturnType<typeof importsOf>,
  index: CallsOutIndex,
  local: ReadonlySet<string>,
): (call: ts.CallExpression) => boolean {
  const reaches = (module: string | null | undefined, name: string) =>
    module != null &&
    (isPaymentModule(module) ||
      index.get(module)?.has(name) === true ||
      index.get(`${module}/index`)?.has(name) === true);
  /** The export `callee` names (an imported function, or a namespace import's member) when it reaches Stripe, or null. */
  const stripeExport = (callee: ts.Expression): string | null => {
    if (ts.isIdentifier(callee)) {
      const imported = imports.named.get(callee.text);
      return imported && reaches(imported.module, imported.exported)
        ? imported.exported
        : null;
    }
    return ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      reaches(imports.namespaces.get(callee.expression.text), callee.name.text)
      ? callee.name.text
      : null;
  };
  // Read only for a method call that might be a driver's: the walk over the whole file is spared everywhere else.
  let drivers: Set<string> | undefined;
  return (call) => {
    const callee = call.expression;
    if (ts.isIdentifier(callee) && local.has(callee.text)) return true;
    if (stripeExport(callee) !== null) return true;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression)
    ) {
      return false;
    }
    drivers ??= driverNames(sf, stripeExport);
    return drivers.has(callee.expression.text);
  };
}

type TopLevelFunction = { name: string; body: ts.Node; exported: boolean };

/** The file's top-level functions (declarations and `const f = (…) => …`), with whether each is exported. */
function topLevelFunctions(sf: ts.SourceFile): TopLevelFunction[] {
  const out: TopLevelFunction[] = [];
  for (const statement of sf.statements) {
    const exported = exportsValue(statement);
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body
    ) {
      out.push({ name: statement.name.text, body: statement.body, exported });
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        const init = d.initializer;
        if (
          ts.isIdentifier(d.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          out.push({ name: d.name.text, body: init.body, exported });
        }
      }
    }
  }
  return out;
}

/** Whether a call under `node` passes `test`. */
function hasCall(node: ts.Node, test: (call: ts.CallExpression) => boolean) {
  const find = (n: ts.Node): boolean =>
    (ts.isCallExpression(n) && test(n)) || (ts.forEachChild(n, find) ?? false);
  return find(node);
}

/**
 * Adds to `local` each of `functions` with a call that passes `test`, pass after pass until nothing changes: `test`
 * reads `local`, so a function that calls a marked one is marked too, on the next pass when the callee is defined
 * below it. Returns the functions it added.
 */
function markReachers(
  functions: readonly TopLevelFunction[],
  test: (call: ts.CallExpression) => boolean,
  local: Set<string>,
): TopLevelFunction[] {
  const added: TopLevelFunction[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const fn of functions) {
      if (local.has(fn.name) || !hasCall(fn.body, test)) continue;
      local.add(fn.name);
      added.push(fn);
      changed = true;
    }
  }
  return added;
}

/**
 * The functions each module exports that reach Stripe, over `sources` (path → text, test files left out): a function
 * reaches it when it calls a payments-domain export or a driver's method, or a function that reaches it, in its own
 * file or imported. Marked until the index stops growing: only a new export changes another file's answer.
 */
export function callsOutIndex(
  sources: Iterable<readonly [string, string]>,
): CallsOutIndex {
  const files = [...sources]
    .filter(([file]) => !TEST_FILE.test(file))
    .map(([file, text]) => {
      const sf = parse(file, text);
      return {
        module: moduleOf(file),
        sf,
        imports: importsOf(file, sf),
        functions: topLevelFunctions(sf),
        local: new Set<string>(),
      };
    });
  const index = new Map<string, Set<string>>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      const test = stripeCallTest(f.sf, f.imports, index, f.local);
      for (const fn of markReachers(f.functions, test, f.local)) {
        if (!fn.exported) continue;
        index.set(f.module, (index.get(f.module) ?? new Set()).add(fn.name));
        changed = true;
      }
    }
  }
  return index;
}

type FunctionLike =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** The innermost function around `node`, or null at the top level. */
function enclosingFunction(node: ts.Node): FunctionLike | null {
  for (let n = node.parent; n; n = n.parent) {
    if (isFunctionLike(n)) return n;
  }
  return null;
}

/** Every call under `node`, in source order. */
function callsUnder(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return calls;
}

const calledName = (call: ts.CallExpression) =>
  ts.isIdentifier(call.expression) ? call.expression.text : null;

/** `.method(table)`, `table` one of `tables` or `….licenseRequest`. */
function touchesLicenseRequest(
  call: ts.CallExpression,
  method: "insert" | "update",
  tables: ReadonlySet<string>,
): boolean {
  const [table] = call.arguments;
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === method &&
    table !== undefined &&
    ((ts.isIdentifier(table) && tables.has(table.text)) ||
      (ts.isPropertyAccessExpression(table) &&
        table.name.text === LICENSE_REQUEST))
  );
}

/** An availability read a decision makes: assertStillLicensable, or getLicenseAvailability given anything but `db`. */
function isLockedRead(call: ts.CallExpression): boolean {
  const name = calledName(call);
  const [first] = call.arguments;
  return (
    name !== null &&
    LOCKED_READS.has(name) &&
    !(first !== undefined && ts.isIdentifier(first) && first.text === "db")
  );
}

/** An authorization (T2): applyTransition with the event "authorized". */
function isAuthorizing(call: ts.CallExpression): boolean {
  const event = call.arguments[2];
  return (
    calledName(call) === "applyTransition" &&
    event !== undefined &&
    ts.isStringLiteral(event) &&
    event.text === "authorized"
  );
}

/** A row lock, a transition or a license_request write: what the video's lock must come before. */
function locksRequestRow(
  call: ts.CallExpression,
  tables: ReadonlySet<string>,
): boolean {
  const name = calledName(call);
  if (name !== null && ROW_LOCKERS.has(name)) return true;
  const callee = call.expression;
  const [arg] = call.arguments;
  return (
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "for" &&
      arg !== undefined &&
      ts.isStringLiteral(arg) &&
      arg.text === "update") ||
    touchesLicenseRequest(call, "insert", tables) ||
    touchesLicenseRequest(call, "update", tables)
  );
}

/** video-lock's three checks (07 D110, D111) on one file. */
function videoLockViolations(
  file: string,
  sf: ts.SourceFile,
  tables: ReadonlySet<string>,
  flag: (node: ts.Node, rule: string, message: string) => void,
): void {
  const calls = callsUnder(sf);
  const isLock = (call: ts.CallExpression) => calledName(call) === VIDEO_LOCK;
  const locks = calls.filter(isLock);
  const functions = topLevelFunctions(sf);

  // A call is under the lock when its own function (not a callback inside it, whose transaction may have ended) took
  // the lock before it, or it is an unexported same-file helper's and every call of that helper is under the lock: an
  // exported one can be called from elsewhere, so it takes the lock itself.
  const underLock = (node: ts.Node, seen: Set<string>): boolean => {
    const fn = enclosingFunction(node);
    if (!fn) return false;
    const start = node.getStart(sf);
    const locked = locks.some(
      (c) => enclosingFunction(c) === fn && c.getStart(sf) < start,
    );
    if (locked) return true;
    const helper = functions.find((f) => f.body === fn.body);
    if (!helper || helper.exported || seen.has(helper.name)) return false;
    const uses = calls.filter((c) => calledName(c) === helper.name);
    const next = new Set([...seen, helper.name]);
    return uses.length > 0 && uses.every((use) => underLock(use, next));
  };

  for (const call of calls) {
    if (
      (isLockedRead(call) ||
        touchesLicenseRequest(call, "insert", tables) ||
        isAuthorizing(call)) &&
      !underLock(call, new Set())
    ) {
      flag(
        call,
        "video-lock",
        "create, authorize or approve only after lockVideoForLicensing in the same transaction (07 D110)",
      );
    }
    if (isLock(call)) {
      const fn = enclosingFunction(call);
      const start = call.getStart(sf);
      const early =
        fn !== null &&
        hasCall(
          fn,
          (c) => c.getStart(sf) < start && locksRequestRow(c, tables),
        );
      if (early) {
        flag(
          call,
          "video-lock",
          "the video's lock comes before any license_request row lock or write (07 D110)",
        );
      }
    }
  }

  for (const name of LOCKED_PATHS[file] ?? []) {
    const fn = functions.find((f) => f.name === name);
    if (!fn) {
      flag(
        sf,
        "video-lock",
        `${name} is a locked path (LOCKED_PATHS) and isn't in this file: list where it moved`,
      );
      continue;
    }
    const helperReads = (call: ts.CallExpression) => {
      const helper = functions.find((f) => f.name === calledName(call));
      return helper !== undefined && hasCall(helper.body, isLockedRead);
    };
    const reads = hasCall(fn.body, (c) => isLockedRead(c) || helperReads(c));
    if (!hasCall(fn.body, isLock) || !reads) {
      flag(
        fn.body,
        "video-lock",
        `${name} must take lockVideoForLicensing and read availability under it (07 D110, D111)`,
      );
    }
  }
}

/** A video-lock violation for each LOCKED_PATHS file that `files` no longer has: a moved path must be listed again. */
export function missingLockedPathFiles(files: Iterable<string>): string[] {
  const present = new Set(files);
  return Object.keys(LOCKED_PATHS)
    .filter((file) => !present.has(file))
    .map(
      (file) =>
        `${file}:1: video-lock: a locked path's file (LOCKED_PATHS) is missing: list where its functions moved`,
    );
}

/**
 * `file`'s violations, `text` its contents, as path:line: rule: message lines. `index`: the functions outside the
 * payments domain that reach Stripe (callsOutIndex over src); the file's own are marked here.
 */
export function violationsIn(
  file: string,
  text: string,
  index: CallsOutIndex = new Map(),
): string[] {
  if (!RULE_WORDS.test(text) && !Object.hasOwn(LOCKED_PATHS, file)) return [];
  const sf = parse(file, text);
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

  if (!isTest) videoLockViolations(file, sf, tables, flag);

  // The index lists only exports: a same-file helper that reaches Stripe, called inside a transaction, counts too.
  const local = new Set<string>();
  const isPaymentCall = stripeCallTest(sf, imports, index, local);
  markReachers(topLevelFunctions(sf), isPaymentCall, local);

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
  const sources = new Map(
    sourceFiles().map((file) => [
      file,
      readFileSync(path.join(ROOT, file), "utf8"),
    ]),
  );
  const index = callsOutIndex(sources);
  const violations = [
    ...missingLockedPathFiles(sources.keys()),
    ...[...sources].flatMap(([file, text]) => violationsIn(file, text, index)),
  ];
  for (const line of violations) console.log(line);
  process.exit(violations.length > 0 ? 1 : 0);
}
