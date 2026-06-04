const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

const LOCALES = [
  { nombre: 'COLEGIO NACIONAL FERNANDO DE LA MORA', mesas: 46 },
  { nombre: 'COMANDANTE HEBER LEO NOWAK', mesas: 26 },
  { nombre: 'ESCUELA SUPERIOR GREGORIA DE SALDIVAR', mesas: 48 },
  { nombre: 'ESC.GRAD. N° 24 RCA. DOMINICANA', mesas: 43 },
];

async function crearMesarios() {
  let contador = 0;
  
  for (const local of LOCALES) {
    for (let mesa = 1; mesa <= local.mesas; mesa++) {
      contador++;
      
      const email = `mesario-${local.nombre.substring(0, 5)}-${mesa}@samy2026.py`;
      const password = `Mesario${mesa}2026!`;
      
      try {
        const userRecord = await auth.createUser({
          email: email,
          password: password,
          displayName: `Mesario ${local.nombre} - Mesa ${mesa}`,
        });
        
        await db.collection('users').doc(userRecord.uid).set({
          email: email,
          displayName: `Mesario ${local.nombre} - Mesa ${mesa}`,
          role: 'mesario',
          local: local.nombre,
          mesa: mesa.toString(),
          estado: 'activo',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        console.log(`✅ ${contador}. Mesario creado: ${email}`);
      } catch (error) {
        console.error(`❌ Error en ${email}:`, error.message);
      }
    }
  }
  
  console.log(`\n✅ TOTAL: ${contador} mesarios creados`);
  process.exit(0);
}

crearMesarios();