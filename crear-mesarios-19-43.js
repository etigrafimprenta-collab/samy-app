/**
 * Script: Crear Mesarios 19-43
 * Crea usuarios en Firebase Auth + Firestore
 * Email: 19@mesa.com - 43@mesa.com
 * Password: 123456
 * Role: mesario
 */

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

async function crearMesarios() {
  const mesarios = [];
  
  // Generar datos para mesarios 19-43
  for (let i = 19; i <= 43; i++) {
    mesarios.push({
      email: `${i}@mesa.com`,
      password: '123456',
      mesa: String(i),
      seccional: '357',
      local: 'Esc República Dominicana'
    })
  }

  console.log(`📋 Creando ${mesarios.length} mesarios...`);

  for (const mesario of mesarios) {
    try {
      // 1. Crear usuario en Firebase Auth
      const userRecord = await auth.createUser({
        email: mesario.email,
        password: mesario.password,
        displayName: `mesario-${mesario.mesa}`
      });

      console.log(`✅ Usuario Auth creado: ${mesario.email} (UID: ${userRecord.uid})`);

      // 2. Crear documento en Firestore
      await db.collection('users').doc(userRecord.uid).set({
        email: mesario.email,
        displayName: `mesario-${mesario.mesa}`,
        role: 'mesario',
        mesa: mesario.mesa,
        seccional: mesario.seccional,
        local: mesario.local,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ Firestore creado: ${mesario.email}`);
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        console.log(`⚠️  Email ya existe: ${mesario.email}`);
      } else {
        console.error(`❌ Error con ${mesario.email}:`, error.message);
      }
    }
  }

  console.log('\n✅ Proceso completado');
  process.exit(0);
}

crearMesarios().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});