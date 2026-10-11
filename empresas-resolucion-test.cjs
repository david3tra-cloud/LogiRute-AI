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
}
(async()=>{
  await check('UUID antiguo usa el ID remapeado',oldId,{[oldId]:newId},newId);
  await check('UUID sin remapeo conserva su ID',oldId,{},oldId);
  await check('ID antiguo no UUID usa el mapa','empresa-local',{['empresa-local']:newId},newId);
  console.log('\nResultado: 3/3 pruebas correctas. Sin red ni Supabase real.');
})().catch(error=>{console.error('FAIL:',error.stack);process.exitCode=1;});
