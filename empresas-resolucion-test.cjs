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

// listUserEmpresasHabituales: lectura paginada completa.
let listFn = null;
let pageSizeDecl = null;
for (const node of source.statements) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'listUserEmpresasHabituales') {
    listFn = node.getText(source).replace(/^export\s+/, '');
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === 'EMPRESA_PAGE_SIZE') {
        pageSizeDecl = `const ${decl.getText(source)};`;
      }
    }
  }
}
assert(listFn, 'No se encontro listUserEmpresasHabituales');
assert(pageSizeDecl, 'No se encontro EMPRESA_PAGE_SIZE');
const listCompiled = ts.transpileModule(
  pageSizeDecl + '\n' + listFn + '\nglobalThis.listSubject = listUserEmpresasHabituales;',
  { compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None} }
).outputText;

function runListHarness(dbRows, failOnPage = 0) {
  const requests = [];
  const orderCalls = [];
  const context = {
    requireCurrentUserId: async () => userId,
    EMPRESA_COLUMNS: 'id',
    throwSupabaseError: (_operation, message) => { throw new Error(message); },
    supabase: { from: table => {
      assert.equal(table, 'empresas_habituales');
      return {
        select(){ return this; },
        eq(){ return this; },
        order(column, options){ orderCalls.push([column, options]); return this; },
        range(from, to){
          requests.push([from, to]);
          if (requests.length === failOnPage) {
            return Promise.resolve({ data: null, error: { message: 'fallo simulado', code: 'XX000' } });
          }
          return Promise.resolve({ data: dbRows.slice(from, to + 1), error: null });
        },
      };
    } },
  };
  vm.createContext(context);
  vm.runInContext(listCompiled, context, { timeout: 5000 });
  return { context, requests, orderCalls };
}

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
  // 5) Lectura paginada completa (502 filas = 1 página llena + final corta).
  {
    const dbRows = Array.from({ length: 502 }, (_, i) => ({
      id: `${String(i).padStart(4, '0')}000000-0000-4000-8000-000000000000`,
    }));
    const { context, requests, orderCalls } = runListHarness(dbRows);
    const result = await context.listSubject();
    assert.equal(result.length, 502, 'lee todas las filas');
    assert.equal(requests.length, 2, 'dos páginas');
    assert.deepEqual(requests[0], [0, 499]);
    assert.deepEqual(requests[1], [500, 999]);
    assert.equal(orderCalls[0][0], 'id', 'orden estable por id');
    assert.equal(orderCalls[0][1].ascending, true);
    console.log('PASS: la lectura remota pagina por id hasta la página final corta');
    passed++;
  }
  // 6) Múltiplo exacto del tamaño de página: la página final vacía marca el fin.
  {
    const dbRows = Array.from({ length: 500 }, (_, i) => ({
      id: `${String(i).padStart(4, '0')}000000-0000-4000-8000-000000000000`,
    }));
    const { context, requests } = runListHarness(dbRows);
    const result = await context.listSubject();
    assert.equal(result.length, 500);
    assert.equal(requests.length, 2, 'no confunde el múltiplo exacto con un fallo');
    console.log('PASS: un tamaño exacto de página no se interpreta como lectura incompleta');
    passed++;
  }
  // 7) Fallo en la segunda página: aborta sin devolver un resultado parcial.
  {
    const dbRows = Array.from({ length: 502 }, (_, i) => ({
      id: `${String(i).padStart(4, '0')}000000-0000-4000-8000-000000000000`,
    }));
    const { context } = runListHarness(dbRows, 2);
    await assert.rejects(() => context.listSubject());
    console.log('PASS: una página fallida aborta la lectura entera (sin parcial)');
    passed++;
  }
  console.log(`\nResultado: ${passed}/10 pruebas correctas. Sin red ni Supabase real.`);
})().catch(error=>{console.error('FAIL:',error.stack);process.exitCode=1;});
