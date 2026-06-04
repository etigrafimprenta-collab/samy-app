import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

admin.auth().listUsers(100)
  .then((listUsersResult) => {
    console.log('Usuarios en Firebase Auth:');
    listUsersResult.users.forEach((user) => {
      console.log(`Email: ${user.email} | UID: ${user.uid}`);
    });
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });