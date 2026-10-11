const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const sourcePath = path.resolve(process.cwd(), "DeCASection.tsx");
const text = fs.readFileSync(sourcePath, "utf8");
const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["applyEmpresaIdRemaps", "flushEmpresaJournal", "scheduleEmpresaFlush", "updateCompanies"];
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
    assert(!declarations.has(node.name.text), `Funcion duplicada: ${node.name.text}`);
    declarations.set(node.name.text, `const ${node.getText(source)};`);
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of names) assert(declarations.has(name), `Falta ${name}`);
const compiled = ts.transpileModule([...declarations.values()].join("\n") +
  "\nglobalThis.subject = {" + names.join(",") + "};", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
const syntaxErrors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0, "Error de sintaxis al extraer las funciones");

const user = "usuario-simulado";
const id = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const payload = nombre => ({nombre, direccion:"Calle 1", ciudad:"Madrid", codigoPostal:"28001",
  provincia:"Madrid", pais:"Espana", nif:"", telefono:"", email:"", contacto:"", notas:""});
const copy = x => structuredClone(x);
function fixture() {
  const state = { ops:[], row:null, map:{}, writes:[], errors:[], notices:[], companies:[],
    failRows:false, failJournal:false, failMap:false, published:0 };
  const companyRef = { current:[] };
  const equal = (a,b) => Object.keys(a).every(k => a[k] === b[k]);
  const noop = () => {};
  const sandbox = {
    console:{error:noop}, Date, Set, Map, Promise,
    mountedRef:{current:true}, companyUserIdRef:{current:user},
    companiesRef:companyRef, empresaMutationVersionRef:{current:0},
    empresaQueueRef:{current:Promise.resolve()}, remoteEmpresaIdsRef:{current:new Set()},
    formRef:{current:{cargadorId:""}},
    readEmpresaJournal:()=>copy(state.ops),
    findEmpresaPendingOp:(_u,localId)=>copy(state.ops.find(o=>o.localId===localId)),
    removeEmpresaPendingOp:(_u,localId,revision)=>{
      const index=state.ops.findIndex(o=>o.localId===localId && o.revision===revision);
      if(index<0 || state.failJournal)return false;
      state.ops.splice(index,1);return true;
    },
    saveEmpresaPendingOpsForUser:(_u,ops)=>{
      if(state.failJournal)return false;state.ops=copy(ops);return true;
    },
    loadEmpresaIdMap:()=>copy(state.map),
    saveEmpresaIdMap:map=>{if(state.failMap)return false;state.map=copy(map);return true;},
    persistEmpresaRows:rows=>{if(state.failRows)return false;state.companies=copy(rows);return true;},
    loadEmpresas:()=>({items:[]}),
    empresaSessionMatches:async u=>u===user,
    getEmpresaRowByIdForUser:async()=>copy(state.row),
    insertUserEmpresaHabitual:async fields=>{
      state.writes.push({kind:"insert",payload:copy(fields),evidence:copy(state.ops)});
      state.row={...fields};return copy(state.row);
    },
    updateUserEmpresaHabitual:async (_id,fields)=>{
      state.writes.push({kind:"update",payload:copy(fields)});
      state.row={...state.row,...fields};return copy(state.row);
    },
    toEmpresaWriteFields:copy,
    payloadMatchesEmpresaRow:(p,row)=>Object.keys(p).every(k=>p[k]===row[k]),
    empresaPayloadsEqual:equal,
    empresaPayloadFrom:company=>Object.fromEntries(Object.keys(payload("")).map(k=>[k,company[k]])),
    mapSupabaseEmpresaHabitualToLocal:row=>({...row,createdAt:"2026-01-01",updatedAt:"2026-01-01"}),
    isUuid:value=>typeof value==="string" && /^[0-9a-f-]{36}$/i.test(value),
    createRecipientId:()=>target,
    empresaErrorCode:error=>error.code,
    empresaErrorMessage:error=>error.message || String(error),
    composeCompanySyncNotice:()=>"simulado",
    setCompanyUpdateError:message=>state.errors.push(message),
    setCompanyStorageWarning:noop, setHasPendingCompanyMigration:noop,
    setCompanySyncNotice:message=>state.notices.push(message),
    setCompanies:()=>state.published++, setDecas:noop, setForm:noop,
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled.outputText, sandbox, {timeout:5000});
  return {state,sandbox,subject:sandbox.subject};
}
function op(extra={}) {return {userId:user,kind:"insert",localId:id,targetId:id,revision:2,
  payload:payload("Nueva"),createdAt:"2026-01-01",updatedAt:"2026-01-02",...extra};}
const tests=[];
function test(name,fn){tests.push({name,fn});}

test("Reintenta INSERT original, aplica edicion posterior y retira pendiente",async()=>{
  const f=fixture();f.state.ops=[op({insertedPayload:payload("Original")})];
  f.sandbox.companiesRef.current=[{id,...payload("Nueva"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  await f.subject.flushEmpresaJournal(user);
  assert.equal(f.state.writes.length,2);
  assert.equal(f.state.writes[0].kind,"insert");
  assert.equal(f.state.writes[0].payload.nombre,"Original");
  assert.equal(f.state.writes[0].evidence[0].insertedPayload.nombre,"Original");
  assert.equal(f.state.writes[1].kind,"update");
  assert.equal(f.state.row.nombre,"Nueva");assert.equal(f.state.ops.length,0);
});
test("No envia INSERT si no puede guardar la evidencia",async()=>{
  const f=fixture();f.state.ops=[op()];f.state.failJournal=true;
  await assert.rejects(f.subject.flushEmpresaJournal(user));
  assert.equal(f.state.writes.length,0);assert.equal(f.state.ops.length,1);
});
test("No sobrescribe una fila incompatible con payload y evidencia",async()=>{
  const f=fixture();f.state.ops=[op({insertedPayload:payload("Original")})];
  f.state.row={id,user_id:user,...payload("Ajena")};
  await assert.rejects(f.subject.flushEmpresaJournal(user));
  assert.equal(f.state.writes.length,0);assert.equal(f.state.ops.length,1);
});
test("Remapeo incierto conserva identificador y evidencia",async()=>{
  const f=fixture();f.state.ops=[op({insertedPayload:payload("Original")})];
  assert.equal(f.subject.applyEmpresaIdRemaps([{from:id,to:target}],user),false);
  assert.equal(f.state.ops[0].targetId,id);assert.equal(Object.keys(f.state.map).length,0);
});
test("Remapeo recupera una escritura parcial sin publicar antes de guardar",async()=>{
  const f=fixture();f.state.ops=[op({localId:"old",targetId:id})];
  f.sandbox.companiesRef.current=[{id:"old",...payload("Nueva")}];
  f.state.failRows=true;
  assert.equal(f.subject.applyEmpresaIdRemaps([{from:"old",to:id}],user),false);
  assert.equal(f.state.published,0);assert.equal(f.state.map.old,id);
  f.state.failRows=false;
  assert.equal(f.subject.applyEmpresaIdRemaps([{from:"old",to:id}],user),true);
  assert.equal(f.sandbox.companiesRef.current[0].id,id);
  assert.equal(f.state.ops[0].localId,id);
});
test("updateCompanies comunica fallo de persistencia sin publicar",async()=>{
  const f=fixture();f.state.failRows=true;
  const result=await f.subject.updateCompanies([{id,...payload("Nueva")}]);
  assert.equal(result,false);assert.equal(f.state.published,0);assert.equal(f.state.writes.length,0);
  assert.equal(f.state.ops.length,1);
});
test("scheduleEmpresaFlush propaga el fallo y permite un reintento posterior",async()=>{
  const f=fixture();f.state.ops=[op()];f.state.failJournal=true;
  await assert.rejects(f.subject.scheduleEmpresaFlush(user));
  await f.sandbox.empresaQueueRef.current;
  f.state.failJournal=false;
  await f.subject.scheduleEmpresaFlush(user);
  assert.equal(f.state.row.nombre,"Nueva");assert.equal(f.state.ops.length,0);
});
(async()=>{
  let failed=0;
  for(const entry of tests){
    try{await entry.fn();console.log(`PASS: ${entry.name}`);}
    catch(error){failed++;console.error(`FAIL: ${entry.name}\n${error.stack}`);}
  }
  console.log(`\nResultado: ${tests.length-failed}/${tests.length} pruebas correctas.`);
  console.log("Pruebas de logica con dobles simulados. No prueban la interfaz ni llaman a Supabase.");
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
