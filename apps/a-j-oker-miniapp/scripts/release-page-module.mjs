import assert from "node:assert/strict";
import ts from "typescript";

const parse = (file, code) => ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const nameOf = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
const property = (node, name) => node.properties.find((item) => nameOf(item.name) === name);
const relativeModule = (value) => {
  assert.match(value, /^\.\/[^/\\]+\.js$/, "发布页面必须引用同目录 JS 模块");
  return `js/${value.slice(2)}`;
};
function findAll(node, predicate) {
  const found = [];
  function visit(child) {
    if (predicate(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

// Read bindings without evaluating downloaded JavaScript. Only the selected
// component body counts; sibling pages in a shared chunk cannot satisfy it.
export function createPageReader(bootstrap, read) {
  const app = parse("app.js", bootstrap);
  const modules = new Map();
  async function module(file) {
    if (!modules.has(file)) modules.set(file, read(file).then((code) => parse(file, code)));
    return modules.get(file);
  }
  function routeImport(route, title) {
    const entries = findAll(app, (node) => ts.isObjectLiteralExpression(node) && property(node, "path")?.initializer?.text === route);
    assert.equal(entries.length, 1, `发布版本缺少独立${title}路由，或路由重复`);
    const loader = property(entries[0], "load");
    const imports = loader ? findAll(loader, (node) => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) : [];
    assert.equal(imports.length, 1, `发布版本缺少${title}页面模块，或加载器不明确`);
    const call = imports[0];
    assert.ok(ts.isStringLiteral(call.arguments[0]), `发布版本的${title}模块路径不是静态字符串`);
    let selected;
    if (ts.isPropertyAccessExpression(call.parent) && call.parent.name.text === "then") {
      const then = call.parent.parent;
      const project = ts.isCallExpression(then) && then.arguments[0];
      assert.ok(project && ts.isArrowFunction(project) && project.parameters.length === 1 && ts.isPropertyAccessExpression(project.body) && ts.isIdentifier(project.body.expression) && project.body.expression.text === nameOf(project.parameters[0].name), `无法解析${title}路由的导出选择`);
      selected = project.body.name.text;
    }
    return { file: relativeModule(call.arguments[0].text), selected };
  }
  async function binding(file, name, properties, seen = new Set()) {
    const key = `${file}:${name}:${properties.join(".")}`;
    assert.ok(!seen.has(key), `页面导出存在循环：${key}`);
    seen.add(key);
    const source = await module(file);
    async function value(node, remaining) {
      assert.ok(node, `无法解析页面导出：${key}`);
      if (ts.isIdentifier(node)) return local(node.text, remaining);
      if (ts.isParenthesizedExpression(node)) return value(node.expression, remaining);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "Object" && ["freeze", "defineProperty"].includes(node.expression.name.text)) {
        assert.ok(node.expression.name.text === "freeze" || node.arguments[1]?.getText(source) === "Symbol.toStringTag", `无法解析页面命名空间：${key}`);
        return value(node.arguments[0], remaining);
      }
      if (remaining.length && ts.isObjectLiteralExpression(node)) {
        const item = property(node, remaining[0]);
        return value(item && (ts.isShorthandPropertyAssignment(item) ? item.name : item.initializer), remaining.slice(1));
      }
      assert.ok(!remaining.length && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)), `页面导出不是可识别的组件：${key}`);
      return node.getText(source);
    }
    async function local(localName, remaining) {
      const localKey = `${file}:local:${localName}:${remaining.join(".")}`;
      assert.ok(!seen.has(localKey), `页面绑定存在循环：${localKey}`);
      seen.add(localKey);
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const imports = statement.importClause?.namedBindings;
          const item = imports && ts.isNamedImports(imports) && imports.elements.find((entry) => entry.name.text === localName);
          if (item) return binding(relativeModule(statement.moduleSpecifier.text), nameOf(item.propertyName || item.name), remaining, seen);
        }
        if (ts.isFunctionDeclaration(statement) && nameOf(statement.name) === localName) return value(statement, remaining);
        if (ts.isVariableStatement(statement)) {
          const declaration = statement.declarationList.declarations.find((item) => nameOf(item.name) === localName);
          if (declaration) return value(declaration.initializer, remaining);
        }
      }
      assert.fail(`找不到页面绑定：${file}:${localName}`);
    }
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const item = statement.exportClause.elements.find((entry) => nameOf(entry.name) === name);
        if (item) {
          const original = nameOf(item.propertyName || item.name);
          return statement.moduleSpecifier ? binding(relativeModule(statement.moduleSpecifier.text), original, properties, seen) : local(original, properties);
        }
      }
      if (name === "default" && ts.isExportAssignment(statement)) return value(statement.expression, properties);
      if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
        const exported = statement.modifiers.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : nameOf(statement.name);
        if (exported === name) return value(statement, properties);
      }
    }
    assert.fail(`找不到页面导出：${file}:${name}`);
  }
  return async (route, title) => {
    const { file, selected } = routeImport(route, title);
    const code = route.startsWith("pages/privacy/")
      ? await binding(file, selected || "default", selected ? ["default"] : [])
      : (await module(file)).text;
    return code.replace(/\\u([0-9a-f]{4})/gi, (_, digits) => String.fromCharCode(Number.parseInt(digits, 16)));
  };
}
