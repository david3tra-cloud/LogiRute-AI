const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(process.cwd(), "decaEmissionBatch.ts"),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleObj = { exports: {} };
vm.runInNewContext(transpiled, {
  module: moduleObj,
  exports: moduleObj.exports,
  Set,
  Error,
});
const {
  DeCAEmissionBatchGate,
  runDeCAEmissionBatch,
  selectDeCADrafts,
} = moduleObj.exports;

const runSizeCheck = async (count) => {
  const ids = Array.from({ length: count }, (_, index) => `deca-${index + 1}`);
  const emitted = [];
  const results = await runDeCAEmissionBatch(ids, async (id) => {
    emitted.push(id);
    return { status: "emitted" };
  });
  assert.equal(results.length, count);
  assert.equal(emitted.length, count);
  assert.ok(results.every((result) => result.outcome.status === "emitted"));
};

(async () => {
  const selectable = [
    { id: "draft-1", estado: "BORRADOR" },
    { id: "issued-1", estado: "EMITIDO" },
    { id: "draft-2", estado: "borrador" },
    { id: "pending-1", estado: "EMITIENDO" },
  ];
  assert.deepEqual(
    selectDeCADrafts(selectable, new Set(["draft-1", "draft-2"])).map(
      (deca) => deca.id,
    ),
    ["draft-1", "draft-2"],
  );
  assert.deepEqual(
    selectDeCADrafts(
      selectable,
      new Set(selectable.map((deca) => deca.id)),
    ).map((deca) => deca.id),
    ["draft-1", "draft-2"],
  );
  console.log("PASS: varios y todos los seleccionados incluyen borradores, excluyen emitidos y EMITIENDO.");

  const gate = new DeCAEmissionBatchGate();
  let executions = 0;
  const startBatch = async () => {
    if (!gate.tryAcquire()) return false;
    try {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return true;
    } finally {
      gate.release();
    }
  };
  assert.deepEqual(await Promise.all([startBatch(), startBatch()]), [true, false]);
  assert.equal(executions, 1);
  assert.equal(gate.isLocked, false);
  console.log("PASS: el bloqueo impide una segunda ejecución mientras el lote está activo.");

  await runSizeCheck(1);
  console.log("PASS: emisión individual de 1 documento.");
  await runSizeCheck(2);
  console.log("PASS: emisión individual de 2 documentos.");
  await runSizeCheck(40);
  console.log("PASS: lote de 40 documentos.");

  const states = new Map(
    Array.from({ length: 40 }, (_, index) => [
      `deca-${index + 1}`,
      "BORRADOR",
    ]),
  );
  const attempts = new Map();
  const failOnceId = "deca-17";
  const emitOne = async (id) => {
    attempts.set(id, (attempts.get(id) ?? 0) + 1);
    if (id === failOnceId && attempts.get(id) === 1) {
      return { status: "failed", message: "Fallo temporal simulado." };
    }
    states.set(id, "EMITIDO");
    return { status: "emitted" };
  };
  const firstResults = await runDeCAEmissionBatch(
    [...states.keys()],
    emitOne,
  );
  assert.equal(
    firstResults.filter((result) => result.outcome.status === "failed").length,
    1,
  );
  assert.equal(
    [...states.values()].filter((state) => state === "EMITIDO").length,
    39,
  );

  const retryIds = [...states]
    .filter(([, state]) => state === "BORRADOR")
    .map(([id]) => id);
  assert.deepEqual(retryIds, [failOnceId]);
  const retryResults = await runDeCAEmissionBatch(retryIds, emitOne);
  assert.equal(retryResults[0].outcome.status, "emitted");
  assert.equal(states.get(failOnceId), "EMITIDO");
  assert.equal([...states.values()].filter((state) => state === "EMITIDO").length, 40);
  assert.equal(attempts.get(failOnceId), 2);
  assert.ok(
    [...attempts]
      .filter(([id]) => id !== failOnceId)
      .every(([, count]) => count === 1),
  );
  console.log("PASS: fallo parcial, reintento solo del borrador y sin duplicar los 39 emitidos.");

  const duplicateResults = await runDeCAEmissionBatch(
    ["same", "same"],
    async () => ({ status: "emitted" }),
  );
  assert.equal(duplicateResults.length, 1);
  console.log("PASS: identificadores repetidos en la selección se deduplican.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
