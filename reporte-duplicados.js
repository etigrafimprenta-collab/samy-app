#!/usr/bin/env node

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ ERROR: firebase-service-account.json no encontrado');
  console.error(`Búscalo en: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'samy-fidabel'
});

const db = admin.firestore();

async function generarReporte() {
  console.log('📊 Generando reporte de duplicados...\n');

  try {
    console.log('⏳ Cargando registros...');
    const recordsSnap = await db.collection('savedRecords').get();
    const records = [];
    recordsSnap.forEach(d => {
      records.push({
        id: d.id,
        cedula: String(d.data().cedula || '').trim().toUpperCase(),
        nombre: d.data().nombre || '',
        uid: d.data().uid || '',
        militanteName: d.data().militanteName || '',
        telefono: d.data().telefono || '',
        nota: d.data().nota || '',
        savedAt: d.data().savedAt?.toDate?.() || new Date(),
        ...d.data()
      });
    });

    console.log(`✅ ${records.length} registros cargados\n`);

    console.log('⏳ Cargando usuarios...');
    const usersSnap = await db.collection('users').get();
    const usuariosMap = {};
    usersSnap.forEach(d => {
      usuariosMap[d.id] = {
        displayName: d.data().displayName || '',
        email: d.data().email || '',
        name: d.data().name || ''
      };
    });

    console.log(`✅ ${Object.keys(usuariosMap).length} usuarios cargados\n`);

    const cedulaMap = {};
    records.forEach(r => {
      if (!r.cedula || r.cedula === '') return;

      if (!cedulaMap[r.cedula]) {
        cedulaMap[r.cedula] = [];
      }
      cedulaMap[r.cedula].push(r);
    });

    const duplicados = Object.entries(cedulaMap)
      .filter(([_, items]) => items.length > 1)
      .map(([cedula, items]) => ({
        cedula,
        cantidad: items.length,
        nombre: items[0].nombre,
        registros: items.sort((a, b) => a.savedAt - b.savedAt)
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    console.log(`⚠️ ${duplicados.length} cédulas con duplicados encontradas\n`);

    const filas = [
      ['CÉDULA', 'VOTANTE', 'CANTIDAD COPIAS', 'TIPO', 'UID MILITANTE', 'NOMBRE MILITANTE', 'EMAIL MILITANTE', 'TELÉFONO', 'FECHA GRABACIÓN', 'NOTA']
    ];

    duplicados.forEach(dup => {
      dup.registros.forEach((r, idx) => {
        const tipo = idx === 0 ? 'ORIGINAL' : `COPIA ${idx}`;
        const usuario = usuariosMap[r.uid] || {};
        
        const nombreMilitante = r.militanteName || usuario.displayName || usuario.email || r.uid;
        const emailMilitante = usuario.email || '-';
        const fechaFormato = r.savedAt.toLocaleString('es-PY');

        filas.push([
          dup.cedula,
          dup.nombre,
          dup.cantidad,
          tipo,
          r.uid,
          nombreMilitante,
          emailMilitante,
          r.telefono,
          fechaFormato,
          r.nota
        ]);
      });
    });

    const csv = filas
      .map(fila =>
        fila.map(cell => {
          const cellStr = String(cell).replace(/"/g, '""');
          return cellStr.includes(',') || cellStr.includes('"') ? `"${cellStr}"` : cellStr;
        }).join(',')
      )
      .join('\n');

    const outputPath = path.join(process.cwd(), 'reporte-duplicados.csv');
    fs.writeFileSync(outputPath, csv, 'utf-8');

    console.log(`✅ REPORTE GENERADO: ${outputPath}`);
    console.log(`\n📊 ESTADÍSTICAS:`);
    console.log(`   - Cédulas duplicadas: ${duplicados.length}`);
    console.log(`   - Total filas (incluyendo header): ${filas.length}`);
    console.log(`   - Registros duplicados: ${filas.length - 1 - duplicados.length}\n`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

generarReporte();