const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const sourcePath = path.resolve(process.cwd(), "DeCASection.tsx");
const text = fs.readFileSync(sourcePath, "utf8");
const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const servicePath = path.resolve(process.cwd(), "destinatariosService.ts");
const serviceText = fs.readFileSync(servicePath, "utf8");
const serviceSource = ts.createSourceFile(servicePath, serviceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = [
  "applyEmpresaIdRemaps", "flushEmpresaJournal", "scheduleEmpresaFlush", "updateCompanies",
  "confirmEmpresaDeleteOp", "removeEmpresaPendingOp", "findEmpresaPendingOp",
  "applyRemoteEmpresaRows", "removeLocalUnsyncedCopy",
  // Funciones reales de destinatariosService.ts.
  "mergeEmpresaState", "nextEmpresaSyncedIds", "loadEmpresaSyncedIds", "saveEmpresaSyncedIds",
  "userStorageKey", "isUuid", "EMPRESAS_SYNCED_IDS_STORAGE_KEY",
];
const declarations = new Map();
function collect(ast) {
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      assert(!declarations.has(node.name.text), `Funcion duplicada: ${node.name.text}`);
      declarations.set(node.name.text, `const ${node.getText(ast)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
collect(source);
collect(serviceSource);
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
    failRows:false, failJournal:false, failMap:false, published:0,
    failDelete:false, deleteReportsZero:false, deleteClearsRow:false,
    sessionActive:true, onInsert:null,
    loadErrors:[], unsynced:[], remoteRows:[], failRemoteList:false, confirmResult:true,
    failEvidenceWrite:false,
    individualRows:{}, individualChecks:[], failIndividualCheck:false, onIndividualCheck:null };
  const store = new Map();
  const localStorage = {
    getItem:key=>store.has(key)?store.get(key):null,
    setItem:(key,value)=>{
      if(state.failEvidenceWrite) throw new Error("almacenamiento lleno simulado");
      store.set(key,String(value));
    },
    removeItem:key=>{store.delete(key);},
  };
  const companyRef = { current:[] };
  const equal = (a,b) => Object.keys(a).every(k => a[k] === b[k]);
  const noop = () => {};
  const sandbox = {
    console:{error:noop}, Date, Set, Map, Promise, localStorage,
    mountedRef:{current:true}, companyUserIdRef:{current:user},
    companiesRef:companyRef, empresaMutationVersionRef:{current:0},
    empresaQueueRef:{current:Promise.resolve()}, remoteEmpresaIdsRef:{current:new Set()},
    empresaMergeAmbiguityRef:{current:false}, companyUnsyncedRowsRef:{current:[]},
    formRef:{current:{cargadorId:""}},
    window:{confirm:()=>state.confirmResult},
    listUserEmpresasHabituales:async()=>{
      if(state.failRemoteList) throw new Error("fallo de lectura simulado");
      return copy(state.remoteRows);
    },
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
    getEmpresaRowByIdForUser:async (rowId)=>{
      state.individualChecks.push(rowId);
      if(state.onIndividualCheck){const hook=state.onIndividualCheck;state.onIndividualCheck=null;await hook();}
      if(state.failIndividualCheck) throw new Error("fallo de consulta individual simulado");
      if(rowId && Object.prototype.hasOwnProperty.call(state.individualRows,rowId)){
        return copy(state.individualRows[rowId]);
      }
      return copy(state.row);
    },
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
    setCompanyLoadError:message=>message?state.loadErrors.push(message):state.loadErrors.splice(0),
    setCompanyUnsyncedRows:rows=>{state.unsynced=copy(rows);},
    setCompanyStorageWarning:noop, setHasPendingCompanyMigration:noop,
    setCompanySyncNotice:message=>state.notices.push(message),
    setCompanies:()=>state.published++, setDecas:noop, setForm:noop,
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled.outputText, sandbox, {timeout:5000});
  return {state,sandbox,store,subject:sandbox.subject};
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

test("removeEmpresaPendingOp exige revision y tipo coincidentes",async()=>{
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

test("mergeEmpresaState excluye borrados pendientes solo del usuario actual",async()=>{
  const f=fixture();
  const local=[{id,...payload("Local"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const remote=[{id,...payload("Remota"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const del=deleteOp();
  const pending=f.subject.mergeEmpresaState(local,remote,[del],user,new Set());
  assert.ok(!pending.rows.some(r=>r.id===id),"la fila con borrado pendiente no reaparece");
  const foreign=f.subject.mergeEmpresaState(local,remote,[del],"otro-usuario",new Set());
  assert.ok(foreign.rows.some(r=>r.id===id),"un borrado de otra cuenta no afecta a esta");
});

test("mergeEmpresaState conserva ediciones pendientes y respaldo local",async()=>{
  const f=fixture();
  const editOp={...op(),payload:payload("Editada")};
  const local=[{id,...payload("Editada"),createdAt:"2026-01-01",updatedAt:"2026-01-03"},
    {id:target,...payload("Respaldo"),createdAt:"2026-01-01",updatedAt:"2026-01-01"}];
  const remote=[{id,...payload("Remota"),createdAt:"2026-01-01",updatedAt:"2026-01-02"}];
  const merged=f.subject.mergeEmpresaState(local,remote,[editOp],user,new Set());
  assert.ok(merged.rows.some(r=>r.id===id && r.nombre==="Editada"),"la edición pendiente se conserva");
  assert.ok(merged.rows.some(r=>r.id===target),"el respaldo local sin remoto se conserva");
});

// --- Convergencia entre dispositivos (evidencia duradera) -------------------

const rid = "2cac9990-496a-4fdd-9ab0-c1594d658f9c"; // fila remota real INDA LEVANTE
const empresa = (idValue, nombre, extra={}) =>
  ({id:idValue, ...payload(nombre), createdAt:"2026-01-01", updatedAt:"2026-01-02", ...extra});

test("Dispositivo B no reintroduce una empresa borrada en A",async()=>{
  const f=fixture();
  const local=empresa(rid,"INDA LEVANTE S.L.");
  f.sandbox.companiesRef.current=[local];
  f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const snapshot=new Set(f.subject.loadEmpresaSyncedIds(user).ids); // antes de la consulta
  f.state.remoteRows=[]; // A la borró: la lectura completa ya no la devuelve
  await f.subject.applyRemoteEmpresaRows([],user,snapshot);
  assert.equal(f.state.loadErrors.length,0);
  assert.ok(!f.state.companies.some(r=>r.id===rid),"lista guardada sin la fila");
  assert.ok(!f.sandbox.companiesRef.current.some(r=>r.id===rid),"no se publica con la fila");
  assert.equal(f.subject.loadEmpresaSyncedIds(user).ids.length,0,"evidencia limpia");
  assert.equal(f.state.unsynced.length,0);

  // Recarga de B con lo persistido: no reaparece.
  const g=fixture();
  g.sandbox.companiesRef.current=copy(f.state.companies);
  g.state.companies=copy(f.state.companies);
  for(const [k,v] of f.store) g.store.set(k,v);
  const snapshot2=new Set(g.subject.loadEmpresaSyncedIds(user).ids);
  await g.subject.applyRemoteEmpresaRows([],user,snapshot2);
  assert.ok(!g.state.companies.some(r=>r.id===rid),"no reaparece tras recargar");
  assert.equal(g.state.loadErrors.length,0);
});

test("Alta local pendiente no se pierde ni entra en la revisión",async()=>{
  const f=fixture();
  const local=empresa(target,"Nueva Empresa");
  f.sandbox.companiesRef.current=[local];
  f.state.ops=[op({localId:target,targetId:target})];
  await f.subject.applyRemoteEmpresaRows([],user,new Set());
  assert.ok(f.state.companies.some(r=>r.id===target),"se conserva el alta pendiente");
  assert.equal(f.state.unsynced.length,0,"está subiendo: no es copia a revisar");
  assert.equal(f.state.loadErrors.length,0);
});

test("La revisión exige lectura vigente y condiciones estables antes de eliminar la copia local",async()=>{
  const f=fixture();
  const local=empresa(target,"INDA LEVANTE S.L.",{direccion:"C/ JOSE SANCHEZ SEZ, 19 B",codigoPostal:"3202"});
  f.sandbox.companiesRef.current=[local];
  f.state.companies=[local];
  // (a) fallo de lectura remota → nada se elimina.
  f.state.failRemoteList=true;
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.companies.some(r=>r.id===target));
  assert.ok(f.state.errors.some(m=>m.includes("no se eliminó nada")));
  // (b) el id sí existe en el servidor → no es copia local.
  f.state.failRemoteList=false;
  f.state.remoteRows=[empresa(target,"INDA LEVANTE S.L.")];
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.companies.some(r=>r.id===target));
  assert.ok(f.state.errors.some(m=>m.includes("existe en el servidor")));
  // (c) tiene operaciones pendientes → no se elimina.
  f.state.remoteRows=[];
  f.state.ops=[op({localId:target,targetId:target})];
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.companies.some(r=>r.id===target));
  assert.ok(f.state.errors.some(m=>m.includes("pendientes")));
  f.state.ops=[];
  // (d) el usuario cancela la confirmación.
  f.state.confirmResult=false;
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.companies.some(r=>r.id===target));
  // (e) la sesión cambia durante la comprobación → se cancela.
  f.state.confirmResult=true;
  f.state.sessionActive=false;
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.companies.some(r=>r.id===target));
  f.state.sessionActive=true;
  // (f) camino válido: elimina solo la copia local, sin ops ni DELETE remoto.
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(!f.state.companies.some(r=>r.id===target));
  assert.equal(f.state.ops.length,0,"sin operaciones en el diario");
  assert.equal(f.state.writes.filter(w=>w.kind==="delete").length,0,"sin DELETE remoto");
});

test("La copia '3202' sin evidencia no se borra por confundirla con '03202'",async()=>{
  const f=fixture();
  const local=empresa(target,"INDA LEVANTE S.L.",
    {direccion:"C/ JOSE SANCHEZ SEZ, 19 B",codigoPostal:"3202"});
  f.sandbox.companiesRef.current=[local];
  f.state.companies=[local];
  const remote=[empresa(rid,"INDA LEVANTE S.L.",
    {direccion:"JOSE SANCHEZ SAEZ 19 BAJO",codigoPostal:"03202"})];
  // Sin evidencia de la id local: la ausencia de pareja no es prueba de borrado.
  await f.subject.applyRemoteEmpresaRows(remote,user,new Set());
  assert.ok(f.state.companies.some(r=>r.id===target),"la copia sin evidencia se conserva");
  assert.ok(f.state.companies.some(r=>r.id===rid),"la fila remota también se muestra");
  assert.ok(f.state.unsynced.some(r=>r.id===target),"queda expuesta para revisión explícita");
  assert.ok(!f.state.unsynced.some(r=>r.id===rid),"la remota no es copia a revisar");
});

test("Si falla guardar la lista no se publica ni se toca la evidencia",async()=>{
  const f=fixture();
  const local=empresa(rid,"INDA LEVANTE S.L.");
  f.sandbox.companiesRef.current=[local];
  f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const snapshot=new Set(f.subject.loadEmpresaSyncedIds(user).ids);
  f.state.failRows=true;
  await f.subject.applyRemoteEmpresaRows([],user,snapshot);
  assert.equal(f.state.loadErrors.length,1,"se muestra el fallo");
  assert.ok(f.sandbox.companiesRef.current.some(r=>r.id===rid),"no se publica");
  assert.equal(f.subject.loadEmpresaSyncedIds(user).ids.join(","),rid,"evidencia intacta");
});

test("Si falla guardar la evidencia no se anuncia completada y el reintento converge",async()=>{
  const f=fixture();
  const local=empresa(rid,"INDA LEVANTE S.L.");
  f.sandbox.companiesRef.current=[local];
  f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const snapshot=new Set([rid]);
  f.state.failEvidenceWrite=true;
  await f.subject.applyRemoteEmpresaRows([],user,snapshot);
  assert.equal(f.state.loadErrors.length,1);
  assert.ok(f.state.loadErrors[0].includes("no se da por completada"));
  assert.ok(!f.state.companies.some(r=>r.id===rid),"la lista reconciliada YA quedó guardada");
  assert.ok(f.sandbox.companiesRef.current.some(r=>r.id===rid),"no se publica: falta la evidencia");
  assert.equal(f.subject.loadEmpresaSyncedIds(user).ids.join(","),rid,"evidencia pendiente");
  // Reintento: recalcula desde la evidencia anterior, idempotente.
  f.state.failEvidenceWrite=false;
  const snapshot2=new Set(f.subject.loadEmpresaSyncedIds(user).ids);
  await f.subject.applyRemoteEmpresaRows([],user,snapshot2);
  assert.equal(f.state.loadErrors.length,0,"segundo intento completado");
  assert.ok(!f.sandbox.companiesRef.current.some(r=>r.id===rid),"sin reintroducir la fila");
  assert.equal(f.subject.loadEmpresaSyncedIds(user).ids.length,0);
});

test("update pendiente sobre fila ausente se conserva y no se recrea como insert",async()=>{
  const f=fixture();
  f.state.ops=[op({kind:"update"})];
  f.state.row=null;
  await assert.rejects(f.subject.flushEmpresaJournal(user));
  assert.equal(f.state.writes.filter(w=>w.kind==="insert").length,0,"ningún insert automático");
  assert.equal(f.state.ops.length,1,"el cambio pendiente se conserva para recuperación");
  const local=empresa(id,"Editada");
  const merged=f.subject.mergeEmpresaState([local],[],f.state.ops,user,new Set([id]));
  assert.ok(merged.rows.some(r=>r.id===id),"la fusión conserva la fila con pendiente");
  assert.equal(merged.staleConfirmedIds.length,0,"no se marca como borrada mientras haya pendiente");
  assert.equal(f.state.errors.length,0,"la fusión no informa falsos positivos");
});

test("La evidencia y las filas quedan aisladas por cuenta",async()=>{
  const f=fixture();
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  assert.equal(f.subject.loadEmpresaSyncedIds("otro-usuario").ids.length,0,
    "la evidencia de una cuenta no se lee desde otra");
  const local=empresa(target,"Mia");
  f.sandbox.companiesRef.current=[local];
  f.sandbox.companyUserIdRef.current="otro-usuario";
  await f.subject.applyRemoteEmpresaRows([],user,new Set());
  assert.ok(f.sandbox.companiesRef.current.some(r=>r.id===target),
    "una respuesta con la sesión cambiada no toca la lista");
  assert.equal(f.state.loadErrors.length,0);
});

test("Tras un remapeo no queda evidencia asociada solo al id viejo",async()=>{
  const f=fixture();
  const nextIds=f.subject.nextEmpresaSyncedIds([id],[target],[empresa(target,"X")],[]);
  assert.equal(nextIds.length,1);
  assert.ok(nextIds.includes(target),"la nueva id sí tiene evidencia");
  assert.ok(!nextIds.includes(id),"la id vieja sin fila local ni remota se retira");
  // Evidencia exclusivamente en la id vieja con la fila ya remapeada:
  const onlyOld=f.subject.nextEmpresaSyncedIds([id],[target],[empresa(target,"X")],[id]);
  assert.equal(onlyOld.join(","),target);
});

test("Consulta individual conserva una fila omitida por la lista paginada",async()=>{
  const f=fixture(); const local=empresa(rid,"Existente");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  f.subject.saveEmpresaSyncedIds([rid],user);
  f.state.individualRows[rid]={...local,user_id:user,nombre:"Vigente"};
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.ok(f.state.individualChecks.includes(rid));
  assert.ok(f.state.companies.some(r=>r.id===rid && r.nombre==="Vigente"));
  assert.ok(f.subject.loadEmpresaSyncedIds(user).ids.includes(rid));
});
test("Fallo de consulta individual conserva copia y evidencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  f.subject.saveEmpresaSyncedIds([rid],user); f.state.failIndividualCheck=true;
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.ok(f.subject.loadEmpresaSyncedIds(user).ids.includes(rid));
});
test("Ausencia individual confirmada permite retirar la copia sincronizada",async()=>{
  const f=fixture(); const local=empresa(rid,"Ausente");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  f.subject.saveEmpresaSyncedIds([rid],user); f.state.individualRows[rid]=null;
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.ok(f.state.individualChecks.includes(rid));
  assert.ok(!f.state.companies.some(r=>r.id===rid));
});
test("Cambio de sesion o version durante consulta individual impide publicar",async()=>{
  for(const change of [f=>{f.state.sessionActive=false;},f=>{f.sandbox.empresaMutationVersionRef.current++;}]){
    const f=fixture(); const local=empresa(rid,"Conservar");
    f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
    f.subject.saveEmpresaSyncedIds([rid],user);
    f.state.onIndividualCheck=()=>change(f);
    await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
    assert.equal(f.state.published,0);
    assert.ok(f.state.companies.some(r=>r.id===rid));
    assert.ok(f.subject.loadEmpresaSyncedIds(user).ids.includes(rid));
  }
});
test("Eliminar copia local se cancela si consulta individual encuentra fila remota",async()=>{
  const f=fixture(); const local=empresa(target,"Existente");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  f.state.remoteRows=[]; f.state.individualRows[target]={...local,user_id:user};
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.ok(f.state.individualChecks.includes(target));
  assert.ok(f.state.companies.some(r=>r.id===target));
  assert.equal(f.state.published,0); assert.equal(f.state.writes.length,0);
  assert.ok(f.state.errors.some(e=>e.includes("existe en el servidor")));
});

test("reconciliacion: cambio de version durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.empresaMutationVersionRef.current++;}
    return true;
  };
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
});

test("reconciliacion: cambio de cuenta durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.companyUserIdRef.current="otra-cuenta";}
    return true;
  };
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
});

test("reconciliacion: cambio de montaje durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.mountedRef.current=false;}
    return true;
  };
  await f.subject.applyRemoteEmpresaRows([],user,new Set([rid]));
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
});

test("eliminacion local: cambio de version durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.empresaMutationVersionRef.current++;}
    return true;
  };
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
});

test("eliminacion local: cambio de cuenta durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.companyUserIdRef.current="otra-cuenta";}
    return true;
  };
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
});

test("eliminacion local: cambio de montaje durante espera de sesion cancela persistencia",async()=>{
  const f=fixture(); const local=empresa(rid,"Conservar");
  f.sandbox.companiesRef.current=[local]; f.state.companies=[local];
  assert.ok(f.subject.saveEmpresaSyncedIds([rid],user));
  const before=JSON.stringify([...f.store]); let persisted=0;
  const originalPersist=f.sandbox.persistEmpresaRows;
  f.sandbox.persistEmpresaRows=(...args)=>{persisted++;return originalPersist(...args);};
  let changed=false;
  f.sandbox.empresaSessionMatches=async()=>{
    await Promise.resolve();
    if(!changed){changed=true;f.sandbox.mountedRef.current=false;}
    return true;
  };
  await f.subject.removeLocalUnsyncedCopy(local);
  assert.equal(changed,true); assert.equal(persisted,0);
  assert.equal(f.state.published,0);
  assert.ok(f.state.companies.some(r=>r.id===rid));
  assert.equal(JSON.stringify([...f.store]),before);
  assert.equal(f.state.writes.length,0);
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
