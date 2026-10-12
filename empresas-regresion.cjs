const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const sourcePath = path.resolve(process.cwd(), "DeCASection.tsx");
const text = fs.readFileSync(sourcePath, "utf8");
const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["applyEmpresaIdRemaps", "flushEmpresaJournal", "scheduleEmpresaFlush", "updateCompanies", "confirmEmpresaDeleteOp", "removeEmpresaPendingOp", "findEmpresaPendingOp"];
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

// Extracción de mergeEstadoEmpresa desde destinatariosService.ts (función real).
const servicePath = path.resolve(process.cwd(), "destinatariosService.ts");
const serviceText = fs.readFileSync(servicePath, "utf8");
const serviceSource = ts.createSourceFile(servicePath, serviceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let mergeDecl;
function visitService(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "mergeEmpresaState") {
    assert(!mergeDecl, "Funcion duplicada: mergeEmpresaState");
    mergeDecl = `const ${node.getText(serviceSource)};`;
  }
  ts.forEachChild(node, visitService);
}
visitService(serviceSource);
assert(mergeDecl, "Falta mergeEmpresaState");
const mergeCompiled = ts.transpileModule(mergeDecl + "\nglobalThis.mergeSubject = mergeEmpresaState;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
const mergeSyntaxErrors = (mergeCompiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(mergeSyntaxErrors.length, 0, "Error de sintaxis al extraer mergeEmpresaState");

const user = "usuario-simulado";
const id = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const payload = nombre => ({nombre, direccion:"Calle 1", ciudad:"Madrid", codigoPostal:"28001",
  provincia:"Madrid", pais:"Espana", nif:"", telefono:"", email:"", contacto:"", notas:""});
const copy = x => structuredClone(x);
function fixture() {
  const state = { ops:[], row:null, map:{}, writes:[], errors:[], notices:[], companies:[],
    failRows:false, failJournal:false, failMap:false, published:0,
    failDelete:false, deleteReportsZero:false, deleteClearsRow:false,
    sessionActive:true, onInsert:null };
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
    empresaSessionMatches:async u=>u===user && state.sessionActive,
    getEmpresaRowByIdForUser:async()=>copy(state.row),
    insertUserEmpresaHabitual:async fields=>{
      state.writes.push({kind:"insert",payload:copy(fields),evidence:copy(state.ops)});
      state.row={...fields};
      if(state.onInsert){const hook=state.onInsert;state.onInsert=null;await hook();}
      return copy(state.row);
    },
    updateUserEmpresaHabitual:async (_id,fields)=>{
      state.writes.push({kind:"update",payload:copy(fields)});
      state.row={...state.row,...fields};return copy(state.row);
    },
    deleteUserEmpresaHabitual:async (targetId,expectedUserId)=>{
      if(state.failDelete) throw new Error("fallo de red simulado");
      state.writes.push({kind:"delete",targetId,expectedUserId});
      if(state.deleteReportsZero){
        if(state.deleteClearsRow) state.row=null;
        return {deleted:false};
      }
      state.row=null;return {deleted:true};
    },
    toEmpresaWriteFields:copy,
    payloadMatchesEmpresaRow:(p,row)=>Object.keys(p).every(k=>p[k]===row[k]),
    empresaPayloadsEqual:equal,
    empresaPayloadFrom:company=>Object.fromEntries(Object.keys(payload("")).map(k=>[k,company[k]])),
    recipientDuplicateKey:r=>[r.nombre,r.direccion,r.ciudad].join("\u0000"),
    empresaBusinessFieldsEqual:(a,b)=>["nombre","direccion","ciudad"].every(k=>a[k]===b[k]),
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
  vm.runInContext(mergeCompiled.outputText, sandbox, {timeout:5000});
  return {state,sandbox,subject:sandbox.subject};
}
function op(extra={}) {return {userId:user,kind:"insert",localId:id,targetId:id,revision:2,
  payload:payload("Nueva"),createdAt:"2026-01-01",updatedAt:"2026-01-02",...extra};}
function deleteOp(extra={}) {return {userId:user,kind:"delete",localId:id,targetId:id,revision:3,
  createdAt:"2026-01-01",updatedAt:"2026-01-03",...extra};}
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

// --- Borrado persistente de empresas -------------------------------------

test("updateCompanies registra el borrado pendiente y lo confirma contra el servidor",async()=>{
  const f=fixture();
  const row={id,...payload("Borrar"),createdAt:"2026-01-01",updatedAt:"2026-01-02"};
  f.sandbox.companiesRef.current=[row];
  f.sandbox.remoteEmpresaIdsRef.current.add(id);
  f.state.row={id,user_id:user,...payload("Borrar")};
  const result=await f.subject.updateCompanies([]);
  assert.equal(result,true);
  const deletes=f.state.writes.filter(w=>w.kind==="delete");
  assert.equal(deletes.length,1);
  assert.equal(deletes[0].targetId,id);
  assert.equal(deletes[0].expectedUserId,user);
  assert.equal(f.state.ops.length,0,"el pendiente se retira tras confirmar");
  assert.deepEqual(f.state.companies,[]);
  assert.deepEqual(f.sandbox.companiesRef.current,[]);
});

test("Borrado con fallo de red conserva el pendiente y el reintento lo completa",async()=>{
  const f=fixture();
  const row={id,...payload("Borrar"),createdAt:"2026-01-01",updatedAt:"2026-01-02"};
  f.sandbox.companiesRef.current=[row];
  f.state.row={id,user_id:user,...payload("Borrar")};
  f.state.failDelete=true;
  const result=await f.subject.updateCompanies([]);
  assert.equal(result,false);
  assert.equal(f.state.ops.length,1,"el borrado pendiente persiste");
  assert.equal(f.state.ops[0].kind,"delete");
  assert.equal(f.state.ops[0].targetId,id);
  assert.ok(f.state.errors.length>0,"se muestra un error, no un éxito falso");
  f.state.failDelete=false;
  await f.subject.scheduleEmpresaFlush(user);
  assert.equal(f.state.ops.length,0);
  assert.equal(f.state.writes.filter(w=>w.kind==="delete").length,1);
});

test("deleted:false distingue fila ya ausente de operacion fallida",async()=>{
  // (a) la fila sigue presente y el servidor no reportó borrado: fallo real.
  const a=fixture();a.state.row={id,user_id:user,...payload("X")};
  a.state.ops=[deleteOp()];a.state.deleteReportsZero=true;
  await assert.rejects(a.subject.flushEmpresaJournal(user));
  assert.equal(a.state.ops.length,1,"se conserva la intención recuperable");
  // (b) la fila desaparece entre llamadas: se retira sin error.
  const b=fixture();b.state.row={id,user_id:user,...payload("X")};
  b.state.ops=[deleteOp()];b.state.deleteReportsZero=true;b.state.deleteClearsRow=true;
  await b.subject.flushEmpresaJournal(user);
  assert.equal(b.state.ops.length,0);
  // (c) la fila ya no existía: se retira sin siquiera llamar a borrar.
  const c=fixture();c.state.row=null;c.state.ops=[deleteOp()];
  await c.subject.flushEmpresaJournal(user);
  assert.equal(c.state.ops.length,0);
  assert.equal(c.state.writes.filter(w=>w.kind==="delete").length,0);
});
test("Borrado solicitado mientras el INSERT esta en curso borra la fila insertada",async()=>{
  const f=fixture();
  f.state.ops=[op()];
  f.state.row=null;
  f.state.onInsert=()=>{
    // Mientras el INSERT sigue en vuelo, el usuario borra la empresa.
    f.state.ops=[deleteOp()];
  };
  f.sandbox.companiesRef.current=[{id,...payload("Nueva"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  await f.subject.flushEmpresaJournal(user);
  const deletes=f.state.writes.filter(w=>w.kind==="delete");
  assert.equal(deletes.length,1);
  assert.equal(deletes[0].targetId,id,"se borra el targetId realmente insertado");
  assert.equal(f.state.ops.length,0);
  assert.equal(f.state.row,null,"la fila insertada no sobrevive");
  assert.equal(f.state.writes.filter(w=>w.kind==="update").length,0);
  assert.ok(!f.sandbox.companiesRef.current.some(c=>c.id===id),"no se publica la fila insertada");
});

test("Cambio de sesion durante el borrado conserva el pendiente sin exito falso",async()=>{
  const f=fixture();
  f.state.row={id,user_id:user,...payload("X")};
  f.state.ops=[deleteOp()];
  const originalDelete=f.sandbox.deleteUserEmpresaHabitual;
  f.sandbox.deleteUserEmpresaHabitual=async (targetId,expectedUserId)=>{
    const result=await originalDelete(targetId,expectedUserId);
    f.state.sessionActive=false; // la sesión cambia tras la llamada
    return result;
  };
  await f.subject.flushEmpresaJournal(user);
  assert.equal(f.state.ops.length,1,"no se retira el pendiente de la cuenta original");
  assert.equal(f.state.ops[0].kind,"delete");
});

test("removeEmpresaPendingOp exige revision y tipo coincidentes",()=>{
  const f=fixture();
  f.state.ops=[deleteOp()];
  assert.equal(f.subject.removeEmpresaPendingOp(user,id,3,"delete"),true);
  assert.equal(f.state.ops.length,0);
  f.state.ops=[deleteOp()];
  assert.equal(f.subject.removeEmpresaPendingOp(user,id,3,"update"),false);
  assert.equal(f.subject.removeEmpresaPendingOp(user,id,2,"delete"),false);
  assert.equal(f.state.ops.length,1);
});

test("La confirmacion del borrado invalida una carga remota iniciada antes",async()=>{
  const f=fixture();
  f.state.row={id,user_id:user,...payload("Borrar")};
  f.state.ops=[deleteOp()];
  const mutationVersionAtRequest=f.sandbox.empresaMutationVersionRef.current;
  await f.subject.flushEmpresaJournal(user);
  assert.equal(f.state.ops.length,0);
  assert.notEqual(mutationVersionAtRequest,f.sandbox.empresaMutationVersionRef.current,
    "el guardia de versión de la carga automática descarta la respuesta antigua");
});

test("mergeEmpresaState excluye borrados pendientes solo del usuario actual",()=>{
  const f=fixture();
  const local=[{id,...payload("Local"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const remote=[{id,...payload("Remota"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const del=deleteOp();
  const pending=f.sandbox.mergeSubject(local,remote,[del],user);
  assert.ok(!pending.rows.some(r=>r.id===id),"la fila con borrado pendiente no reaparece");
  const foreign=f.sandbox.mergeSubject(local,remote,[del],"otro-usuario");
  assert.ok(foreign.rows.some(r=>r.id===id),"un borrado de otra cuenta no afecta a esta");
});

test("mergeEmpresaState conserva ediciones pendientes y respaldo local",()=>{
  const f=fixture();
  const editOp={...op(),payload:payload("Editada")};
  const local=[{id,...payload("Editada"),createdAt:"2026-01-01",updatedAt:"2026-01-03"},
    {id:target,...payload("Respaldo"),createdAt:"2026-01-01",updatedAt:"2026-01-01"}];
  const remote=[{id,...payload("Remota"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const merged=f.sandbox.mergeSubject(local,remote,[editOp],user);
  assert.ok(merged.rows.some(r=>r.id===id && r.nombre==="Editada"),"la edición pendiente se conserva");
  assert.ok(merged.rows.some(r=>r.id===target),"el respaldo local sin remoto se conserva");
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
