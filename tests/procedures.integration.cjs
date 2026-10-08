const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@mantos.app', is_anonymous: false, role: 'authenticated', aud: 'authenticated' };
    const token = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'signature'].join('.');
    const tickets = new Map(), files = new Map(), catalog = new Map();
    let failedDownload = false;
    await page.route('https://**/*', async route => {
      const req = route.request(), url = req.url(); let data, status = 200;
      if (url.includes('/auth/v1/token')) data = { access_token: token, refresh_token: 'qa', expires_in: 3600, token_type: 'bearer', user };
      else if (url.includes('/auth/v1/user')) data = user;
      else if (url.includes('/functions/v1/manage-procedures')) {
        const body = req.postDataJSON();
        if (body.action === 'authorize') data = { ok: true, email: user.email };
        if (body.action === 'prepare') { if (!tickets.has(body.upload_id)) tickets.set(body.upload_id, body); data = { ok: true, path: `${body.procedure_id}/${body.upload_id}.pdf`, token: 'upload-token' }; }
        if (body.action === 'finalize') {
          const ticket = tickets.get(body.upload_id), filePath = `${ticket.procedure_id}/${ticket.upload_id}.pdf`;
          if (!files.has(filePath)) { status = 404; data = { error: 'Missing PDF', code: 'missing_file' }; }
          else {
            const bytes = files.get(filePath); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), ticket.metadata.sha256);
            let document = catalog.get(ticket.procedure_id);
            if (!document || document.storage_path !== filePath) document = { ...ticket.metadata, id: ticket.procedure_id, version: ticket.expected_version+1, storage_path: filePath, is_active: true, updated_at: new Date().toISOString() };
            catalog.set(document.id, document); data = { ok: true, document };
          }
        }
        if (body.action === 'retire') { const doc = catalog.get(body.id); assert.equal(doc.version, body.version); doc.is_active = false; doc.version++; data = { ok: true, document: doc }; }
      } else if (url.includes('/storage/v1/object/upload/sign/')) {
        const form = await new Request(url, { method: 'PUT', headers: req.headers(), body: req.postDataBuffer() }).formData();
        const blob = [...form.values()].find(value => typeof value !== 'string');
        files.set(url.split('/procedure-pdfs/')[1].split('?')[0], Buffer.from(await blob.arrayBuffer())); data = { Key: 'uploaded' };
      } else if (url.includes('/storage/v1/object/') && url.includes('/procedure-pdfs/')) {
        const bytes = files.get(url.split('/procedure-pdfs/')[1].split('?')[0]);
        if (!failedDownload && bytes) { await route.fulfill({ status: 200, contentType: 'application/pdf', body: bytes }); return; }
        status = 500; data = { error: 'Simulated interrupted download' };
      } else if (url.includes('/rest/v1/procedures')) data = [...catalog.values()];
      else if (url.includes('/rest/v1/irrigation_measurements') || url.includes('/rest/v1/survey_events')) data = [];
      else { await route.abort(); return; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(process.env.MANTOS_TEST_URL || 'http://127.0.0.1:4175/');
    await page.getByRole('button', { name: 'Acceder como administrador', exact: true }).click();
    await page.getByLabel('Correo', { exact: true }).fill(user.email); await page.getByLabel('Contraseña', { exact: true }).fill('example');
    await page.getByRole('button', { name: 'Ingresar al panel', exact: true }).click();
    await page.getByRole('button', { name: /Panel administrador Gestione/ }).click();
    await page.getByRole('button', { name: /Procedimientos Gestión documental/ }).click();
    await page.getByLabel('Título', { exact: true }).fill('Procedimiento de prueba');
    await page.getByLabel('Documento PDF · máximo 20 MB').setInputFiles({ name: 'procedimiento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nPrueba de sincronización\n%%EOF') });
    await page.getByRole('button', { name: 'Guardar pendiente', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).waitFor();
    assert.equal(catalog.size, 0, 'Saving a draft must not publish immediately');
    await page.getByRole('button', { name: 'Sincronizar procedimientos', exact: true }).click();
    await page.getByRole('button', { name: 'Reemplazar', exact: true }).waitFor();
    assert.equal(catalog.size, 1);
    const id = [...catalog.keys()][0];
    const original = await page.evaluate(async id => { const { procedureStore } = await import('/src/lib/proceduresStore.js'); const doc = await procedureStore('documents','get',id); return { version:doc.version, text:await doc.blob.text() }; }, id);
    assert.equal(original.version, 1); assert.ok(original.text.startsWith('%PDF-'));
    await page.getByRole('button', { name: 'Reemplazar', exact: true }).click();
    await page.getByLabel('Documento PDF · máximo 20 MB').setInputFiles({ name: 'version2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nVersión nueva\n%%EOF') });
    await page.getByRole('button', { name: 'Guardar pendiente', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).waitFor();
    failedDownload = true;
    await page.getByRole('button', { name: 'Sincronizar procedimientos', exact: true }).click();
    await page.getByText(/No se descargaron 1 PDF/).first().waitFor();
    const retained = await page.evaluate(async id => { const { procedureStore } = await import('/src/lib/proceduresStore.js'); return (await procedureStore('documents','get',id)).version; }, id);
    assert.equal(retained, 1, 'Failed replacement download must retain original offline copy');
    failedDownload = false;
    await page.getByRole('button', { name: 'Sincronizar procedimientos', exact: true }).click();
    await page.getByText('Procedimientos sincronizados y disponibles offline.', { exact: true }).waitFor();
    assert.equal(catalog.get(id).version, 2);
    const validation = await page.evaluate(async () => { const { validatePdf } = await import('/src/lib/proceduresStore.js'); try { await validatePdf(new Blob(['not a PDF'])); return false; } catch { return true; } });
    assert.equal(validation, true);
    for (const theme of ['light','dark']) { await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme); for (const width of [375,812,1024]) { await page.setViewportSize({width,height:812}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); } }
    await page.getByRole('button', { name: 'Retirar', exact: true }).click();
    await page.getByRole('button', { name: 'Retirar documento', exact: true }).click();
    await page.getByText('Aún no hay procedimientos publicados.', { exact: true }).waitFor();
    const removed = await page.evaluate(async id => { const { procedureStore } = await import('/src/lib/proceduresStore.js'); return !(await procedureStore('documents','get',id)); }, id);
    assert.equal(removed,true);
    assert.deepEqual(errors,[]);
    console.log('OK: draft, publication, replacement, interrupted download retains old PDF, retry, invalid PDF, retirement removes cache, themes and responsive layout. No real server data changed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
