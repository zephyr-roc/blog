import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { optimizeStandalone } from '../scripts/optimize-standalone.mjs';
async function put(root, name, content) { const file=path.join(root,name); await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,content); }
test('safely trims maps, types, test docs and duplicate public files', async () => {
 const root=await mkdtemp(path.join(tmpdir(),'vinext-slim-'));
 try {
  const st=path.join(root,'dist/standalone');
  await put(st,'server.js','entry');
  await put(st,'dist/server/index.js','server code');
  await put(st,'dist/server/index.js.map','source');
  await put(st,'dist/client/index.html','html');
  await put(st,'dist/client/logo.svg','identical');
  await put(st,'public/logo.svg','identical');
  await put(st,'public/unique.svg','unique');
  await put(st,'node_modules/pkg/index.js','runtime');
  await put(st,'node_modules/pkg/index.d.ts','types');
  await put(st,'node_modules/pkg/test/fixture.js','test');
  await put(st,'node_modules/pkg/module.wasm','wasm');
  await put(st,'node_modules/pkg/native.node','native');
  const result=await optimizeStandalone(root,()=>{});
  assert.ok(result.after.bytes<result.before.bytes);
  await assert.rejects(()=>stat(path.join(st,'public/logo.svg')));
  await assert.rejects(()=>stat(path.join(st,'node_modules/pkg/test/fixture.js')));
  assert.equal(await readFile(path.join(st,'public/unique.svg'),'utf8'),'unique');
  assert.equal(await readFile(path.join(st,'node_modules/pkg/index.js'),'utf8'),'runtime');
  assert.equal(await readFile(path.join(st,'node_modules/pkg/module.wasm'),'utf8'),'wasm');
  assert.equal(await readFile(path.join(st,'node_modules/pkg/native.node'),'utf8'),'native');
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('rejects missing executable standalone',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vinext-slim-'));
 try { await assert.rejects(()=>optimizeStandalone(root,()=>{}),/missing/); }
 finally { await rm(root,{recursive:true,force:true}); }
});
