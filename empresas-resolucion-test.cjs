const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const file = 'empresasHabitualesSupabaseService.ts';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let fn;
for (const node of source.statements) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadUserEmpresaHabitualForDeCA') {
    assert(!fn, 'Funcion duplicada');
    fn = node.getText(source).replace(/^export\s+/, '');
  }
}
assert(fn, 'No se encontro loadUserEmpresaHabitualForDeCA');
const compiled = ts.transpileModule(fn + '\nglobalThis.subject = loadUserEmpresaHabitualForDeCA;', {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}
}).outputText;
const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const userId = 'usuario-simulado';
let passed = 0;
async function check(name, input, idMap, expected) {
  const filters = [];
  const mapReads = [];
  const query = {
    select(){return this;},
    eq(key,value){filters.push([key,value]);return this;},
    async maybeSingle(){return {data:{id:filters.find(([key])=>key==='id')?.[1],user_id:userId},error:null};}
  };
  const context = {
    requireCurrentUserId:async()=>userId,
    loadEmpresaIdMap:u=>{mapReads.push(u);return idMap;},
    isUuid:value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    EMPRESA_COLUMNS:'id,user_id',
    supabase:{from:table=>{assert.equal(table,'empresas_habituales');return query;}},
    mapSupabaseEmpresaHabitualToLocal:row=>row,
    throwSupabaseError:(_operation,message)=>{throw new Error(message);}
  };
  vm.createContext(context);
  vm.runInContext(compiled,context,{timeout:5000});
  const result = await context.subject(input, '', '');
  assert.equal(result.id,expected);
  assert.equal(filters.find(([key])=>key==='id')?.[1],expected);
  assert.equal(filters.find(([key])=>key==='user_id')?.[1],userId);
  assert.deepEqual(mapReads,[userId]);
  console.log('PASS: '+name);
  passed++;
}

// deleteUserEmpresaHabitual: borrado remoto con expectedUserId y UUID.
let deleteFn;
for (const node of source.statements) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'deleteUserEmpresaHabitual') {
    assert(!deleteFn, 'Funcion duplicada');
    deleteFn = node.getText(source).replace(/^export\s+/, '');
  }
}
assert(deleteFn, 'No se encontro deleteUserEmpresaHabitual');
const deleteCompiled = ts.transpileModule(deleteFn + '\nglobalThis.subject = deleteUserEmpresaHabitual;', {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}
}).outputText;

function deleteContext({ data = null } = {}) {
  const filters = [];
  const query = {
    delete(){return this;},
    select(){return this;},
    eq(key,value){filters.push([key,value]);return this;},
    async maybeSingle(){return {data,error:null};}
  };
  const context = {
    requireCurrentUserId: async () => userId,
    isUuid: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    supabase: { from: table => { assert.equal(table, 'empresas_habituales'); return query; } },
    throwSupabaseError: (_operation, message) => { throw new Error(message); }
  };
  vm.createContext(context);
  vm.runInContext(deleteCompiled, context, {timeout:5000});
  return { context, filters, dataRef: { get data(){ return data; } } };
}

(async()=>{
  await check('UUID antiguo usa el ID remapeado',oldId,{[oldId]:newId},newId);
  await check('UUID sin remapeo conserva su ID',oldId,{},oldId);
  await check('ID antiguo no UUID usa el mapa','empresa-local',{['empresa-local']:newId},newId);

  // 1) Borrado exitoso: filtra id y user_id esperado.
  {
    const { context, filters } = deleteContext({ data: { id: oldId } });
    const result = await context.subject(oldId, userId);
    assert.equal(result.deleted, true);
    assert.deepEqual(filters, [['id', oldId], ['user_id', userId]]);
    console.log('PASS: deleteUserEmpresaHabitual filtra id y user_id esperado');
    passed++;
  }
  // 2) Sin fila eliminada: { deleted: false } no es un error por sí mismo.
  {
    const { context } = deleteContext({ data: null });
    const result = await context.subject(oldId, userId);
    assert.equal(result.deleted, false);
    console.log('PASS: deleteUserEmpresaHabitual distingue fila ausente con { deleted: false }');
    passed++;
  }
  // 3) UUID inválido: rechaza sin tocar Supabase.
  {
    const { context } = deleteContext({});
    await assert.rejects(() => context.subject('no-uuid', userId));
    console.log('PASS: deleteUserEmpresaHabitual rechaza identificadores no UUID');
    passed++;
  }
  // 4) Sesión distinta del propietario esperado: rechaza.
  {
    const { context } = deleteContext({});
    await assert.rejects(() => context.subject(oldId, 'otro-usuario'));
    console.log('PASS: deleteUserEmpresaHabitual rechaza un propietario esperado distinto');
    passed++;
  }
  console.log(`\nResultado: ${passed}/7 pruebas correctas. Sin red ni Supabase real.`);
})().catch(error=>{console.error('FAIL:',error.stack);process.exitCode=1;});
